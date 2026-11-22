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

class NoteMissing extends Error {}

// 開いていないノートのアイコンを、サイドバーから変える（null で外す）。
// アイコンは自動保存の PATCH にも含まれるので、版を 1 つ進める：古い内容を持つ別のタブの保存は 409 になり、アイコンを元に戻さない。
export async function PUT(request: Request, context: Context) {
  try {
    const { icon } = await readSmallJson(request);
    if (icon !== null && !isEmojiIcon(icon) && !uploadedCoverPath(icon)) throw new NoteValidationError(msg("Note icon must be a single emoji or an uploaded image."));
    const user = await getOrCreateUser();
    assertCoverOwner(icon as string | null, user.id, "icon");
    const { pageId } = await context.params;
    // 自動保存（PATCH）と同じ順で、画像の資産 → ノートの行の順にロックする（逆順だと同時の保存とデッドロックしうる）。
    // ノートが見つからないときは例外で取り消し、資産を「使用中」にしたままにしない。
    try {
      await prisma.$transaction(async (tx) => {
        await claimCover(tx, icon as string | null, user.id, "icon");
        const updated = await tx.notePage.updateMany({
          where: { id: pageId, userId: user.id, deletedAt: null },
          data: { icon: icon as string | null, version: { increment: 1 } },
        });
        if (!updated.count) throw new NoteMissing();
      });
    } catch (error) {
      if (error instanceof NoteMissing) return NextResponse.json({ error: msg("Note not found.") }, { status: 404 });
      throw error;
    }
    const page = await prisma.notePage.findFirst({ where: { id: pageId, userId: user.id, deletedAt: null } });
    return page ? NextResponse.json({ page }) : NextResponse.json({ error: msg("Note not found.") }, { status: 404 });
  } catch (error) { return noteApiError(error); }
}
