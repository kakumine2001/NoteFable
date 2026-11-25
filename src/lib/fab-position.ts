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

export type BubblePlacement = {
  side: "left" | "right";
  style: { left?: number; right?: number; bottom: number; maxWidth: number };
};

// 選択中にマスコットの横へ出す「Ask NoteFable」吹き出しの位置。画面中央側へ向けて出す。
export function bubblePlacement(
  fab: FabPosition | null,
  fabSize: number,
  viewportWidth: number,
  viewportHeight: number,
  dir: "ltr" | "rtl",
  phone: boolean,
): BubblePlacement {
  const edge = phone ? 16 : 20;
  const raw = fab ?? (dir === "rtl"
    ? { right: Math.max(FAB_MARGIN, viewportWidth - edge - fabSize), bottom: edge }
    : { right: edge, bottom: edge });
  const pos = clampFabPosition(raw, fabSize, viewportWidth, viewportHeight);
  const fabCenterX = viewportWidth - pos.right - fabSize / 2;
  const side: "left" | "right" = fabCenterX >= viewportWidth / 2 ? "left" : "right";
  const bottom = Math.min(Math.max(pos.bottom + fabSize / 2, 24), Math.max(24, viewportHeight - 24));
  const gap = 12;
  if (side === "left") {
    const right = pos.right + fabSize + gap;
    const available = viewportWidth - right - 12;
    return {
      side,
      style: { right, bottom, maxWidth: Math.max(150, Math.min(280, available - 16)) },
    };
  }
  const left = viewportWidth - pos.right + gap;
  const available = pos.right - gap - 12;
  return {
    side,
    style: { left, bottom, maxWidth: Math.max(150, Math.min(280, available - 16)) },
  };
}

// エディターが用意した置き場所（目印の要素の画面上の四角）に、ボタンを重ねる位置。目印が描かれていない（大きさ 0）なら null。
export function anchorFabPosition(rect: { right: number; bottom: number; width: number; height: number }, viewportWidth: number, viewportHeight: number): FabPosition | null {
  if (!rect.width && !rect.height) return null;
  return { right: viewportWidth - rect.right, bottom: viewportHeight - rect.bottom };
}

// 置き場所の位置が変わるときに大きさが変わる要素：目印から stop（body）の手前までの親すべて。
// offsetParent と違い、ワークスペースが隠れている（display: none）間に作られても辿れる。
export function anchorAncestors<T extends { parentElement: T | null }>(anchor: T, stop: T | null): T[] {
  const out: T[] = [];
  for (let element: T | null = anchor; element && element !== stop; element = element.parentElement) out.push(element);
  return out;
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
