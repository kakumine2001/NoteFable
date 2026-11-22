import { NextResponse } from "next/server";
import { getOrCreateUser } from "@/lib/auth";
import { loadPublicSessionMessages } from "@/lib/session-messages";
import { prisma } from "@/lib/prisma";
import { msg } from "@/lib/i18n/translate";

type RouteContext = {
  params: Promise<{ pageId: string }>;
};

// 開いているノートの最新 AI アシスタント会話を返す。
// ノートが他人のもの・存在しない・ゴミ箱にある場合は 404。会話が無ければ空で返す。
export async function GET(_request: Request, context: RouteContext) {
  const user = await getOrCreateUser();
  const { pageId } = await context.params;

  const note = await prisma.notePage.findFirst({
    where: { id: pageId, userId: user.id, deletedAt: null },
    select: { id: true },
  });
  if (!note) {
    return NextResponse.json({ error: msg("Note not found.") }, { status: 404 });
  }

  const session = await prisma.session.findFirst({
    where: { userId: user.id, noteId: note.id },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    select: { id: true },
  });
  if (!session) {
    return NextResponse.json({ sessionId: null, messages: [] }, { headers: { "Cache-Control": "no-store" } });
  }

  const messages = await loadPublicSessionMessages(user.id, session.id, { includeVersions: false });
  return NextResponse.json({ sessionId: session.id, messages }, { headers: { "Cache-Control": "no-store" } });
}
