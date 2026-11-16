import { NextResponse } from "next/server";
import { getOrCreateUser } from "@/lib/auth";
import { switchMessageVersion } from "@/lib/chat-branch-store";
import { msg } from "@/lib/i18n/translate";

type RouteContext = { params: Promise<{ sessionId: string }> };

// 表示する版を切り替える（編集した発言・再生成した回答の「‹ 2/3 ›」）。body は { messageId }：表示したい版の発言。
// 切り替えたあとの会話は GET /api/sessions/:id/messages で読み直す。
export async function POST(request: Request, context: RouteContext) {
  const body = await request.json().catch(() => null) as { messageId?: unknown } | null;
  const messageId = typeof body?.messageId === "string" ? body.messageId.trim() : "";
  if (!messageId || messageId.length > 64) return NextResponse.json({ error: msg("Invalid request.") }, { status: 400 });
  const user = await getOrCreateUser();
  const { sessionId } = await context.params;
  try {
    if (!await switchMessageVersion(user.id, sessionId, messageId)) return NextResponse.json({ error: msg("Message not found.") }, { status: 404 });
  } catch (error) {
    console.error("Failed to switch message version", error);
    return NextResponse.json({ error: msg("Could not switch versions. Try again.") }, { status: 503 });
  }
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
