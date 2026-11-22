import { NextResponse } from "next/server";
import { isDeepStrictEqual } from "node:util";
import type { Prisma } from "@/generated/prisma/client";
import { getOrCreateUser } from "@/lib/auth";
import { noteApiError } from "@/lib/note-api";
import { assertCoverOwner, claimCover } from "@/lib/note-covers";
import { assertNoteFilesOwner } from "@/lib/note-files";
import { readNoteRequest, validateNoteUpdate } from "@/lib/note-document";
import { scheduleNoteEmbeddingSync } from "@/lib/note-embeddings";
import { snapshotBeforeSave } from "@/lib/note-revisions";
import { tryPurgeExpiredNotes } from "@/lib/note-trash";
import { descendantIds, lockNoteOrder } from "@/lib/note-tree-server";
import { prisma } from "@/lib/prisma";
import { msg } from "@/lib/i18n/translate";

type Context = { params: Promise<{ pageId: string }> };

// ゴミ箱のノートは、この API からは読めず、保存もできない（ゴミ箱の API だけが扱う）。
export async function GET(_request: Request, context: Context) {
  try {
    const user = await getOrCreateUser();
    const { pageId } = await context.params;
    const page = await prisma.notePage.findFirst({ where: { id: pageId, userId: user.id, deletedAt: null } });
    return page ? NextResponse.json({ page }, { headers: { "Cache-Control": "no-store" } }) : NextResponse.json({ error: msg("Note not found.") }, { status: 404 });
  } catch (error) { return noteApiError(error); }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const update = validateNoteUpdate(await readNoteRequest(request));
    const user = await getOrCreateUser();
    const { pageId } = await context.params;
    assertCoverOwner(update.cover, user.id);
    assertCoverOwner(update.icon, user.id);
    assertNoteFilesOwner(update.blocks, user.id);
    // 版番号を更新条件に含め、別タブの新しい内容を上書きしない。
    const result = await prisma.$transaction(async (tx) => {
      if (update.present.includes("cover")) await claimCover(tx, update.cover, user.id);
      if (update.present.includes("icon")) await claimCover(tx, update.icon, user.id);
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

// ノートをゴミ箱へ移す（deletedAt を付けるだけで、位置・グループ・本文はそのまま）。復元は /api/pages/trash/:id。
// サブページも同じ時刻で一緒にゴミ箱へ入る（復元するとまとめて戻る）。応答の ids はゴミ箱へ入れたすべてのページ。
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
