import { NextResponse } from "next/server";
import { getOrCreateUser } from "@/lib/auth";
import { forkSession } from "@/lib/chat-branch-store";
import { msg } from "@/lib/i18n/translate";

type RouteContext = { params: Promise<{ sessionId: string }> };

// ここまでの会話を新しいチャットに複製する（「新しいチャットで分岐」）。body は { messageId, title }：
// messageId は複製の最後に含める表示中の発言、title は新しいチャットの名前（画面の言語で作って送る。120 文字まで）。
export async function POST(request: Request, context: RouteContext) {
  const body = await request.json().catch(() => null) as { messageId?: unknown; title?: unknown } | null;
  const messageId = typeof body?.messageId === "string" ? body.messageId.trim() : "";
  // 元の題に「分岐」を足した名前は上限を超えうるので、断らずに切り詰める。
  const title = typeof body?.title === "string" ? body.title.replace(/\s+/g, " ").trim().slice(0, 120).trim() : "";
  if (!messageId || messageId.length > 64) return NextResponse.json({ error: msg("Invalid request.") }, { status: 400 });
  if (!title) return NextResponse.json({ error: msg("Enter a title of 1–120 characters.") }, { status: 400 });
  const user = await getOrCreateUser();
  const { sessionId } = await context.params;
  try {
    const session = await forkSession(user.id, sessionId, messageId, title);
    if (!session) return NextResponse.json({ error: msg("Message not found.") }, { status: 404 });
    return NextResponse.json({ session }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Failed to branch chat", error);
    return NextResponse.json({ error: msg("Could not branch this chat. Try again.") }, { status: 503 });
  }
}
