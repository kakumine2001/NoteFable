import { NextResponse } from "next/server";
import { getOrCreateUser } from "@/lib/auth";
import { requestStop } from "@/lib/chat-branch-store";
import { msg } from "@/lib/i18n/translate";

type RouteContext = { params: Promise<{ sessionId: string }> };

// 生成中の回答を止める。応答（/api/chat）は別のリクエストで動いているので、会話に「停止」の時刻を書き、
// 応答の側がそれを見て上流を止め、そこまでの回答を保存してストリームを閉じる。画面はストリームが閉じるのを待つ。
export async function POST(_request: Request, context: RouteContext) {
  const user = await getOrCreateUser();
  const { sessionId } = await context.params;
  try {
    if (!await requestStop(user.id, sessionId)) return NextResponse.json({ error: msg("Session not found.") }, { status: 404 });
  } catch (error) {
    console.error("Failed to request stop", error);
    return NextResponse.json({ error: msg("Could not save the chat. Please try again.") }, { status: 503 });
  }
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
