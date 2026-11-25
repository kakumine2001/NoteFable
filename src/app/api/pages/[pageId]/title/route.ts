import { NextResponse } from "next/server";
import { getOrCreateUser } from "@/lib/auth";
import { emptyCanvasData } from "@/lib/canvas-document";
import { readCanvasData } from "@/lib/canvas-store";
import { fmt, msg } from "@/lib/i18n/translate";
import { noteApiError } from "@/lib/note-api";
import { MAX_NOTE_TITLE, NoteValidationError } from "@/lib/note-document";
import { scheduleNoteEmbeddingSync } from "@/lib/note-embeddings";
import { readSmallJson } from "@/lib/note-groups";
import { isCanvasKind, pageKindOf } from "@/lib/page-kinds";
import { prisma } from "@/lib/prisma";

type Context = { params: Promise<{ pageId: string }> };

// サイドバーから開いていないページ（またはネイティブでフラッシュ済みのページ）のタイトルを変える。
// タイトルは自動保存の PATCH にも含まれるため、version を 1 つ進めて別タブの古い保存と競合させる（icon/route.ts と同じ）。
export async function PUT(request: Request, context: Context) {
  try {
    const { title, version } = await readSmallJson(request);
    if (typeof title !== "string" || title.length > MAX_NOTE_TITLE) {
      throw new NoteValidationError(fmt("Note title must be at most {max} characters.", { max: MAX_NOTE_TITLE }));
    }
    if (!Number.isSafeInteger(version) || Number(version) < 0) {
      throw new NoteValidationError(msg("A valid note version is required."));
    }
    const normalized = title.replace(/\r?\n/g, " ").trim() || "Untitled";
    const user = await getOrCreateUser();
    const { pageId } = await context.params;
    const updated = await prisma.notePage.updateMany({
      where: { id: pageId, userId: user.id, version: version as number, deletedAt: null },
      data: { title: normalized, version: { increment: 1 } },
    });
    const page = await prisma.notePage.findFirst({ where: { id: pageId, userId: user.id, deletedAt: null } });
    if (!page) return NextResponse.json({ error: msg("Note not found.") }, { status: 404 });
    // ホワイトボード・スライドは本体も返す（版だけ新しく本体が古いページを、画面に持たせない）。版を先に、本体を後に読む。
    const kind = pageKindOf(page);
    const responsePage = isCanvasKind(kind)
      ? { ...page, data: (await readCanvasData(user.id, pageId)) ?? emptyCanvasData(kind) }
      : page;
    if (!updated.count) {
      return NextResponse.json({ error: msg("This note was changed in another tab."), page: responsePage }, { status: 409 });
    }
    scheduleNoteEmbeddingSync(user.id, [pageId]);
    return NextResponse.json({ page: responsePage });
  } catch (error) {
    return noteApiError(error);
  }
}
