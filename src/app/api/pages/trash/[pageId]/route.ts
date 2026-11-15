import { NextResponse } from "next/server";
import { getOrCreateUser } from "@/lib/auth";
import { noteApiError } from "@/lib/note-api";
import { NoteValidationError } from "@/lib/note-document";
import { trashCutoff } from "@/lib/note-trash";
import { descendantIds, lockNoteOrder, PAGE_SUMMARY_SELECT, setSubtreeGroup } from "@/lib/note-tree-server";
import { prisma } from "@/lib/prisma";
import { msg } from "@/lib/i18n/translate";

type Context = { params: Promise<{ pageId: string }> };

const notFound = () => NextResponse.json({ error: msg("Note not found in the trash.") }, { status: 404 });

// ゴミ箱から戻す。保持期間内のものだけ。位置・グループ・本文は捨てる前のまま（グループが消えていれば「グループなし」）。
// 一緒にゴミ箱へ入ったサブページ（同じ時刻のもの）もまとめて戻す。親がまだゴミ箱にある・消えていれば最上位に戻す。
// 応答の page は GET /api/pages の 1 件と同じ形で、そのまま一覧へ加えられる。pages は戻したすべてのページ。
export async function POST(_request: Request, context: Context) {
  try {
    const user = await getOrCreateUser();
    const { pageId } = await context.params;
    const result = await prisma.$transaction(async (tx) => {
      await lockNoteOrder(tx, user.id);
      const page = await tx.notePage.findFirst({
        where: { id: pageId, userId: user.id, deletedAt: { gte: trashCutoff() } },
        select: { deletedAt: true, parentId: true, groupId: true, parent: { select: { deletedAt: true, groupId: true } } },
      });
      if (!page) throw new NoteValidationError(msg("Note not found in the trash."), 404);
      const batch = await descendantIds(tx, user.id, pageId, { live: false });
      const together = batch.length
        ? (await tx.notePage.findMany({ where: { id: { in: batch }, userId: user.id, deletedAt: page.deletedAt }, select: { id: true } })).map((row) => row.id)
        : [];
      // 途中に別の時刻で捨てたページがあると、その下の子は一緒に戻さない（その親を戻した時に戻る）。
      const restorable = new Set([pageId, ...together]);
      if (together.length) {
        const parents = await tx.notePage.findMany({ where: { id: { in: together } }, select: { id: true, parentId: true } });
        let changed = true;
        while (changed) {
          changed = false;
          for (const row of parents) if (restorable.has(row.id) && (!row.parentId || !restorable.has(row.parentId))) { restorable.delete(row.id); changed = true; }
        }
      }
      const ids = [...restorable];
      await tx.notePage.updateMany({ where: { id: { in: ids }, userId: user.id }, data: { deletedAt: null } });
      const parentLive = page.parentId && page.parent && !page.parent.deletedAt;
      if (!parentLive && page.parentId) await tx.notePage.updateMany({ where: { id: pageId, userId: user.id }, data: { parentId: null } });
      // 親の下へ戻すときは、その間に親が別のグループへ移っていても親にそろえる。
      if (parentLive) await setSubtreeGroup(tx, user.id, pageId, page.parent!.groupId);
      const pages = await tx.notePage.findMany({ where: { id: { in: ids }, userId: user.id, deletedAt: null }, select: PAGE_SUMMARY_SELECT });
      return { page: pages.find((row) => row.id === pageId), pages };
    });
    return result.page ? NextResponse.json(result) : notFound();
  } catch (error) {
    if (error instanceof NoteValidationError && error.status === 404) return notFound();
    return noteApiError(error);
  }
}

// ゴミ箱にある 1 件を完全に削除する（元に戻せない）。ゴミ箱にあるそのサブページも消す。通常のノートはこの API では消せない。
export async function DELETE(_request: Request, context: Context) {
  try {
    const user = await getOrCreateUser();
    const { pageId } = await context.params;
    const ids = await prisma.$transaction(async (tx) => {
      const page = await tx.notePage.findFirst({ where: { id: pageId, userId: user.id, deletedAt: { not: null } }, select: { id: true } });
      if (!page) return null;
      const trashed = await descendantIds(tx, user.id, pageId, { live: false });
      // 消すのはゴミ箱にあるものだけ。応答の ids で、ゴミ箱の一覧に別に出ていた子も画面から外せる。
      const doomed = (await tx.notePage.findMany({ where: { id: { in: [pageId, ...trashed] }, userId: user.id, deletedAt: { not: null } }, select: { id: true } })).map((row) => row.id);
      await tx.notePage.deleteMany({ where: { id: { in: doomed }, userId: user.id, deletedAt: { not: null } } });
      return doomed;
    });
    return ids?.length ? NextResponse.json({ ok: true, ids }) : notFound();
  } catch (error) { return noteApiError(error); }
}
