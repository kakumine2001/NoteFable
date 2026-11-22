import { NextResponse } from "next/server";
import { getOrCreateUser } from "@/lib/auth";
import { isEmojiIcon } from "@/lib/emoji-icon";
import { prisma } from "@/lib/prisma";
import { msg } from "@/lib/i18n/translate";

export async function GET(request: Request) {
  // サイドバーに出すためのセッション一覧。
  // 匿名デバイス ID から利用者を決め、その利用者が所有する会話だけを更新順で返す。
  try {
    // Cookie から現在の匿名ユーザーを確定する。
    const user = await getOrCreateUser();
    // サイドバーに必要な最小限の情報だけ取得する。
    // ノートの AI パネルで始めた会話（noteId あり）も普通の会話として一覧に入る。
    // ?noteId= を付けると、そのノートで始めた会話だけを新しい順で返す（パネルの履歴用）。自分の会話しか見ないので、他人のノートの ID では空になる。
    const noteId = new URL(request.url).searchParams.get("noteId")?.trim();
    const sessions = await prisma.session.findMany({
      where: { userId: user.id, ...(noteId ? { noteId } : {}) },
      orderBy: noteId ? [{ updatedAt: "desc" }, { id: "desc" }] : [{ pinned: "desc" }, { position: "asc" }, { updatedAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        title: true,
        icon: true,
        pinned: true,
        position: true,
        projectId: true,
        noteId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({ sessions });
  } catch (error) {
    console.error("Failed to load sessions", error);
    return NextResponse.json(
      { error: msg("Database is unavailable."), sessions: [] },
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
    return NextResponse.json({ error: msg("Chat icon must be a single emoji.") }, { status: 400 });
  }
  // プロジェクトの中で「New chat」を押したとき、最初からそのプロジェクトに入れて作る。
  const projectId = body && typeof body === "object" && "projectId" in body ? (body as { projectId: unknown }).projectId : null;
  if (projectId !== null && (typeof projectId !== "string" || !projectId)) {
    return NextResponse.json({ error: msg("Project must be a project ID.") }, { status: 400 });
  }

  try {
    // 新規セッションの所有者になる匿名ユーザー。
    const user = await getOrCreateUser();
    // 他人のプロジェクトや存在しないプロジェクトには作らせない。
    if (projectId && !await prisma.chatProject.findFirst({ where: { id: projectId, userId: user.id }, select: { id: true } })) {
      return NextResponse.json({ error: msg("Project not found.") }, { status: 404 });
    }
    // まだ本文がないため title は仮の "New chat" にしておく。
    const session = await prisma.session.create({
      data: {
        userId: user.id,
        title: "New chat",
        icon,
        ...(projectId ? { projectId } : {}),
      },
      select: {
        id: true,
        title: true,
        icon: true,
        pinned: true,
        position: true,
        projectId: true,
        noteId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({ session }, { status: 201 });
  } catch (error) {
    console.error("Failed to create session", error);
    return NextResponse.json({ error: msg("Database is unavailable.") }, { status: 503 });
  }
}
