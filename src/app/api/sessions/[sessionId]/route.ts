import { NextRequest, NextResponse } from "next/server";
import { getOrCreateAnonymousUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export async function DELETE(_request: NextRequest, context: RouteContext) {
  // セッション ID だけで削除すると、別ユーザーの会話を消せてしまう。
  // userId も where 条件に含め、現在の匿名ユーザーが所有するセッションだけ削除する。
  // 現在の匿名ユーザー。削除条件の userId に使う。
  const user = await getOrCreateAnonymousUser();
  // Next.js の動的ルート [sessionId] から削除対象 ID を取り出す。
  const { sessionId } = await context.params;

  // deleteMany は該当なしでも例外にならないため、所有者不一致を 404 として扱いやすい。
  const deleted = await prisma.session.deleteMany({
    where: {
      id: sessionId,
      userId: user.id,
    },
  });

  if (!deleted.count) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
