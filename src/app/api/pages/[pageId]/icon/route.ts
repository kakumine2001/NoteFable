import { NextResponse } from "next/server";
import { getOrCreateAnonymousUser } from "@/lib/auth";
import { isEmojiIcon } from "@/lib/emoji-icon";
import { noteApiError } from "@/lib/note-api";
import { NoteValidationError } from "@/lib/note-document";
import { readSmallJson } from "@/lib/note-groups";
import { prisma } from "@/lib/prisma";
import { msg } from "@/lib/i18n/translate";

type Context = { params: Promise<{ pageId: string }> };

// 開いていないノートのアイコンを、サイドバーから変える（null で外す）。
// アイコンは自動保存の PATCH にも含まれるので、版を 1 つ進める：古い内容を持つ別のタブの保存は 409 になり、アイコンを元に戻さない。
export async function PUT(request: Request, context: Context) {
  try {
    const { icon } = await readSmallJson(request);
    if (icon !== null && !isEmojiIcon(icon)) throw new NoteValidationError(msg("Note icon must be a single emoji."));
    const user = await getOrCreateAnonymousUser();
    const { pageId } = await context.params;
    const result = await prisma.notePage.updateMany({
      where: { id: pageId, userId: user.id, deletedAt: null },
      data: { icon: icon as string | null, version: { increment: 1 } },
    });
    if (!result.count) return NextResponse.json({ error: msg("Note not found.") }, { status: 404 });
    const page = await prisma.notePage.findFirst({ where: { id: pageId, userId: user.id, deletedAt: null } });
    return page ? NextResponse.json({ page }) : NextResponse.json({ error: msg("Note not found.") }, { status: 404 });
  } catch (error) { return noteApiError(error); }
}
