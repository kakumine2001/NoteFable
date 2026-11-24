import type { Message } from "@/types/chat";

// サーバーに保存済みの発言の ID（cuid）か。表示中だけの発言は crypto.randomUUID() の仮の ID で、報告・編集・再生成はできない。
export function isSavedMessageId(id: string) {
  return /^c[a-z0-9]{20,}$/.test(id);
}

/**
 * サーバーから再取得した履歴へ差し替える際、すでに画面に出ている発言の React key（renderKey）を引き継ぐ。
 * - ID が一致する保存済み発言は、それまでの renderKey をそのまま維持する。
 * - handoffIds に明示された「今まさに保存された楽観表示のターン」（送信・再生成・編集の完了分）だけは、
 *   サーバーから返った末尾の新しい保存済み発言へ role 一致で renderKey を引き継ぎ、
 *   アンマウント→再マウントによる入場アニメーションの再再生や状態の消失を防ぐ。
 * - 失敗時のロールバック（拒否された編集の復元など）や版切り替え（‹ 1/2 ›）では handoffIds を渡さないため、
 *   別メッセージへ誤ってキーを引き継がない。
 */
export function reconcileFetchedMessages(
  previous: Message[],
  fetched: Message[],
  handoffIds?: readonly string[],
): Message[] {
  if (previous.length === 0 || fetched.length === 0) return fetched;

  const prevById = new Map<string, Message>();
  for (const message of previous) {
    prevById.set(message.id, message);
  }

  // 既に割り当て済みのキーを二重に使わないように記録する。
  const usedKeys = new Set<string>();
  const result: Message[] = fetched.map((message) => {
    const existing = prevById.get(message.id);
    if (!existing) return message;
    const renderKey = existing.renderKey;
    usedKeys.add(renderKey ?? message.id);
    return renderKey ? { ...message, renderKey } : message;
  });

  if (handoffIds?.length) {
    const candidates = handoffIds
      .map((id) => prevById.get(id))
      .filter((message): message is Message =>
        message !== undefined && !isSavedMessageId(message.id) && !message.failed,
      );

    if (candidates.length > 0 && result.length >= candidates.length) {
      const start = result.length - candidates.length;
      const canHandoff = candidates.every((candidate, offset) => {
        const target = result[start + offset];
        return !prevById.has(target.id) && target.role === candidate.role;
      });
      if (canHandoff) {
        for (let offset = 0; offset < candidates.length; offset++) {
          const candidate = candidates[offset];
          const inheritedKey = candidate.renderKey ?? candidate.id;
          if (!usedKeys.has(inheritedKey)) {
            usedKeys.add(inheritedKey);
            result[start + offset] = { ...result[start + offset], renderKey: inheritedKey };
          }
        }
      }
    }
  }

  return result;
}
