// 検索の結果から開いたホワイトボードで、一致した要素まで動かす（ノートの revealNoteBlock のホワイトボード版）。
// ホワイトボードのエディターは動的に読み込むので、開いた直後はまだ無い。依頼をここに預け、エディターが用意できた時に受け取る。
// すでに開いているエディターにはイベントで知らせる。依頼は 1 回だけ使い、古くなったら捨てる。

export const WHITEBOARD_REVEAL_EVENT = "notefable:whiteboard-reveal";
export type WhiteboardRevealDetail = { pageId: string; elementId: string };

const TTL_MS = 15_000;
let pending: (WhiteboardRevealDetail & { expires: number }) | null = null;

export function requestWhiteboardReveal(pageId: string, elementId: string, now = Date.now()) {
  pending = { pageId, elementId, expires: now + TTL_MS };
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<WhiteboardRevealDetail>(WHITEBOARD_REVEAL_EVENT, { detail: { pageId, elementId } }));
}

// このページ宛ての依頼があれば、要素の ID を返して依頼を消す。
export function consumeWhiteboardReveal(pageId: string, now = Date.now()): string | null {
  if (!pending) return null;
  if (pending.expires < now) { pending = null; return null; }
  if (pending.pageId !== pageId) return null;
  const { elementId } = pending;
  pending = null;
  return elementId;
}

export function cancelWhiteboardReveal() {
  pending = null;
}
