import { NextResponse } from "next/server";
import { getOrCreateUser } from "@/lib/auth";
import { noteApiError } from "@/lib/note-api";
import { noteToMarkdownFile } from "@/lib/note-io";
import { loadEmbeddedWhiteboardMeta } from "@/lib/note-whiteboards";
import { NOTE_ONLY_ACTION_ERRORS, pageKindRejection } from "@/lib/page-kind-errors";
import { pageKindFeatures, pageKindOf } from "@/lib/page-kinds";
import { prisma } from "@/lib/prisma";
import { msg } from "@/lib/i18n/translate";

type RouteContext = { params: Promise<{ pageId: string }> };

// ノート 1 篇を Markdown ファイルとして返す（Web・Android・iOS 共用）。
// /api/sessions/:id/export と同じ { fileName, markdown } 形式。
// Markdown にできるのはノートだけ。ホワイトボード・スライドは（古いアプリの「…」メニューから呼ばれても）訳した文で断る。
export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await getOrCreateUser();
    const { pageId } = await context.params;
    const page = await prisma.notePage.findFirst({
      where: { id: pageId, userId: user.id, deletedAt: null },
      select: { kind: true, title: true, blocks: true },
    });
    if (!page) {
      return NextResponse.json({ error: msg("Page not found.") }, { status: 404 });
    }
    const kind = pageKindOf(page);
    if (!pageKindFeatures(kind).markdownExport) return pageKindRejection(request, NOTE_ONLY_ACTION_ERRORS.export, kind);
    const whiteboards = await loadEmbeddedWhiteboardMeta(user.id, page.blocks);
    return NextResponse.json(noteToMarkdownFile(page, { whiteboards }), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return noteApiError(error);
  }
}
