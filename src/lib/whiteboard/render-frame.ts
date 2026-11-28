"use client";

import { exportScene, isInvisiblySmallElement, restoreElements } from "@excalidraw/excalidraw";
import type { BinaryFiles } from "@excalidraw/excalidraw/types";
import { MAX_STORED_FILE_BYTES } from "@/lib/usage-plans";
import { toRenderableScene, type WhiteboardFileUrlMode } from "@/lib/whiteboard/frames";

// ホワイトボード全体、または指定した 1 つの枠（frame）を、エディターを開かずに保存済みデータから描画する共通モジュール。
// ノート埋め込みプレビュー・公開ノート内の白板プレビュー・編集履歴サムネイル・スライド用静止画スナップショットが共用する。
if (typeof window !== "undefined") {
  (window as unknown as { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = "/whiteboard/";
}

export type WhiteboardSvgResult =
  | { status: "ready"; svg: SVGSVGElement }
  | { status: "empty" }
  | { status: "missing-frame" };

export type WhiteboardSvgOptions = {
  frameId?: string | null;
  theme?: "light" | "dark";
  fileUrlMode?: WhiteboardFileUrlMode;
  padding?: number;
  canvasBackgroundColor?: string | false;
  ariaLabel?: string;
};

export type WhiteboardSnapshotResult =
  | { ok: true; blob: Blob; width: number; height: number; frameName: string | null }
  | { ok: false; reason: "empty" | "missing-frame" | "error" };

const MAX_SNAPSHOT_SIDE = 2400;
const MAX_SNAPSHOT_PIXELS = 4_800_000;

function snapshotScale(preferred: number) {
  return (width: number, height: number) =>
    Math.min(
      preferred,
      Math.sqrt(MAX_SNAPSHOT_PIXELS / Math.max(1, width * height)),
      MAX_SNAPSHOT_SIDE / Math.max(1, width, height),
    );
}

type RestoredElement = ReturnType<typeof restoreElements>[number];

type PreparedWhiteboardScene = {
  elements: RestoredElement[];
  visible: RestoredElement[];
  files: BinaryFiles;
  viewBackgroundColor: string;
};

// 同じ保存データ（data オブジェクト）から全体や複数枠を描画する際（ピッカー・ノート内複数埋め込みなど）、
// restoreElements の結果を共有して毎回ボード全体を復元し直さないようにする。
const preparedSceneCache = new WeakMap<object, Partial<Record<WhiteboardFileUrlMode, PreparedWhiteboardScene>>>();

function prepareElements(data: unknown, fileUrlMode: WhiteboardFileUrlMode): PreparedWhiteboardScene {
  if (typeof data === "object" && data !== null) {
    const bucket = preparedSceneCache.get(data);
    const cached = bucket?.[fileUrlMode];
    if (cached) return cached;
  }
  const scene = toRenderableScene(data, { fileUrlMode });
  const restored = restoreElements(scene.elements as never, null, { repairBindings: true })
    .filter((element) => !element.isDeleted);
  const prepared: PreparedWhiteboardScene = {
    elements: restored,
    visible: restored.filter((element) => !isInvisiblySmallElement(element)),
    files: scene.files as unknown as BinaryFiles,
    viewBackgroundColor: scene.appState.viewBackgroundColor ?? "#ffffff",
  };
  if (typeof data === "object" && data !== null) {
    const bucket = preparedSceneCache.get(data) ?? {};
    bucket[fileUrlMode] = prepared;
    preparedSceneCache.set(data, bucket);
  }
  return prepared;
}

let nextSvgIdPrefix = 0;

// 同じ画面に複数の SVG プレビュー（全体＋枠、複数枠など）を並べる時、Excalidraw が frame ID 等を
// そのまま clipPath id に使うと Chromium で別 SVG の clipPath を参照して誤って切り抜かれる。
// プレビューごとに SVG 内の id と url(#...) / href="#..." 参照へ一意の接頭辞を付けて隔離する。
export function isolateSvgIds(svg: SVGSVGElement, prefix: string): void {
  const idMap = new Map<string, string>();
  const tagged = svg.querySelectorAll("[id]");
  for (const el of tagged) {
    const oldId = el.getAttribute("id");
    if (!oldId) continue;
    const nextId = `${prefix}-${oldId}`;
    idMap.set(oldId, nextId);
    el.setAttribute("id", nextId);
  }
  if (!idMap.size) return;

  const rewriteUrls = (value: string) =>
    value.replace(/url\(\s*(['"]?)#([^)'"]+)\1\s*\)/g, (match, quote: string, id: string) => {
      const mapped = idMap.get(id);
      return mapped ? `url(${quote}#${mapped}${quote})` : match;
    });

  const nodes: Element[] = [svg, ...Array.from(svg.querySelectorAll("*"))];
  for (const node of nodes) {
    for (const attr of Array.from(node.attributes)) {
      if (attr.name === "id") continue;
      if ((attr.name === "href" || attr.name === "xlink:href") && attr.value.startsWith("#")) {
        const mapped = idMap.get(attr.value.slice(1));
        if (mapped) node.setAttribute(attr.name, `#${mapped}`);
      } else if (attr.value.includes("url(")) {
        const updated = rewriteUrls(attr.value);
        if (updated !== attr.value) node.setAttribute(attr.name, updated);
      }
    }
    if (node.tagName.toLowerCase() === "style" && node.textContent && node.textContent.includes("url(")) {
      const updated = rewriteUrls(node.textContent);
      if (updated !== node.textContent) node.textContent = updated;
    }
  }
}

function findRestoredFrame(elements: readonly RestoredElement[], frameId: string): RestoredElement | null {
  const found = elements.find((element) => element.type === "frame" && element.id === frameId);
  if (!found || found.type !== "frame" || Math.abs(found.width) <= 0 || Math.abs(found.height) <= 0) return null;
  return found;
}

// 保存済みデータから、ホワイトボード全体または 1 つの枠の SVG をオフスクリーン描画する。
export async function renderWhiteboardSvg(data: unknown, options: WhiteboardSvgOptions = {}): Promise<WhiteboardSvgResult> {
  const fileUrlMode = options.fileUrlMode ?? "owner";
  const { elements, visible, files, viewBackgroundColor } = prepareElements(data, fileUrlMode);
  const frameId = options.frameId?.trim() || "";
  const frame = frameId ? findRestoredFrame(elements, frameId) : null;
  if (frameId && !frame) return { status: "missing-frame" };

  if (!frame && !visible.length) return { status: "empty" };

  const targetElements = frame ? elements : visible;
  const svg = await exportScene({
    type: "svg",
    data: {
      elements: targetElements,
      files,
      appState: { viewBackgroundColor },
    } as never,
    config: {
      theme: options.theme ?? "light",
      canvasBackgroundColor: options.canvasBackgroundColor,
      ...(frame
        ? { exportingFrame: frame as never, padding: 0 }
        : { padding: options.padding ?? 16 }),
    },
  });

  isolateSvgIds(svg, `nf-wb-${++nextSvgIdPrefix}`);
  svg.removeAttribute("width");
  svg.removeAttribute("height");
  svg.setAttribute("role", "img");
  if (options.ariaLabel) svg.setAttribute("aria-label", options.ariaLabel);
  return { status: "ready", svg };
}

async function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality?: number): Promise<Blob | null> {
  return new Promise<Blob | null>((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob && blob.size > 0 ? blob : null), mimeType, quality);
    } catch {
      resolve(null);
    }
  });
}

async function fitSnapshotBlob(canvas: HTMLCanvasElement, maxBytes: number): Promise<Blob | null> {
  const png = await canvasToBlob(canvas, "image/png");
  if (!png) return null;
  if (png.size <= maxBytes) return png;
  for (const [mimeType, quality] of [
    ["image/webp", 0.92],
    ["image/webp", 0.82],
    ["image/jpeg", 0.9],
    ["image/jpeg", 0.8],
  ] as const) {
    const candidate = await canvasToBlob(canvas, mimeType, quality);
    if (candidate && candidate.size <= maxBytes) return candidate;
  }
  const scale = Math.min(1, 1600 / Math.max(1, canvas.width, canvas.height));
  if (scale >= 1) return png;
  const resized = document.createElement("canvas");
  try {
    resized.width = Math.max(1, Math.round(canvas.width * scale));
    resized.height = Math.max(1, Math.round(canvas.height * scale));
    const ctx = resized.getContext("2d");
    if (!ctx) return png;
    ctx.drawImage(canvas, 0, 0, resized.width, resized.height);
    const jpeg = await canvasToBlob(resized, "image/jpeg", 0.84);
    return jpeg && jpeg.size <= maxBytes ? jpeg : (jpeg ?? png);
  } finally {
    resized.width = 0;
    resized.height = 0;
  }
}

// スライドへ置く静止画スナップショット（浅色 PNG、上限超過時は WebP/JPEG で圧縮）をオフスクリーン描画する。
export async function renderWhiteboardSnapshot(
  data: unknown,
  options?: { frameId?: string | null; maxBytes?: number },
): Promise<WhiteboardSnapshotResult> {
  const { elements, visible, files, viewBackgroundColor } = prepareElements(data, "owner");
  const frameId = options?.frameId?.trim() || "";
  const frame = frameId ? findRestoredFrame(elements, frameId) : null;
  if (frameId && !frame) return { ok: false, reason: "missing-frame" };

  if (!frame && !visible.length) return { ok: false, reason: "empty" };

  let canvas: HTMLCanvasElement | null = null;
  try {
    canvas = await exportScene({
      type: "canvas",
      data: {
        elements: frame ? elements : visible,
        files,
        appState: { viewBackgroundColor },
      } as never,
      config: {
        theme: "light",
        scale: snapshotScale(2),
        ...(frame ? { exportingFrame: frame as never, padding: 0 } : { padding: 32 }),
      },
    });
    if (!canvas || !canvas.width || !canvas.height) return { ok: false, reason: "empty" };
    const width = canvas.width;
    const height = canvas.height;
    const blob = await fitSnapshotBlob(canvas, options?.maxBytes ?? MAX_STORED_FILE_BYTES);
    if (!blob) return { ok: false, reason: "error" };
    const frameName = frame && "name" in frame && typeof frame.name === "string" && frame.name.trim() ? frame.name.trim() : null;
    return { ok: true, blob, width, height, frameName };
  } catch {
    return { ok: false, reason: "error" };
  } finally {
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}
