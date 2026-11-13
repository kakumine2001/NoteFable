import { NextResponse } from "next/server";
import { getOrCreateAnonymousUser } from "@/lib/auth";
import { noteApiError } from "@/lib/note-api";
import { toRevisionDetail } from "@/lib/note-revisions";
import { prisma } from "@/lib/prisma";
import { msg } from "@/lib/i18n/translate";

type Context = { params: Promise<{ pageId: string; revisionId: string }> };

// 履歴 1 件の中身（プレビュー用）。他人のノート・ゴミ箱のノート・別のノートの履歴は 404。
export async function GET(_request: Request, context: Context) {
  try {
    const user = await getOrCreateAnonymousUser();
    const { pageId, revisionId } = await context.params;
    const revision = await prisma.noteRevision.findFirst({
      where: { id: revisionId, noteId: pageId, userId: user.id, note: { userId: user.id, deletedAt: null } },
      select: { id: true, reason: true, title: true, icon: true, blocks: true, version: true, createdAt: true },
    });
    return revision ? NextResponse.json({ revision: toRevisionDetail(revision) }, { headers: { "Cache-Control": "no-store" } }) : NextResponse.json({ error: msg("Revision not found.") }, { status: 404 });
  } catch (error) { return noteApiError(error); }
}
