import { NextResponse } from "next/server";
import { getOrCreateUser } from "@/lib/auth";
import { noteApiError } from "@/lib/note-api";
import { NoteValidationError } from "@/lib/note-document";
import { readSmallJson } from "@/lib/note-groups";
import { lockNoteOrder, PAGE_SUMMARY_SELECT, resolveParent, setPageMeta, setSubtreeGroup } from "@/lib/note-tree-server";
import { prisma } from "@/lib/prisma";
import { msg } from "@/lib/i18n/translate";

type Context = { params: Promise<{ pageId: string }> };

// ページを別のページの中へ移す（Notion の「Move to」でページを選ぶ）。null で最上位へ戻す（グループはそのまま）。
// 子孫も一緒に動き、グループは新しい親と同じになる。本文の版は変えない。
export async function PUT(request: Request, context: Context) {
  try {
    const { parentId } = await readSmallJson(request);
    if (parentId !== null && (typeof parentId !== "string" || !parentId || parentId.length > 64)) throw new NoteValidationError("parentId must be a note ID or null.");
    const user = await getOrCreateUser();
    const { pageId } = await context.params;
    const pages = await prisma.$transaction(async (tx) => {
      await lockNoteOrder(tx, user.id);
      const page = await tx.notePage.findFirst({ where: { id: pageId, userId: user.id, deletedAt: null }, select: { groupId: true } });
      if (!page) throw new NoteValidationError(msg("Note not found."), 404);
      const groupId = parentId === null ? page.groupId : (await resolveParent(tx, user.id, pageId, parentId)).groupId;
      await setPageMeta(tx, user.id, pageId, { parentId });
      const ids = await setSubtreeGroup(tx, user.id, pageId, groupId);
      return tx.notePage.findMany({ where: { id: { in: ids }, userId: user.id }, select: PAGE_SUMMARY_SELECT });
    });
    return NextResponse.json({ pages });
  } catch (error) { return noteApiError(error); }
}
