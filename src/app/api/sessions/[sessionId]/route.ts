import { NextRequest, NextResponse } from "next/server";
import { getOrCreateAnonymousUser } from "@/lib/auth";
import { isEmojiIcon } from "@/lib/emoji-icon";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

// 会話のアイコン（単一の絵文字、または null で既定に戻す）を変える。
export async function PATCH(request: NextRequest, context: RouteContext) {
  const user = await getOrCreateAnonymousUser();
  const { sessionId } = await context.params;

  const body = await request.json().catch(() => null);
  const icon = body && typeof body === "object" && "icon" in body ? (body as { icon: unknown }).icon : undefined;
  if (icon !== null && !isEmojiIcon(icon)) {
    return NextResponse.json({ error: "Chat icon must be a single emoji." }, { status: 400 });
  }

  // 所有者確認を兼ねて取得する。アイコン変更では一覧の並び順を動かさないため、更新日時はそのまま書き戻す。
  const current = await prisma.session.findFirst({
    where: { id: sessionId, userId: user.id },
    select: { updatedAt: true },
  });
  if (!current) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }

  const updated = await prisma.session.updateMany({
    where: { id: sessionId, userId: user.id },
    data: { icon, updatedAt: current.updatedAt },
  });
  if (!updated.count) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, icon });
}

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
