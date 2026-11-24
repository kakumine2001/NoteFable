import type { Message } from "@/types/chat";

// サーバーに保存済みの発言の ID（cuid）か。表示中だけの発言は crypto.randomUUID() の仮の ID で、報告・編集・再生成はできない。
export function isSavedMessageId(id: string) {
  return /^c[a-z0-9]{20,}$/.test(id);
}

/**
 * サーバーから再取得した履歴へ差し替える際、すでに画面に出ている発言の React key（renderKey）を引き継ぐ。
 * 仮 ID のまま表示していた直前の質問・回答が DB ID に切り替わっても、同じ DOM 要素のまま更新され、
 * アンマウント→再マウントによる入場アニメーションの再再生や状態の消失を防ぐ。
 * すでに保存済みの別バージョンへの切り替え（‹ 1/2 ›）では引き継がず、新しい版として描き直す。
 */
export function reconcileFetchedMessages(previous: Message[], fetched: Message[]): Message[] {
  if (previous.length === 0 || fetched.length === 0) return fetched;

  const prevById = new Map<string, Message>();
  for (const message of previous) {
    prevById.set(message.id, message);
  }

  // 既に割り当て済みのキーを二重に使わないように記録する。
  const usedKeys = new Set<string>();
  const resolved: (Message | null)[] = fetched.map((message) => {
    const existing = prevById.get(message.id);
    if (!existing) return null;
    const renderKey = existing.renderKey;
    usedKeys.add(renderKey ?? message.id);
    return renderKey ? { ...message, renderKey } : message;
  });

  return fetched.map((message, index) => {
    const matched = resolved[index];
    if (matched) return matched;

    const candidate = previous[index];
    if (
      candidate &&
      !isSavedMessageId(candidate.id) &&
      candidate.role === message.role
    ) {
      const inheritedKey = candidate.renderKey ?? candidate.id;
      if (!usedKeys.has(inheritedKey)) {
        usedKeys.add(inheritedKey);
        return { ...message, renderKey: inheritedKey };
      }
    }

    usedKeys.add(message.id);
    return message;
  });
}
