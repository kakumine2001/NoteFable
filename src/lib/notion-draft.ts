import {
  getNotionFileValidationError,
  NOTION_MAX_DRAFT_FILES,
} from "@/lib/notion-files";
import type { NotionSaveBlockInput } from "@/types/notion";

// 下書きの 1 ファイル。画面だけで使う一時 ID と、プレビュー用の object URL を持つ。
export type NotionDraftFile = {
  id: string;
  file: File;
  previewUrl?: string;
};

// 下書きの本文は「文章」と「ファイル」の順序付きブロックとして持つ。
export type NotionDraftBlock =
  | { id: string; type: "text"; text: string }
  | { id: string; type: "file"; entry: NotionDraftFile };

function createDraftFile(file: File): NotionDraftFile {
  return {
    id: crypto.randomUUID(),
    file,
    // 画像だけは挿入前にサムネイルを出せるようにする。SVG なども img で表示できる。
    previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
  };
}

export function createTextBlock(text = ""): NotionDraftBlock {
  return { id: crypto.randomUUID(), type: "text", text };
}

// 会話全文を下書きの初期ブロックにする。メッセージの区切りごとに分けておくと、
// その間へファイルを差し込みやすい。
export function createTranscriptBlocks(content: string) {
  const parts = content
    .split(/\n{2}---\n{2}/)
    .map((part) => part.trim())
    .filter(Boolean);

  // 会話が空のときは空の入力ブロックを先に作らず、UI 側の空状態を表示する。
  // これにより「Add text」を押す前から空のプレースホルダーが残らない。
  return parts.map((text) => createTextBlock(text));
}

export function createFileBlocks(files: File[]) {
  return files.map((file): NotionDraftBlock => ({
    id: crypto.randomUUID(),
    type: "file",
    entry: createDraftFile(file),
  }));
}

// カーソル位置で文章を 2 つに分け、その間にファイルを差し込む。
export function insertFilesAtCaret(
  blocks: NotionDraftBlock[],
  blockId: string,
  offset: number,
  files: File[],
) {
  if (!files.length) return blocks;

  const index = blocks.findIndex((block) => block.id === blockId);
  const target = blocks[index];

  if (index < 0 || target?.type !== "text") {
    return [...blocks, ...createFileBlocks(files)];
  }

  const caret = Math.max(0, Math.min(offset, target.text.length));
  // 空白だけが残る行を作らないよう、前後の文章は詰めてから置く。
  const leading = target.text.slice(0, caret).replace(/\s+$/, "");
  const trailing = target.text.slice(caret).replace(/^\s+/, "");
  const replacement: NotionDraftBlock[] = [{ ...target, text: leading }, ...createFileBlocks(files)];

  if (trailing) {
    replacement.push(createTextBlock(trailing));
  }

  return [...blocks.slice(0, index), ...replacement, ...blocks.slice(index + 1)];
}

export function appendFiles(blocks: NotionDraftBlock[], files: File[]) {
  if (!files.length) return blocks;

  return [...blocks, ...createFileBlocks(files)];
}

export function moveBlock(blocks: NotionDraftBlock[], blockId: string, offset: -1 | 1) {
  const index = blocks.findIndex((block) => block.id === blockId);
  const next = index + offset;

  if (index < 0 || next < 0 || next >= blocks.length) {
    return blocks;
  }

  const reordered = [...blocks];
  [reordered[index], reordered[next]] = [reordered[next], reordered[index]];

  return reordered;
}

export function removeBlock(blocks: NotionDraftBlock[], blockId: string) {
  const target = blocks.find((block) => block.id === blockId);

  if (target?.type === "file" && target.entry.previewUrl) {
    URL.revokeObjectURL(target.entry.previewUrl);
  }

  return blocks.filter((block) => block.id !== blockId);
}

export function collectDraftFiles(blocks: NotionDraftBlock[]) {
  return blocks.flatMap((block) => (block.type === "file" ? [block.entry] : []));
}

// プレビュー用 object URL をまとめて解放する。パネルを閉じる時に呼ぶ。
export function revokeDraftPreviews(blocks: NotionDraftBlock[]) {
  for (const entry of collectDraftFiles(blocks)) {
    if (entry.previewUrl) {
      URL.revokeObjectURL(entry.previewUrl);
    }
  }
}

export function getDraftFileCount(blocks: NotionDraftBlock[]) {
  return blocks.filter((block) => block.type === "file").length;
}

export function hasDraftContent(blocks: NotionDraftBlock[]) {
  return blocks.some((block) => block.type === "file" || block.text.trim().length > 0);
}

// 送信前に、画面側でも同じ検証を通してから API へ渡す。
export function buildNotionSaveRequest(
  title: string,
  blocks: NotionDraftBlock[],
  maxFileUploadBytes: number,
):
  | { ok: true; title: string; blocks: NotionSaveBlockInput[]; files: File[] }
  | { ok: false; error: string } {
  const trimmedTitle = title.trim();

  if (!trimmedTitle) {
    return { ok: false, error: "Title is required." };
  }

  const payload: NotionSaveBlockInput[] = [];
  const files: File[] = [];

  for (const block of blocks) {
    if (block.type === "text") {
      const text = block.text.trim();
      if (text) payload.push({ type: "text", text });
      continue;
    }

    const file = block.entry.file;
    const validationError = getNotionFileValidationError(
      { filename: file.name, size: file.size },
      maxFileUploadBytes,
    );

    if (validationError) {
      return { ok: false, error: validationError };
    }

    payload.push({
      type: "file",
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
    });
    files.push(file);
  }

  if (!payload.length) {
    return { ok: false, error: "Add text or a file before saving." };
  }

  if (files.length > NOTION_MAX_DRAFT_FILES) {
    return { ok: false, error: `Up to ${NOTION_MAX_DRAFT_FILES} attachments per save.` };
  }

  return { ok: true, title: trimmedTitle, blocks: payload, files };
}
