// ノートの AI ボタン（右下の丸いボタン）を好きな場所へ動かすための計算。位置は画面の右端・下端からの距離（px）で持つ。
export type FabPosition = { right: number; bottom: number };

// 画面の端からこれより近くへは寄せない。
export const FAB_MARGIN = 8;
// これより小さい動きは「押した」とみなし、ドラッグにしない。
export const FAB_DRAG_THRESHOLD = 5;

const STORAGE_KEY = "notefable:note-ai-fab";

// ボタン全体が画面の中に収まるように位置を直す。
export function clampFabPosition(position: FabPosition, size: number, viewportWidth: number, viewportHeight: number): FabPosition {
  const clamp = (value: number, viewport: number) => Math.min(Math.max(value, FAB_MARGIN), Math.max(FAB_MARGIN, viewport - size - FAB_MARGIN));
  return { right: clamp(position.right, viewportWidth), bottom: clamp(position.bottom, viewportHeight) };
}

// 動かしたボタンに合わせて、パネル（PC）を出す場所を決める。ボタンが画面の下半分にあれば上へ、上半分にあれば下へ開く。
export function panelPlacement(position: FabPosition, size: number, panelWidth: number, viewportWidth: number, viewportHeight: number) {
  const gap = 8;
  const edge = 20;
  const right = Math.min(Math.max(position.right, edge), Math.max(edge, viewportWidth - panelWidth - edge));
  const top = viewportHeight - position.bottom - size;
  const above = top + size / 2 > viewportHeight / 2;
  return above
    ? { right, bottom: position.bottom + size + gap, top: "auto" as const, maxHeight: Math.max(0, top - gap - edge) }
    : { right, top: top + size + gap, bottom: "auto" as const, maxHeight: Math.max(0, position.bottom - gap - edge) };
}

// エディターが用意した置き場所（目印の要素の画面上の四角）に、ボタンを重ねる位置。目印が描かれていない（大きさ 0）なら null。
export function anchorFabPosition(rect: { right: number; bottom: number; width: number; height: number }, viewportWidth: number, viewportHeight: number): FabPosition | null {
  if (!rect.width && !rect.height) return null;
  return { right: viewportWidth - rect.right, bottom: viewportHeight - rect.bottom };
}

export function loadFabPosition(): FabPosition | null {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");
    if (!value || typeof value !== "object") return null;
    const { right, bottom } = value as Record<string, unknown>;
    return typeof right === "number" && typeof bottom === "number" && Number.isFinite(right) && Number.isFinite(bottom) ? { right, bottom } : null;
  } catch {
    return null;
  }
}

export function saveFabPosition(position: FabPosition) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(position));
  } catch { /* 保存できなくても、この画面の間は動かした位置のまま使える。 */ }
}
