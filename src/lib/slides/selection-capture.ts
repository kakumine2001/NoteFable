import type { SlideCapture } from "@/lib/slides/export-files";
import { elementsBounds, type Box } from "@/lib/slides/geometry";
import { SLIDE_HEIGHT, SLIDE_WIDTH, type Slide } from "@/lib/slides/model";
import { resolveColor, type ResolvedTheme } from "@/lib/slides/themes";

// 選区を AI へ送る PNG の長辺上限（D5）。
export const MAX_SLIDE_SELECTION_SIDE = 1568;
const CROP_PADDING = 32;
export const SLIDE_CAPTURE_TIMEOUT_MS = 10_000;

function raceTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Slide capture timed out")), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

// 選んだ要素があれば、その外接矩形に少し余白を足してスライド内へ収めた切り抜き範囲を返す。
// 要素を選んでいない（枚全体）か、一致する要素が無いときは null（1 枚全体を使う）。
export function slideSelectionCropRect(slide: Slide, elementIds: readonly string[], padding = CROP_PADDING): Box | null {
  if (!elementIds.length) return null;
  const chosen = new Set(elementIds);
  const selected = slide.elements.filter((element) => chosen.has(element.id));
  const bounds = elementsBounds(selected);
  if (!bounds) return null;
  const left = Math.max(0, Math.floor(bounds.x - padding));
  const top = Math.max(0, Math.floor(bounds.y - padding));
  const right = Math.min(SLIDE_WIDTH, Math.ceil(bounds.x + bounds.w + padding));
  const bottom = Math.min(SLIDE_HEIGHT, Math.ceil(bounds.y + bounds.h + padding));
  const w = right - left;
  const h = bottom - top;
  if (w < 1 || h < 1) return null;
  return { x: left, y: top, w, h };
}

// 長辺が maxSide を超えない出力サイズ（元の論理サイズを超えて拡大はしない）。
export function scaledSlideDimensions(width: number, height: number, maxSide = MAX_SLIDE_SELECTION_SIDE): { width: number; height: number } {
  const safeW = Math.max(1, Math.round(width));
  const safeH = Math.max(1, Math.round(height));
  const longest = Math.max(safeW, safeH);
  if (longest <= maxSide) return { width: safeW, height: safeH };
  const ratio = maxSide / longest;
  return {
    width: Math.max(1, Math.floor(safeW * ratio)),
    height: Math.max(1, Math.floor(safeH * ratio)),
  };
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob && blob.size > 0 ? blob : null), "image/png");
    } catch {
      resolve(null);
    }
  });
}

// 選んだスライド（または要素の切り抜き）を長辺 <= 1568px の PNG Blob として描く。
// 要素を選んだのにスライド外で可視の切り抜きが無いときは、関係のないスライド全体を送らず null（文字のみへ降格）を返す。
export async function captureSlideSelectionPng(
  capture: SlideCapture,
  slide: Slide,
  theme: ResolvedTheme,
  elementIds: readonly string[],
  timeoutMs = SLIDE_CAPTURE_TIMEOUT_MS,
): Promise<Blob | null> {
  const hasElementSelection = elementIds.length > 0;
  const crop = hasElementSelection ? slideSelectionCropRect(slide, elementIds) : null;
  if (hasElementSelection && !crop) return null;
  const background = resolveColor(slide.background ?? "background", theme, "background");
  let sourceCanvas: HTMLCanvasElement | null = null;
  let outputCanvas: HTMLCanvasElement | null = null;
  try {
    const { domToCanvas } = await import("modern-screenshot");
    const node = await raceTimeout(capture.renderSlide(slide), timeoutMs);
    // 切り抜き時は 1:1（1920x1080）で描いて切り出し後に上限へ収め、全体時は最初から長辺 1568px で描く。
    const renderScale = crop ? 1 : MAX_SLIDE_SELECTION_SIDE / Math.max(SLIDE_WIDTH, SLIDE_HEIGHT);
    sourceCanvas = await raceTimeout(
      domToCanvas(node, { width: SLIDE_WIDTH, height: SLIDE_HEIGHT, scale: renderScale, backgroundColor: background }),
      timeoutMs,
    );
    if (!sourceCanvas.width || !sourceCanvas.height) return null;

    if (crop) {
      const target = scaledSlideDimensions(crop.w, crop.h, MAX_SLIDE_SELECTION_SIDE);
      outputCanvas = document.createElement("canvas");
      outputCanvas.width = target.width;
      outputCanvas.height = target.height;
      const ctx = outputCanvas.getContext("2d");
      if (!ctx) return null;
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, target.width, target.height);
      const sx = Math.min(sourceCanvas.width - 1, Math.max(0, Math.round(crop.x * (sourceCanvas.width / SLIDE_WIDTH))));
      const sy = Math.min(sourceCanvas.height - 1, Math.max(0, Math.round(crop.y * (sourceCanvas.height / SLIDE_HEIGHT))));
      const sw = Math.max(1, Math.min(sourceCanvas.width - sx, Math.round(crop.w * (sourceCanvas.width / SLIDE_WIDTH))));
      const sh = Math.max(1, Math.min(sourceCanvas.height - sy, Math.round(crop.h * (sourceCanvas.height / SLIDE_HEIGHT))));
      ctx.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, target.width, target.height);
      return await canvasToPngBlob(outputCanvas);
    }

    if (sourceCanvas.width > MAX_SLIDE_SELECTION_SIDE || sourceCanvas.height > MAX_SLIDE_SELECTION_SIDE) {
      const target = scaledSlideDimensions(sourceCanvas.width, sourceCanvas.height, MAX_SLIDE_SELECTION_SIDE);
      outputCanvas = document.createElement("canvas");
      outputCanvas.width = target.width;
      outputCanvas.height = target.height;
      const ctx = outputCanvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(sourceCanvas, 0, 0, target.width, target.height);
      return await canvasToPngBlob(outputCanvas);
    }

    return await canvasToPngBlob(sourceCanvas);
  } catch {
    return null;
  } finally {
    if (sourceCanvas) { sourceCanvas.width = 0; sourceCanvas.height = 0; }
    if (outputCanvas) { outputCanvas.width = 0; outputCanvas.height = 0; }
    capture.done();
  }
}
