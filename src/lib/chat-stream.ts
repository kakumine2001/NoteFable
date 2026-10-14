import type { ActivityEvent } from "@/lib/chat-activity";

// チャット API の SSE を 1 行ずつ読む。data は本文差分なら JSON 文字列、途中経過なら { activity } になる。
// 本文差分なら文字列、途中経過ならイベント、読み取れない行なら null を返す。
export function parseChatStreamLine(line: string): string | ActivityEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;

  const payload = trimmed.replace(/^data:\s*/, "");
  if (!payload || payload === "[DONE]") return null;

  const data = JSON.parse(payload) as string | { activity?: ActivityEvent };
  return typeof data === "string" ? data : (data.activity ?? null);
}
