import { NextResponse } from "next/server";
import { getOrCreateUser } from "@/lib/auth";
import { noteApiError } from "@/lib/note-api";
import { noteToMarkdownFile } from "@/lib/note-io";
import { prisma } from "@/lib/prisma";
import { msg } from "@/lib/i18n/translate";

type RouteContext = { params: Promise<{ pageId: string }> };

// ノート 1 篇を Markdown ファイルとして返す（Web・Android・iOS 共用）。
// /api/sessions/:id/export と同じ { fileName, markdown } 形式。
export async function GET(_request: Request, context: RouteContext) {
  try {
    const user = await getOrCreateUser();
    const { pageId } = await context.params;
    const page = await prisma.notePage.findFirst({
      where: { id: pageId, userId: user.id, deletedAt: null },
      select: { title: true, blocks: true },
    });
    if (!page) {
      return NextResponse.json({ error: msg("Note not found.") }, { status: 404 });
    }
    return NextResponse.json(noteToMarkdownFile(page), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return noteApiError(error);
  }
}
