import { randomUUID } from "node:crypto";
import { MAX_NOTE_FILE_BYTES, NOTE_IMAGE_EXTENSIONS, isNoteImageUrl, noteFileUrl, safeFileName, sniffImage } from "@/lib/note-file-keys";
import { PageEditError } from "@/lib/page-edit";
import { prisma } from "@/lib/prisma";
import { readStoredImage } from "@/lib/storage";
import { storeFile } from "@/lib/stored-files";
import { StorageLimitError } from "@/lib/usage-plans";

// チャットに添付された画像を、AI の編集案からノートの画像ブロックとして使えるようにする。
// モデルは「![説明](attachment:<添付 ID>)」と書くだけで、サーバーが同じ会話の自分の添付かを確かめ、
// ノート用の保存先（note-files/<ユーザー>/）へコピーして、その URL に置き換える。

export const MAX_ATTACHMENT_IMAGES_PER_PROPOSAL = 5;
const LIST_LIMIT = 30;
// URL 全体の上限（parseNoteFileUrl の 600 文字）に収まるよう、ファイル名を縮める時の目標。
const URL_BUDGET = 560;

// 1 行がまるごと画像の参照になっている行だけを対象にする（本文中の文字としては扱わない）。
const REFERENCE = /^([ \t]*)!\[([^\]\n]*)\]\(attachment:([A-Za-z0-9_-]{1,64})\)[ \t]*$/;
const FENCE = /^\s*(`{3,})/;

// excludeMessageIds は、再生成で置き換えられる発言（保存するまでは表示中のまま残っている）。その添付は見せない。
export async function listChatAttachments(userId: string, sessionId: string, excludeMessageIds: string[] = []) {
  const rows = await prisma.attachment.findMany({
    where: { message: { active: true, ...(excludeMessageIds.length ? { id: { notIn: excludeMessageIds } } : {}), session: { id: sessionId, userId } } },
    orderBy: { createdAt: "desc" },
    take: LIST_LIMIT,
    select: { id: true, filename: true, mimeType: true, size: true, imageStoragePath: true },
  });
  return rows.map((row) => row.imageStoragePath
    ? { id: row.id, filename: row.filename, mimeType: row.mimeType, size: row.size, canInsertIntoNote: row.size <= MAX_NOTE_FILE_BYTES, kind: "image" }
    : { id: row.id, filename: row.filename, mimeType: row.mimeType, size: row.size, canInsertIntoNote: false, kind: "file", note: "Only its text was kept, so it cannot be placed in a note as a file. Use the text in a note if needed." });
}

type Reference = { line: number; indent: string; caption: string; id: string };

// markdown を行ごとに見て、コードの囲み（```）の外にある画像参照だけを集める。
function findReferences(lines: string[]) {
  const found: Reference[] = [];
  let fence = 0;
  lines.forEach((line, index) => {
    const opening = FENCE.exec(line);
    if (fence) {
      if (opening && opening[1].length >= fence && line.trim() === opening[1]) fence = 0;
      return;
    }
    if (opening) { fence = opening[1].length; return; }
    const match = REFERENCE.exec(line);
    if (match) found.push({ line: index, indent: match[1], caption: match[2], id: match[3] });
  });
  return found;
}

// 長い（CJK など）ファイル名で URL が上限を超えて画像として扱われなくならないよう、名前を縮める。
function fitName(path: string, name: string, extension: string) {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const suffix = dot > 0 ? name.slice(dot) : "";
  for (let length = base.length; length > 0; length = length > 10 ? length - 10 : length - 1) {
    const candidate = base.slice(0, length) + suffix;
    if (noteFileUrl(path, candidate).length <= URL_BUDGET) return candidate;
  }
  return `image.${extension}`;
}

// 複数の markdown（編集案ならすべての edit）をまとめて処理する。
// 1) 参照を全部集めて検証し（画像を書く前に失敗できる）、2) まとめてコピーし、3) 参照を URL に置き換える。
// 同じ添付は 1 回だけコピーし、1 回の提案で使える画像は MAX_ATTACHMENT_IMAGES_PER_PROPOSAL 枚まで。
export function createAttachmentResolver(userId: string, sessionId: string, excludeMessageIds: string[] = []) {
  return async function resolve(markdowns: string[]): Promise<string[]> {
    const split = markdowns.map((markdown) => markdown.replace(/\r\n?/g, "\n").split("\n"));
    const references = split.map(findReferences);
    const ids = [...new Set(references.flatMap((list) => list.map((reference) => reference.id)))];
    if (!ids.length) return markdowns;
    if (ids.length > MAX_ATTACHMENT_IMAGES_PER_PROPOSAL) {
      throw new PageEditError(`At most ${MAX_ATTACHMENT_IMAGES_PER_PROPOSAL} attached images can be placed in one proposal; split the work.`);
    }

    const prepared: { id: string; filename: string; buffer: Buffer; mime: string }[] = [];
    for (const id of ids) {
      const attachment = await prisma.attachment.findFirst({
        where: { id, imageStoragePath: { not: null }, message: { active: true, ...(excludeMessageIds.length ? { id: { notIn: excludeMessageIds } } : {}), session: { id: sessionId, userId } } },
        select: { filename: true, size: true, imageStoragePath: true },
      });
      if (!attachment?.imageStoragePath) {
        throw new PageEditError(`attachment:${id} is not an image the user sent in this chat. Call list_chat_attachments and use one of its image ids.`);
      }
      // 大きな画像は読み込む前に断る。
      if (attachment.size > MAX_NOTE_FILE_BYTES) throw new PageEditError(`attachment:${id} is larger than ${MAX_NOTE_FILE_BYTES / 1024 / 1024} MB, the limit for images in notes.`);
      let buffer: Buffer;
      try { buffer = await readStoredImage(attachment.imageStoragePath); }
      catch { throw new PageEditError(`The image for attachment:${id} could not be read.`); }
      if (buffer.length > MAX_NOTE_FILE_BYTES) throw new PageEditError(`attachment:${id} is larger than ${MAX_NOTE_FILE_BYTES / 1024 / 1024} MB, the limit for images in notes.`);
      const mime = sniffImage(buffer);
      if (!mime) throw new PageEditError(`attachment:${id} is not a PNG, JPEG, WebP or GIF image.`);
      prepared.push({ id, filename: attachment.filename, buffer, mime });
    }

    // ここまで通ったものだけをコピーする。
    const urls = new Map<string, string>();
    for (const image of prepared) {
      const extension = NOTE_IMAGE_EXTENSIONS[image.mime];
      const path = `note-files/${userId}/${randomUUID()}.${extension}`;
      const name = fitName(path, safeFileName(image.filename) || `image.${extension}`, extension);
      const url = noteFileUrl(path, name);
      if (!isNoteImageUrl(url)) throw new PageEditError(`attachment:${image.id} cannot be placed in a note.`);
      // コピーも新しいファイルなので、持ち主の容量に数える（入らなければ、モデルに理由を返して提案を作らない）。
      try {
        await storeFile(userId, { path, kind: "NOTE_FILE", buffer: image.buffer, mimeType: image.mime });
      } catch (error) {
        if (error instanceof StorageLimitError) {
          throw new PageEditError(`attachment:${image.id} could not be copied into the note because the user's file storage is full. Tell the user their storage is full; they can delete files they no longer need${error.tier === "pro" ? "" : error.tier === "guest" ? " or sign in for more space" : " or upgrade to Pro for more space"}.`);
        }
        throw error;
      }
      urls.set(image.id, url);
    }

    return split.map((lines, index) => {
      for (const reference of references[index]) lines[reference.line] = `${reference.indent}![${reference.caption}](${urls.get(reference.id)})`;
      return references[index].length ? lines.join("\n") : markdowns[index];
    });
  };
}
