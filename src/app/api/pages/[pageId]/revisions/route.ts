import { NextResponse } from "next/server";
import { getOrCreateAnonymousUser } from "@/lib/auth";
import { noteApiError } from "@/lib/note-api";
import { MAX_REVISIONS_PER_NOTE, REVISION_SUMMARY_SELECT, toRevisionSummary } from "@/lib/note-revisions";
import { prisma } from "@/lib/prisma";

type Context = { params: Promise<{ pageId: string }> };

// ノートの編集履歴の一覧（新しい順、本文なし）。他人のノートとゴミ箱のノートは 404。
export async function GET(_request: Request, context: Context) {
  try {
    const user = await getOrCreateAnonymousUser();
    const { pageId } = await context.params;
    const [note, rows] = await Promise.all([
      prisma.notePage.findFirst({ where: { id: pageId, userId: user.id, deletedAt: null }, select: { id: true } }),
      prisma.noteRevision.findMany({
        where: { noteId: pageId, userId: user.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: MAX_REVISIONS_PER_NOTE, select: REVISION_SUMMARY_SELECT,
      }),
    ]);
    if (!note) return NextResponse.json({ error: "Note not found." }, { status: 404 });
    return NextResponse.json({ revisions: rows.map(toRevisionSummary) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return noteApiError(error); }
}
