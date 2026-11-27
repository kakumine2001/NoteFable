import { Prisma } from "@/generated/prisma/client";
import { assertCanvasFilesOwner, emptyCanvasData, type CanvasPageInput } from "@/lib/canvas-document";
import { prepareCanvas, writeCanvas } from "@/lib/canvas-store";
import { assertCoverOwner, claimCover } from "@/lib/note-covers";
import { assertNoteFilesOwner } from "@/lib/note-files";
import { claimNoteFiles, claimStoredFiles } from "@/lib/stored-files";
import { lockNoteOrder, resolveParent } from "@/lib/note-tree-server";
import type { CanvasKind } from "@/lib/page-kinds";
import type { NoteContent } from "@/types/notes";
import { NoteValidationError } from "@/lib/note-document";
import { databaseSchema, prisma } from "@/lib/prisma";
import { msg } from "@/lib/i18n/translate";

// 作り先。parentId を渡すとそのページのサブページになり、プロジェクトは親と同じになる（groupId は見ない）。
// 親がないときは groupId のプロジェクト（本人のもの）の最上位、どちらもなければプロジェクトなしの最上位。
type CreatePlacement = { parentId?: string | null; groupId?: string | null };

// 検証済みの本文から新しいページを作る。POST /api/pages と回答からの保存（/api/pages/from-answer）が同じ手順を通る。
// parentId / groupId は CreatePlacement を見る。
// ai は AI が書いた本文（Create page）。ページの「AI の内容を報告」の目印（aiUpdatedAt）を付ける（AI の提案で作るページは page-ai/storage.ts が付ける）。
export async function createNotePage(
  userId: string, content: NoteContent, { parentId = null, groupId: projectId = null, ai = false, id }: CreatePlacement & { ai?: boolean; id?: string } = {},
) {
  assertCoverOwner(content.cover, userId);
  assertCoverOwner(content.icon, userId, "icon");
  assertNoteFilesOwner(content.blocks, userId);
  return prisma.$transaction(async (tx) => {
    const groupId = await placementGroup(tx, userId, parentId, projectId);
    await claimCover(tx, content.cover, userId);
    await claimCover(tx, content.icon, userId, "icon");
    await claimNoteFiles(tx, content.blocks, userId);
    return tx.notePage.create({ data: {
      ...(id ? { id } : {}), userId, parentId, groupId, title: content.title, icon: content.icon, cover: content.cover, coverPosition: content.coverPosition,
      blocks: content.blocks as unknown as Prisma.InputJsonValue, ...(ai ? { aiUpdatedAt: new Date() } : {}),
    } });
  });
}

// 親の移動・ゴミ箱と同時に作られても、ゴミ箱の親の下に作らない。種類が違うページの下にも作れる（ノートの下のホワイトボードなど）。
async function parentGroup(tx: Prisma.TransactionClient, userId: string, parentId: string) {
  await lockNoteOrder(tx, userId);
  return (await resolveParent(tx, userId, null, parentId)).groupId;
}

// 作るページのプロジェクト。親があれば親のもの。なければ groupId（本人のプロジェクトでなければ 404）。
// プロジェクトの行は FOR KEY SHARE で押さえ、同時に消されても作ったページの groupId が消えたプロジェクトを指さないようにする
// （削除は作成の確定を待ってから、作ったページも外部キーの SetNull で「プロジェクトなし」に戻す）。
async function placementGroup(tx: Prisma.TransactionClient, userId: string, parentId: string | null, groupId: string | null) {
  if (parentId) return parentGroup(tx, userId, parentId);
  if (!groupId) return null;
  const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT "id" FROM ${Prisma.raw(`"${databaseSchema}"."NoteGroup"`)} WHERE "id" = ${groupId} AND "userId" = ${userId} FOR KEY SHARE`);
  if (!rows.length) throw new NoteValidationError(msg("Project not found."), 404);
  return groupId;
}

// ホワイトボード・スライドを作る。ページの行（blocks は空配列）と本体（NoteCanvas）を同じトランザクションで作る。
// data を省略すると空の本体。戻り値は作ったページの行と、その本体。
// ai は AI が作った本体（画成図）。ページの「AI の内容を報告」の目印（aiUpdatedAt）を付ける。
// id は AI の 1 回きりの生成が要求から決めたページの ID（page-ai/one-shot.ts。同じ要求の再送は主キーの重複で失敗する）。
export async function createCanvasPage(
  userId: string, kind: CanvasKind, input: CanvasPageInput,
  { parentId = null, groupId: projectId = null, ai = false, id }: CreatePlacement & { ai?: boolean; id?: string } = {},
) {
  assertCoverOwner(input.icon, userId, "icon");
  assertCanvasFilesOwner(input, userId);
  const data = input.data ?? emptyCanvasData(kind);
  const canvas = prepareCanvas(kind, data, input.size ?? new TextEncoder().encode(JSON.stringify(data)).byteLength, input.filePaths);
  const page = await prisma.$transaction(async (tx) => {
    const groupId = await placementGroup(tx, userId, parentId, projectId);
    await claimCover(tx, input.icon, userId, "icon");
    await claimStoredFiles(tx, input.filePaths, userId);
    const created = await tx.notePage.create({ data: {
      ...(id ? { id } : {}), userId, kind, parentId, groupId, title: input.title, icon: input.icon, cover: null, coverPosition: null, blocks: [],
      ...(ai ? { aiUpdatedAt: new Date() } : {}),
    } });
    await writeCanvas(tx, created.id, canvas);
    return created;
  });
  return { page, data };
}
