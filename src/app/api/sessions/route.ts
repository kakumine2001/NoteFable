import { NextResponse } from "next/server";
import { getOrCreateAnonymousUser } from "@/lib/auth";
import { isEmojiIcon } from "@/lib/emoji-icon";
import { prisma } from "@/lib/prisma";

export async function GET() {
  // サイドバーに出すためのセッション一覧。
  // 匿名デバイス ID から利用者を決め、その利用者が所有する会話だけを更新順で返す。
  try {
    // Cookie から現在の匿名ユーザーを確定する。
    const user = await getOrCreateAnonymousUser();
    // サイドバーに必要な最小限の情報だけ取得する。
    const sessions = await prisma.session.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        icon: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({ sessions });
  } catch (error) {
    console.error("Failed to load sessions", error);
    return NextResponse.json(
      { error: "Database is unavailable.", sessions: [] },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  // ユーザーが「New chat」を押した時点では、まだ本文がない。
  // 仮タイトルの空セッションを作り、最初の送信時にメッセージ内容からタイトルを付け直す。
  // 最初の送信前に選んだアイコンを、会話の作成と同時に保存できる。本文なし（従来の呼び出し）は icon なし。
  const body = await request.json().catch(() => null);
  const icon = body && typeof body === "object" && "icon" in body ? (body as { icon: unknown }).icon : null;
  if (icon !== null && !isEmojiIcon(icon)) {
    return NextResponse.json({ error: "Chat icon must be a single emoji." }, { status: 400 });
  }

  try {
    // 新規セッションの所有者になる匿名ユーザー。
    const user = await getOrCreateAnonymousUser();
    // まだ本文がないため title は仮の "New chat" にしておく。
    const session = await prisma.session.create({
      data: {
        userId: user.id,
        title: "New chat",
        icon,
      },
      select: {
        id: true,
        title: true,
        icon: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({ session }, { status: 201 });
  } catch (error) {
    console.error("Failed to create session", error);
    return NextResponse.json({ error: "Database is unavailable." }, { status: 503 });
  }
}
