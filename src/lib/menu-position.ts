type Rect = { top: number; bottom: number; left: number; right: number };

// 「…」ボタン（anchor）から開くメニューの位置。左端はボタンにそろえ（右から左に書く言語では右端）、ボタンの下 4 に出す。
// 下に入らなければボタンの上に出し、どちらにしても画面の端から 8 以上離して画面の中に収める。
export function menuPosition(anchor: Rect, size: { width: number; height: number }, viewport: { width: number; height: number }, rtl: boolean) {
  const below = anchor.bottom + 4;
  const preferredLeft = rtl ? anchor.right - size.width : anchor.left;
  const preferredTop = below + size.height <= viewport.height - 8 ? below : anchor.top - size.height - 4;
  return {
    left: Math.max(8, Math.min(preferredLeft, viewport.width - size.width - 8)),
    top: Math.max(8, Math.min(preferredTop, viewport.height - size.height - 8)),
  };
}
