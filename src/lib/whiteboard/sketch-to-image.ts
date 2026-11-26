import type { GenerateImageSize } from "@/lib/page-images";
import { generatedImageDataOf } from "@/lib/whiteboard/scene";

// ホワイトボードのスケッチ変換（選択した要素の横に完成画像を並べる計算と、読み取り専用時の AI 画像ヒット判定）。
// Excalidraw 本体に依存しない純粋関数だけ置く。

export type SketchBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PlacedImageBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const ASPECT_THRESHOLD = 1.2;
const DEFAULT_GAP = 48;
const DEFAULT_MIN_SIDE = 220;
const DEFAULT_MAX_SIDE = 720;

// 選択したスケッチの縦横比から、もっとも近い初期アスペクト比を選ぶ。
export function chooseSketchAspectSize(width: number, height: number): GenerateImageSize {
  const safeW = Number.isFinite(width) && width > 0 ? width : 1;
  const safeH = Number.isFinite(height) && height > 0 ? height : 1;
  const ratio = safeW / safeH;
  if (ratio >= ASPECT_THRESHOLD) return "1536x1024";
  if (ratio <= 1 / ASPECT_THRESHOLD) return "1024x1536";
  return "1024x1024";
}

// スケッチから作った画像を、元のスケッチを壊さず右隣に余白を空けて配置する。
// 画像の自然な縦横比を保ち、元のスケッチの大きさに合わせて [minSide, maxSide] の範囲に収める。
export function placeSketchGeneratedImage(
  selection: SketchBounds,
  naturalWidth: number,
  naturalHeight: number,
  options?: { gap?: number; minSide?: number; maxSide?: number },
): PlacedImageBox {
  const gap = options?.gap ?? DEFAULT_GAP;
  const minSide = options?.minSide ?? DEFAULT_MIN_SIDE;
  const maxSide = options?.maxSide ?? DEFAULT_MAX_SIDE;
  const safeSelW = Number.isFinite(selection.width) && selection.width > 0 ? selection.width : 1;
  const safeSelH = Number.isFinite(selection.height) && selection.height > 0 ? selection.height : 1;
  const safeImgW = Number.isFinite(naturalWidth) && naturalWidth > 0 ? naturalWidth : 1536;
  const safeImgH = Number.isFinite(naturalHeight) && naturalHeight > 0 ? naturalHeight : 1024;

  const targetMaxSide = Math.min(maxSide, Math.max(minSide, Math.max(safeSelW, safeSelH)));
  const scale = targetMaxSide / Math.max(safeImgW, safeImgH);
  const width = Math.max(64, Math.round(safeImgW * scale));
  const height = Math.max(64, Math.round(safeImgH * scale));
  const x = Math.round(selection.x + safeSelW + gap);
  const y = Math.round(selection.y + (safeSelH - height) / 2);
  return { x, y, width, height };
}

export type HitTestElement = {
  id: string;
  type: string;
  isDeleted?: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  angle?: number;
  customData?: unknown;
};

// ロック中（読み取り専用）のホワイトボードでも AI 生成画像をクリックして報告できるよう、
// シーン座標から最前面の AI 生成画像要素を判定する。
export function hitTestGeneratedImage(
  elements: readonly HitTestElement[],
  point: { x: number; y: number },
): string | null {
  for (let index = elements.length - 1; index >= 0; index -= 1) {
    const element = elements[index];
    if (element.isDeleted || element.type !== "image") continue;
    if (!generatedImageDataOf(element.customData)) continue;
    const width = Math.abs(element.width);
    const height = Math.abs(element.height);
    if (width <= 0 || height <= 0) continue;
    const cx = element.x + element.width / 2;
    const cy = element.y + element.height / 2;
    const dx = point.x - cx;
    const dy = point.y - cy;
    const angle = typeof element.angle === "number" && Number.isFinite(element.angle) ? element.angle : 0;
    const cos = Math.cos(-angle);
    const sin = Math.sin(-angle);
    const localX = dx * cos - dy * sin;
    const localY = dx * sin + dy * cos;
    if (Math.abs(localX) <= width / 2 && Math.abs(localY) <= height / 2) {
      return element.id;
    }
  }
  return null;
}
