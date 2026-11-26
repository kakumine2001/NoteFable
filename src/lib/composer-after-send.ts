// 送信したあとに入力欄から「送った分」だけを取り除く。送信を待つ間に書き足した本文や、足した添付は消さない。

// 入力欄の今の本文から、送った本文を取り除いた残り。送った本文のまま → 空。送った本文の後ろに書き足した → 書き足した分。
// 書き換えられていて送った本文で始まらない → そのまま残す（別の下書きなので消さない）。
export function remainingComposerText(live: string, submitted: string): string {
  if (live === submitted) return "";
  if (live.startsWith(submitted)) return live.slice(submitted.length).trimStart();
  return live;
}

// 一覧（添付・ページ）から、送ったものだけを外す。同じものかは key で比べる。
export function withoutSent<T>(current: readonly T[], sent: readonly T[], key: (item: T) => unknown): T[] {
  const sentKeys = new Set(sent.map(key));
  return current.filter((item) => !sentKeys.has(key(item)));
}
