import { NextResponse } from "next/server";
import { getOrCreateUser } from "@/lib/auth";
import { noteApiError } from "@/lib/note-api";
import { NoteValidationError } from "@/lib/note-document";
import { readSmallJson } from "@/lib/note-groups";
import { lockNoteOrder, setPageMeta, setSubtreeGroup } from "@/lib/note-tree-server";
import { prisma } from "@/lib/prisma";
import { msg } from "@/lib/i18n/translate";

type Context = { params: Promise<{ pageId: string }> };

// ノートをグループへ移す（null で「グループなし」）。サブページだった場合は親から外れて、そのグループの最上位になる。
// 子孫も同じグループへ移る。本文の版番号は変えないので、編集中の自動保存と衝突しない。
export async function PUT(request: Request, context: Context) {
  try {
    const { groupId } = await readSmallJson(request);
    if (groupId !== null && (typeof groupId !== "string" || !groupId || groupId.length > 64)) throw new NoteValidationError("groupId must be a group ID or null.");
    const user = await getOrCreateUser();
    const { pageId } = await context.params;
    // 自分のグループだけを指定できる。
    if (groupId !== null && !(await prisma.noteGroup.count({ where: { id: groupId, userId: user.id } }))) {
      return NextResponse.json({ error: msg("Group not found.") }, { status: 404 });
    }
    const ids = await prisma.$transaction(async (tx) => {
      await lockNoteOrder(tx, user.id);
      if (!(await setPageMeta(tx, user.id, pageId, { parentId: null }))) return null;
      return setSubtreeGroup(tx, user.id, pageId, groupId as string | null);
    });
    return ids ? NextResponse.json({ id: pageId, groupId, parentId: null, ids }) : NextResponse.json({ error: msg("Note not found.") }, { status: 404 });
  } catch (error) { return noteApiError(error); }
}
