import type { Prisma } from "@/generated/prisma/client";
import { assertCanvasFilesOwner, emptyCanvasData, type CanvasPageInput } from "@/lib/canvas-document";
import { prepareCanvas, writeCanvas } from "@/lib/canvas-store";
import { assertCoverOwner, claimCover } from "@/lib/note-covers";
import { assertNoteFilesOwner } from "@/lib/note-files";
import { claimNoteFiles, claimStoredFiles } from "@/lib/stored-files";
import { lockNoteOrder, resolveParent } from "@/lib/note-tree-server";
import type { CanvasKind } from "@/lib/page-kinds";
import type { NoteContent } from "@/types/notes";
import { prisma } from "@/lib/prisma";

// 検証済みの本文から新しいページを作る。POST /api/pages と回答からの保存（/api/pages/from-answer）が同じ手順を通る。
// parentId を渡すとそのページのサブページになり、グループは親と同じになる。
export async function createNotePage(userId: string, content: NoteContent, { parentId = null }: { parentId?: string | null } = {}) {
  assertCoverOwner(content.cover, userId);
  assertCoverOwner(content.icon, userId, "icon");
  assertNoteFilesOwner(content.blocks, userId);
  return prisma.$transaction(async (tx) => {
    const groupId = parentId ? await parentGroup(tx, userId, parentId) : null;
    await claimCover(tx, content.cover, userId);
    await claimCover(tx, content.icon, userId, "icon");
    await claimNoteFiles(tx, content.blocks, userId);
    return tx.notePage.create({ data: { userId, parentId, groupId, title: content.title, icon: content.icon, cover: content.cover, coverPosition: content.coverPosition, blocks: content.blocks as unknown as Prisma.InputJsonValue } });
  });
}

// 親の移動・ゴミ箱と同時に作られても、ゴミ箱の親の下に作らない。種類が違うページの下にも作れる（ノートの下のホワイトボードなど）。
async function parentGroup(tx: Prisma.TransactionClient, userId: string, parentId: string) {
  await lockNoteOrder(tx, userId);
  return (await resolveParent(tx, userId, null, parentId)).groupId;
}

// ホワイトボード・スライドを作る。ページの行（blocks は空配列）と本体（NoteCanvas）を同じトランザクションで作る。
// data を省略すると空の本体。戻り値は作ったページの行と、その本体。
export async function createCanvasPage(userId: string, kind: CanvasKind, input: CanvasPageInput, { parentId = null }: { parentId?: string | null } = {}) {
  assertCoverOwner(input.icon, userId, "icon");
  assertCanvasFilesOwner(input, userId);
  const data = input.data ?? emptyCanvasData(kind);
  const canvas = prepareCanvas(kind, data, input.size ?? new TextEncoder().encode(JSON.stringify(data)).byteLength, input.filePaths);
  const page = await prisma.$transaction(async (tx) => {
    const groupId = parentId ? await parentGroup(tx, userId, parentId) : null;
    await claimCover(tx, input.icon, userId, "icon");
    await claimStoredFiles(tx, input.filePaths, userId);
    const created = await tx.notePage.create({ data: { userId, kind, parentId, groupId, title: input.title, icon: input.icon, cover: null, coverPosition: null, blocks: [] } });
    await writeCanvas(tx, created.id, canvas);
    return created;
  });
  return { page, data };
}
