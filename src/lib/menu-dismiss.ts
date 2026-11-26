// 画面に固定して出すメニュー（AnswerMenu）を、ページのスクロールや画面の幅の変化で閉じる。
// 高さだけの変化（画面キーボードの出し入れ、アドレスバーの伸び縮み）では閉じずに位置を合わせ直す:
// layout.tsx の interactiveWidget: "resizes-content" のため、入力欄からメニューへフォーカスが移ってキーボードが下がると、
// 画面の高さが変わり、それに伴って会話の欄などが自分でスクロールする。これで開いた直後に閉じないようにする。
// 開いた直後と高さが変わった直後の短い間（SETTLE_MS）に起きた外側のスクロールは、そうした画面の変化によるものとみなす。
export const MENU_SETTLE_MS = 500;

export function watchMenuDismiss({ isInside, onClose, reposition, now = () => Date.now(), settleMs = MENU_SETTLE_MS }: {
  // スクロールした要素がメニューの中か（メニュー自身の中のスクロールでは閉じない）。
  isInside: (target: EventTarget | null) => boolean;
  onClose: () => void;
  reposition: () => void;
  now?: () => number;
  settleMs?: number;
}): () => void {
  const width = window.innerWidth;
  let settledAfter = now() + settleMs;
  const viewportChanged = () => {
    settledAfter = now() + settleMs;
    reposition();
  };
  // 幅が変わったときだけ閉じる（回転・ウィンドウの幅の変更）。
  const onResize = () => { if (window.innerWidth !== width) onClose(); else viewportChanged(); };
  const onScroll = (event: Event) => {
    if (isInside(event.target)) return;
    if (now() < settledAfter) { reposition(); return; }
    onClose();
  };
  const viewport = window.visualViewport;
  window.addEventListener("resize", onResize);
  viewport?.addEventListener("resize", viewportChanged);
  // スクロールは子要素のものも拾う（capture）。
  window.addEventListener("scroll", onScroll, { capture: true });
  return () => {
    window.removeEventListener("resize", onResize);
    viewport?.removeEventListener("resize", viewportChanged);
    window.removeEventListener("scroll", onScroll, { capture: true });
  };
}
