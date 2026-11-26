import { NextResponse } from "next/server";
import { getOrCreateUser } from "@/lib/auth";
import { msg } from "@/lib/i18n/translate";
import { noteApiError } from "@/lib/note-api";
import { findNoteBacklinks } from "@/lib/note-backlinks-server";
import { prisma } from "@/lib/prisma";

type Context = { params: Promise<{ pageId: string }> };

// このページのバックリンク：指している自分のページ（ゴミ箱を除く）と、このページを使った会話。他人のページとゴミ箱のページは 404。
export async function GET(request: Request, context: Context) {
  try {
    const user = await getOrCreateUser();
    const { pageId } = await context.params;
    const [page, backlinks] = await Promise.all([
      prisma.notePage.findFirst({ where: { id: pageId, userId: user.id, deletedAt: null }, select: { id: true } }),
      findNoteBacklinks(user.id, pageId, new URL(request.url).origin),
    ]);
    if (!page) return NextResponse.json({ error: msg("Page not found.") }, { status: 404 });
    return NextResponse.json(backlinks, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return noteApiError(error); }
}
