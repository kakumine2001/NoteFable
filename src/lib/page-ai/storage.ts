import type { Prisma } from "@/generated/prisma/client";
import { assertCanvasFilesOwner, emptyCanvasData, validateCanvasData, type CanvasData } from "@/lib/canvas-document";
import { prepareCanvas, readCanvasData, writeCanvas } from "@/lib/canvas-store";
import { assertCoverOwner, claimCover } from "@/lib/note-covers";
import { isEmojiIcon } from "@/lib/emoji-icon";
import { MAX_NOTE_TITLE, NoteValidationError, uploadedCoverPath, validateNoteContent } from "@/lib/note-document";
import { assertNoteFilesOwner } from "@/lib/note-files";
import { lockNoteOrder, resolveParent } from "@/lib/note-tree-server";
import { isCanvasKind, pageKindOf, type CanvasKind } from "@/lib/page-kinds";
import { prisma } from "@/lib/prisma";
import { claimNoteFiles, claimStoredFiles } from "@/lib/stored-files";
import { fmt, msg } from "@/lib/i18n/translate";
import type { PageAdapter, PageSnapshot, ProposedContent, Tx } from "@/lib/page-ai/adapter";

// アダプターの「適用」の部分（保存と同じ検証・書き込み・作成・履歴の内容）。置き場所はページの種類で決まる：
// ノートは NotePage.blocks、ホワイトボード・スライドは NoteCanvas.data。どちらも手動の保存（PATCH /api/pages/:id）と同じ検証を通る。

type Storage = Pick<PageAdapter, "validate" | "claim" | "write" | "createPage" | "snapshot" | "fromSnapshot">;

// サブページとして作るときの親とグループ。親の移動・ゴミ箱と同時に作られても、ゴミ箱の親の下には作らない。
async function parentGroup(tx: Tx, userId: string, parentId: string | null) {
  if (!parentId) return { parentId: null, groupId: null };
  await lockNoteOrder(tx, userId);
  return { parentId, groupId: (await resolveParent(tx, userId, null, parentId)).groupId };
}

// アイコンは絵文字 1 つか、自分のアップロード画像（保存・作成と同じ規則）。undefined は「変えない」。
function checkIcon(icon: unknown, userId: string) {
  if (icon === undefined || icon === null) return;
  if (typeof icon !== "string" || (!isEmojiIcon(icon) && !uploadedCoverPath(icon))) throw new NoteValidationError(msg("Note icon must be a single emoji or an uploaded image."));
  assertCoverOwner(icon, userId, "icon");
}

export const noteStorage: Storage = {
  validate(userId, content) {
    // 題名・アイコン・本文の検証は保存（PATCH）と同じ。アイコンを持たない編集案はアイコンを変えない。
    const checked = validateNoteContent({ title: content.title, icon: content.icon ?? null, blocks: content.blocks ?? [] });
    assertNoteFilesOwner(checked.blocks, userId);
    checkIcon(content.icon, userId);
    return { title: checked.title, ...(content.icon === undefined ? {} : { icon: checked.icon }), blocks: checked.blocks };
  },
  async claim(tx, userId, content) {
    // ファイルの行を、履歴・ページの行より先に取る（保存と同じ順序）。後片付けが削除を始めていたら書かない。
    if (content.icon !== undefined) await claimCover(tx, content.icon, userId, "icon");
    await claimNoteFiles(tx, content.blocks as never, userId);
  },
  async write(tx, target, content, { ai, requireUnlocked }) {
    const changed = await tx.notePage.updateMany({
      where: {
        id: target.id,
        userId: target.userId,
        version: target.version,
        deletedAt: null,
        kind: "note",
        ...(requireUnlocked ? { locked: false } : {}),
      },
      data: {
        title: content.title, ...(content.icon === undefined ? {} : { icon: content.icon }),
        blocks: content.blocks as Prisma.InputJsonValue, version: { increment: 1 }, ...(ai ? { aiUpdatedAt: new Date() } : {}),
      },
    });
    return changed.count > 0;
  },
  async createPage(tx, userId, content, parentId) {
    const parent = await parentGroup(tx, userId, parentId);
    if (content.icon) await claimCover(tx, content.icon, userId, "icon");
    await claimNoteFiles(tx, content.blocks as never, userId);
    const page = await tx.notePage.create({
      data: {
        userId, ...parent, title: content.title, icon: content.icon ?? null, cover: null, coverPosition: null,
        blocks: content.blocks as Prisma.InputJsonValue, aiUpdatedAt: new Date(),
      },
      select: { id: true, version: true },
    });
    return page;
  },
  async snapshot(_tx, page) {
    return { title: page.title, icon: page.icon, blocks: page.blocks };
  },
  fromSnapshot(snapshot) {
    return { title: snapshot.title, icon: snapshot.icon, blocks: Array.isArray(snapshot.blocks) ? snapshot.blocks : [] };
  },
};

export function canvasStorage(kind: CanvasKind): Storage {
  return {
    validate(userId, content) {
      if (typeof content.title !== "string" || content.title.length > MAX_NOTE_TITLE) {
        throw new NoteValidationError(fmt("Note title must be at most {max} characters.", { max: MAX_NOTE_TITLE }));
      }
      const canvas = validateCanvasData(kind, content.data ?? emptyCanvasData(kind));
      assertCanvasFilesOwner(canvas, userId);
      checkIcon(content.icon, userId);
      return {
        title: content.title.trim() || "Untitled", ...(content.icon === undefined ? {} : { icon: content.icon }), blocks: [],
        data: canvas.data, size: canvas.size, filePaths: canvas.filePaths,
      };
    },
    async claim(tx, userId, content) {
      if (content.icon !== undefined) await claimCover(tx, content.icon, userId, "icon");
      await claimStoredFiles(tx, content.filePaths ?? [], userId);
    },
    async write(tx, target, content, { ai, requireUnlocked }) {
      const changed = await tx.notePage.updateMany({
        where: {
          id: target.id,
          userId: target.userId,
          version: target.version,
          deletedAt: null,
          kind,
          ...(requireUnlocked ? { locked: false } : {}),
        },
        data: { title: content.title, ...(content.icon === undefined ? {} : { icon: content.icon }), version: { increment: 1 }, ...(ai ? { aiUpdatedAt: new Date() } : {}) },
      });
      if (!changed.count) return false;
      const data = content.data ?? emptyCanvasData(kind);
      await writeCanvas(tx, target.id, prepareCanvas(kind, data, content.size ?? byteLength(data), content.filePaths));
      return true;
    },
    async createPage(tx, userId, content, parentId) {
      const parent = await parentGroup(tx, userId, parentId);
      if (content.icon) await claimCover(tx, content.icon, userId, "icon");
      await claimStoredFiles(tx, content.filePaths ?? [], userId);
      const page = await tx.notePage.create({
        data: { userId, kind, ...parent, title: content.title, icon: content.icon ?? null, cover: null, coverPosition: null, blocks: [], aiUpdatedAt: new Date() },
        select: { id: true, version: true },
      });
      const data = content.data ?? emptyCanvasData(kind);
      await writeCanvas(tx, page.id, prepareCanvas(kind, data, content.size ?? byteLength(data), content.filePaths));
      return page;
    },
    async snapshot(tx, page): Promise<PageSnapshot> {
      const stored = await tx.noteCanvas.findUnique({ where: { noteId: page.id }, select: { data: true } });
      return { title: page.title, icon: page.icon, blocks: [], data: stored?.data ?? emptyCanvasData(kind) };
    },
    fromSnapshot(snapshot): ProposedContent {
      return { title: snapshot.title, icon: snapshot.icon, data: (snapshot.data ?? emptyCanvasData(kind)) as CanvasData };
    },
  };
}

function byteLength(data: CanvasData) {
  return new TextEncoder().encode(JSON.stringify(data)).byteLength;
}

// 応答に返すページ（GET /api/pages/:id と同じ形）。ホワイトボード・スライドは版を読んでから本体を読む（版より新しい本体を返さない）。
export async function loadFullPage(userId: string, pageId: string) {
  const page = await prisma.notePage.findFirst({ where: { id: pageId, userId, deletedAt: null } });
  if (!page) return null;
  const kind = pageKindOf(page);
  if (!isCanvasKind(kind)) return page;
  return { ...page, data: await readCanvasData(userId, pageId) ?? emptyCanvasData(kind) };
}
