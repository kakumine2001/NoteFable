import { NextResponse } from "next/server";
import { getOrCreateUser } from "@/lib/auth";
import { loadPublicSessionMessages } from "@/lib/session-messages";
import { prisma } from "@/lib/prisma";
import { msg } from "@/lib/i18n/translate";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const user = await getOrCreateUser();
  const { sessionId } = await context.params;

  // 所有者確認用の軽いクエリ。本文取得前にここで弾く。
  const session = await prisma.session.findFirst({
    where: {
      id: sessionId,
      userId: user.id,
      // ノートのアシスタントの会話は Chats の会話ではない（一覧にも出さない）。検索やリンクから開かせない。
      noteId: null,
    },
    select: { id: true },
  });

  if (!session) {
    return NextResponse.json({ error: msg("Session not found.") }, { status: 404 });
  }

  const messages = await loadPublicSessionMessages(user.id, sessionId, { includeVersions: true });
  return NextResponse.json({ messages });
}
