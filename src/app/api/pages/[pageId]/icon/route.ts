import { NextResponse } from "next/server";
import { getOrCreateUser } from "@/lib/auth";
import { isEmojiIcon } from "@/lib/emoji-icon";
import { assertCoverOwner, claimCover } from "@/lib/note-covers";
import { noteApiError } from "@/lib/note-api";
import { NoteValidationError, uploadedCoverPath } from "@/lib/note-document";
import { readSmallJson } from "@/lib/note-groups";
import { prisma } from "@/lib/prisma";
import { msg } from "@/lib/i18n/translate";

type Context = { params: Promise<{ pageId: string }> };

// 開いていないノートのアイコンを、サイドバーから変える（null で外す）。
// アイコンは自動保存の PATCH にも含まれるので、版を 1 つ進める：古い内容を持つ別のタブの保存は 409 になり、アイコンを元に戻さない。
export async function PUT(request: Request, context: Context) {
  try {
    const { icon } = await readSmallJson(request);
    if (icon !== null && !isEmojiIcon(icon) && !uploadedCoverPath(icon)) throw new NoteValidationError(msg("Note icon must be a single emoji or an uploaded image."));
    const user = await getOrCreateUser();
    assertCoverOwner(icon as string | null, user.id, "icon");
    const { pageId } = await context.params;
    // ページが見つかったときだけ画像を「使用中」にする（見つからない 404 では資産に触れない。失敗すれば更新ごと取り消す）。
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.notePage.updateMany({
        where: { id: pageId, userId: user.id, deletedAt: null },
        data: { icon: icon as string | null, version: { increment: 1 } },
      });
      if (updated.count) await claimCover(tx, icon as string | null, user.id, "icon");
      return updated;
    });
    if (!result.count) return NextResponse.json({ error: msg("Note not found.") }, { status: 404 });
    const page = await prisma.notePage.findFirst({ where: { id: pageId, userId: user.id, deletedAt: null } });
    return page ? NextResponse.json({ page }) : NextResponse.json({ error: msg("Note not found.") }, { status: 404 });
  } catch (error) { return noteApiError(error); }
}
