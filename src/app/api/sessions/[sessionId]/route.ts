import { NextRequest, NextResponse } from "next/server";
import { getOrCreateAnonymousUser } from "@/lib/auth";
import { isEmojiIcon } from "@/lib/emoji-icon";
import { prisma } from "@/lib/prisma";
import { msg } from "@/lib/i18n/translate";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

// Update owned chat metadata without changing recent-chat order.
export async function PATCH(request: NextRequest, context: RouteContext) {
  try { return await updateMetadata(request,context); }
  catch (error) {
    if(error && typeof error === "object" && "code" in error && error.code === "P2003") return NextResponse.json({error:msg("Project not found. Please choose another project.")},{status:404});
    console.error("Failed to update chat metadata",error);
    return NextResponse.json({error:msg("Could not save the chat. Please try again.")},{status:503});
  }
}
async function updateMetadata(request: NextRequest, context: RouteContext) {
  const user = await getOrCreateAnonymousUser();
  const { sessionId } = await context.params;

  const body = await request.json().catch(() => null);
  const data: { icon?: string | null; title?: string; titleManual?: boolean; pinned?: boolean; projectId?: string | null } = {};
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: msg("Invalid request.") }, { status: 400 });
  if ("title" in body) {
    if (typeof body.title !== "string" || !body.title.trim() || body.title.trim().length > 120) return NextResponse.json({ error: msg("Enter a title of 1–120 characters.") }, { status: 400 });
    data.title = body.title.trim(); data.titleManual = true;
  }
  if ("pinned" in body) {
    if (typeof body.pinned !== "boolean") return NextResponse.json({ error: msg("Invalid pinned value.") }, { status: 400 });
    data.pinned = body.pinned;
  }
  if ("projectId" in body) {
    if (body.projectId !== null && (typeof body.projectId !== "string" || !body.projectId || body.projectId.length > 100)) return NextResponse.json({ error: msg("Invalid project.") }, { status: 400 });
    if (body.projectId !== null && !await prisma.chatProject.findFirst({ where: { id: body.projectId, userId: user.id }, select: { id: true } })) return NextResponse.json({ error: msg("Project not found.") }, { status: 404 });
    data.projectId = body.projectId;
  }
  const icon = body && typeof body === "object" && "icon" in body ? (body as { icon: unknown }).icon : undefined;
  if ("icon" in body && icon !== null && !isEmojiIcon(icon)) {
    return NextResponse.json({ error: msg("Chat icon must be a single emoji.") }, { status: 400 });
  }

  if ("icon" in body) data.icon = icon as string | null;
  if (!Object.keys(data).length) return NextResponse.json({ error: msg("No changes supplied.") }, { status: 400 });

  // メタデータ変更では一覧の並び順を動かさないため、更新日時を変えずに書く（@updatedAt は更新のたびに打刻されるので書き戻す）。
  // 書き戻しは「更新日時が読んだ値のままのときだけ」にして、同時に回答が保存されて更新日時が進んでいたら上書きしない。
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await prisma.session.findFirst({
      where: { id: sessionId, userId: user.id },
      select: { updatedAt: true },
    });
    if (!current) {
      return NextResponse.json({ error: msg("Session not found.") }, { status: 404 });
    }
    const updated = await prisma.session.updateMany({
      where: { id: sessionId, userId: user.id, updatedAt: current.updatedAt },
      data: { ...data, updatedAt: current.updatedAt },
    });
    if (updated.count) return NextResponse.json({ ok: true, ...data });
  }

  // 競合が続く場合は、並び順より変更の保存を優先する。
  const forced = await prisma.session.updateMany({
    where: { id: sessionId, userId: user.id },
    data,
  });
  if (!forced.count) {
    return NextResponse.json({ error: msg("Session not found.") }, { status: 404 });
  }
  return NextResponse.json({ ok: true, ...data });
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
    return NextResponse.json({ error: msg("Session not found.") }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
