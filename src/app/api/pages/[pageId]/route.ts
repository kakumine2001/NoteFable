import { NextResponse } from "next/server";
import { isDeepStrictEqual } from "node:util";
import type { Prisma } from "@/generated/prisma/client";
import { getOrCreateUser } from "@/lib/auth";
import { assertCanvasFilesOwner, CANVAS_TOO_LARGE, emptyCanvasData, MAX_CANVAS_REQUEST_BYTES, validateCanvasPage } from "@/lib/canvas-document";
import { prepareCanvas, readCanvasData, writeCanvas } from "@/lib/canvas-store";
import { noteApiError } from "@/lib/note-api";
import { assertCoverOwner, claimCover } from "@/lib/note-covers";
import { assertNoteFilesOwner } from "@/lib/note-files";
import { claimNoteFiles, claimStoredFiles } from "@/lib/stored-files";
import { NoteValidationError, readNoteRequest, validateNoteUpdate } from "@/lib/note-document";
import { scheduleNoteEmbeddingSync } from "@/lib/note-embeddings";
import { snapshotBeforeSave } from "@/lib/note-revisions";
import { tryPurgeExpiredNotes } from "@/lib/note-trash";
import { NOTE_ONLY_ACTION_ERRORS, pageKindRejection } from "@/lib/page-kind-errors";
import { descendantIds, lockNoteOrder, PAGE_SUMMARY_SELECT } from "@/lib/note-tree-server";
import { isCanvasKind, pageKindOf, type CanvasKind } from "@/lib/page-kinds";
import { prisma } from "@/lib/prisma";
import { msg } from "@/lib/i18n/translate";

type Context = { params: Promise<{ pageId: string }> };

// ゴミ箱のノートは、この API からは読めず、保存もできない（ゴミ箱の API だけが扱う）。
// ホワイトボード・スライドは、ページの行に本体（data、NoteCanvas）を足して返す。
export async function GET(_request: Request, context: Context) {
  try {
    const user = await getOrCreateUser();
    const { pageId } = await context.params;
    const page = await prisma.notePage.findFirst({ where: { id: pageId, userId: user.id, deletedAt: null } });
    if (!page) return NextResponse.json({ error: msg("Note not found.") }, { status: 404 });
    const kind = pageKindOf(page);
    if (isCanvasKind(kind)) {
      // 版（ページの行）を先に、本体を後に読む。間に別のタブが保存しても、返す版は本体より古くなるだけで、次の保存は 409 になる
      // （逆の順だと、新しい版と古い本体を組み合わせて返し、別のタブの保存を黙って上書きさせてしまう）。
      const data = await readCanvasData(user.id, page.id) ?? emptyCanvasData(kind);
      return NextResponse.json({ page: { ...page, data } }, { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ page }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return noteApiError(error); }
}

// 保存。ページの種類で本文の形が違う：ノートは { title, icon?, cover?, coverPosition?, blocks, version }、
// ホワイトボード・スライドは { title, icon?, data?, version }（saveCanvas）。種類は作った後は変わらないので、先に読んだ種類で分ける。
export async function PATCH(request: Request, context: Context) {
  try {
    const user = await getOrCreateUser();
    const { pageId } = await context.params;
    const target = await prisma.notePage.findFirst({ where: { id: pageId, userId: user.id, deletedAt: null }, select: { kind: true } });
    if (!target) return NextResponse.json({ error: msg("Note not found.") }, { status: 404 });
    const kind = pageKindOf(target);
    if (isCanvasKind(kind)) {
      const body = await readNoteRequest(request, MAX_CANVAS_REQUEST_BYTES, CANVAS_TOO_LARGE);
      // 古い画面（ノートのエディター）がホワイトボード・スライドにノートの本文を送ってきた：上書きせず、訳した文で断る。
      if (body && typeof body === "object" && "blocks" in body) return pageKindRejection(request, NOTE_ONLY_ACTION_ERRORS.save, kind);
      return await saveCanvas(body, user.id, pageId, kind);
    }
    const update = validateNoteUpdate(await readNoteRequest(request));
    assertCoverOwner(update.cover, user.id);
    assertCoverOwner(update.icon, user.id, "icon");
    assertNoteFilesOwner(update.blocks, user.id);
    // 版番号を更新条件に含め、別タブの新しい内容を上書きしない。
    const result = await prisma.$transaction(async (tx) => {
      if (update.present.includes("cover")) await claimCover(tx, update.cover, user.id);
      if (update.present.includes("icon")) await claimCover(tx, update.icon, user.id, "icon");
      await claimNoteFiles(tx, update.blocks, user.id);
      // 上書きされる前の状態を、間隔を空けて履歴に残す。版が違う保存（競合・再送）では何も入らない。
      await snapshotBeforeSave(tx, { noteId: pageId, userId: user.id, version: update.version });
      const changed = await tx.notePage.updateMany({
        where: { id: pageId, userId: user.id, version: update.version, deletedAt: null },
        data: { title: update.title, ...Object.fromEntries(update.present.map((key) => [key, update[key]])), blocks: update.blocks as unknown as Prisma.InputJsonValue, version: { increment: 1 } },
      });
      const page = await tx.notePage.findFirst({ where: { id: pageId, userId: user.id, deletedAt: null } });
      // 応答だけ失われた保存の再送は、本文が一致する時に限り成功扱いにする。
      const alreadySaved = page && page.title === update.title && update.present.every((key) => page[key] === update[key]) && isDeepStrictEqual(page.blocks, update.blocks);
      return { page, conflict: !changed.count && !alreadySaved, changed: changed.count > 0 };
    });
    if (!result.page) return NextResponse.json({ error: msg("Note not found.") }, { status: 404 });
    if (result.conflict) return NextResponse.json({ error: msg("This note was changed in another tab."), page: result.page }, { status: 409 });
    if (result.changed) scheduleNoteEmbeddingSync(user.id, [result.page.id]);
    return NextResponse.json({ page: result.page });
  } catch (error) { return noteApiError(error); }
}

// ホワイトボード・スライドの保存。本体（最大 2 MB）を送り返さないよう、応答は { version, page }（page は一覧の 1 件、本体なし）。
// data を省略すると題名・アイコンだけを変える（本体はそのまま）。icon を省略すると保存済みのアイコンを残す。
// 版が合わなければ 409（一覧の 1 件と現在の版。最新の本体は GET で読み直す）。応答だけ失われた保存の再送は、題名・アイコン・本体のハッシュが
// 保存済みと同じときだけ成功として扱う（本体そのものは読み直さない）。
async function saveCanvas(body: unknown, userId: string, pageId: string, kind: CanvasKind) {
  const input = validateCanvasPage(kind, body);
  const value = body as { version?: unknown; icon?: unknown };
  if (!Number.isSafeInteger(value.version) || Number(value.version) < 0) throw new NoteValidationError(msg("A valid note version is required."));
  const version = value.version as number;
  const iconPresent = "icon" in value;
  if (iconPresent) assertCoverOwner(input.icon, userId, "icon");
  assertCanvasFilesOwner(input, userId);
  const canvas = input.data ? prepareCanvas(kind, input.data, input.size!, input.filePaths) : null;
  const result = await prisma.$transaction(async (tx) => {
    if (iconPresent) await claimCover(tx, input.icon, userId, "icon");
    // 本体が参照するファイル（note-files）を使用中に戻す（ノートの claimNoteFiles と同じく、ページの行より先に）。
    if (canvas) await claimStoredFiles(tx, canvas.filePaths, userId);
    // ノートと同じく、上書きされる前の状態を間隔を空けて履歴に残す（題名だけの変更でも。本体は DB の中で写す）。
    await snapshotBeforeSave(tx, { noteId: pageId, userId, version, kind });
    const changed = await tx.notePage.updateMany({
      where: { id: pageId, userId, version, deletedAt: null, kind },
      data: { title: input.title, ...(iconPresent ? { icon: input.icon } : {}), version: { increment: 1 } },
    });
    if (changed.count && canvas) await writeCanvas(tx, pageId, canvas);
    const page = await tx.notePage.findFirst({ where: { id: pageId, userId, deletedAt: null }, select: PAGE_SUMMARY_SELECT });
    // 本体つきの再送だけ、題名・アイコン・本体のハッシュがそろえば保存済みとみなす。本体なし（題名・アイコンだけ）の古い版は、
    // 別のタブが本体を変えたのかどうか見分けられないので、いつも 409 にして読み直させる（古い本体のまま新しい版を持たせない）。
    let alreadySaved = false;
    if (!changed.count && canvas && page && page.title === input.title && (!iconPresent || page.icon === input.icon)) {
      const stored = await tx.noteCanvas.findUnique({ where: { noteId: pageId }, select: { hash: true } });
      alreadySaved = stored?.hash === canvas.hash;
    }
    return { page, conflict: !changed.count && !alreadySaved, changed: changed.count > 0 };
  }, { timeout: 20_000 });
  if (!result.page) return NextResponse.json({ error: msg("Note not found.") }, { status: 404 });
  if (result.conflict) return NextResponse.json({ error: msg("This note was changed in another tab."), page: result.page, version: result.page.version }, { status: 409 });
  if (result.changed) scheduleNoteEmbeddingSync(userId, [pageId]);
  return NextResponse.json({ version: result.page.version, page: result.page });
}

// ノートをゴミ箱へ移す（deletedAt を付けるだけで、位置・グループ・本文はそのまま）。復元は /api/pages/trash/:id。
// サブページも同じ時刻で一緒にゴミ箱へ入る（復元するとまとめて戻る）。応答の ids はゴミ箱へ入れたすべてのページ。種類は問わない。
export async function DELETE(_request: Request, context: Context) {
  try {
    const user = await getOrCreateUser();
    const { pageId } = await context.params;
    const ids = await prisma.$transaction(async (tx) => {
      // 同時に別のページをこのページの下へ移されても、取り残さない。
      await lockNoteOrder(tx, user.id);
      const subtree = [pageId, ...await descendantIds(tx, user.id, pageId)];
      const result = await tx.notePage.updateMany({ where: { id: { in: subtree }, userId: user.id, deletedAt: null }, data: { deletedAt: new Date() } });
      return result.count && subtree;
    });
    if (!ids) return NextResponse.json({ error: msg("Note not found.") }, { status: 404 });
    // 期限切れのゴミ箱の掃除は、この操作の成否に影響させない。
    await tryPurgeExpiredNotes(user.id);
    return NextResponse.json({ ok: true, ids });
  } catch (error) { return noteApiError(error); }
}
