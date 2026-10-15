import { NextResponse } from "next/server";
import { getOrCreateAnonymousUser } from "@/lib/auth";
import { noteApiError } from "@/lib/note-api";
import { NoteValidationError } from "@/lib/note-document";
import { readSmallJson } from "@/lib/note-groups";
import { prisma } from "@/lib/prisma";

type Context = { params: Promise<{ pageId: string }> };

// ノートをグループへ移す（null で「グループなし」）。本文の版番号は変えないので、編集中の自動保存と衝突しない。
export async function PUT(request: Request, context: Context) {
  try {
    const { groupId } = await readSmallJson(request);
    if (groupId !== null && (typeof groupId !== "string" || !groupId || groupId.length > 64)) throw new NoteValidationError("groupId must be a group ID or null.");
    const user = await getOrCreateAnonymousUser();
    const { pageId } = await context.params;
    // 自分のグループだけを指定できる。
    if (groupId !== null && !(await prisma.noteGroup.count({ where: { id: groupId, userId: user.id } }))) {
      return NextResponse.json({ error: "Group not found." }, { status: 404 });
    }
    const result = await prisma.notePage.updateMany({ where: { id: pageId, userId: user.id, deletedAt: null }, data: { groupId } });
    return result.count ? NextResponse.json({ id: pageId, groupId }) : NextResponse.json({ error: "Note not found." }, { status: 404 });
  } catch (error) { return noteApiError(error); }
}
