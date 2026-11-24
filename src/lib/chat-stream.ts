import type { ActivityEvent } from "@/lib/chat-activity";
import { syncAutoAppliedProposal } from "@/lib/proposal-sync";

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

// /api/chat の SSE ストリームを最後まで読み、本文差分と途中経過を順に渡す。
// ストリーム途中で上流が失敗した場合は HTTP 200 のまま failure イベントが流れて正常終了するため、
// 呼び出し側が完了アニメーションではなくエラー状態を出すよう streamFailed で知らせる。
export async function readChatEventStream(
  stream: ReadableStream<Uint8Array>,
  onBatch: (chunk: string, activity: ActivityEvent[], receivedAt: number) => void,
): Promise<{ streamFailed: boolean }> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let streamFailed = false;

  const consumeEvents = (events: string[]) => {
    let chunk = "";
    const activity: ActivityEvent[] = [];
    for (const eventText of events) {
      for (const line of eventText.split(/\r?\n/)) {
        try {
          const item = parseChatStreamLine(line);
          if (typeof item === "string") chunk += item;
          else if (item) {
            if (item.type === "failure") streamFailed = true;
            // 「自動適用」で適用済みの提案は、開いているページと一覧を読み直す（カードの「適用」と同じ）。
            if (typeof window !== "undefined") syncAutoAppliedProposal(item);
            activity.push(item);
          }
        } catch {
          // data: 行の JSON が壊れていたら、すでに届いた本文は失わず、その行だけ読み飛ばす。
          // ただし正常終了でも Completed にはせず、失敗として呼び出し側に知らせる。
          if (line.trim().startsWith("data:")) streamFailed = true;
        }
      }
    }
    if (chunk || activity.length) {
      onBatch(chunk, activity, Date.now());
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      buffer += decoder.decode();
      if (buffer.trim()) consumeEvents(buffer.split(/\r?\n\r?\n/));
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() ?? "";
    if (events.length) consumeEvents(events);
  }

  return { streamFailed };
}
