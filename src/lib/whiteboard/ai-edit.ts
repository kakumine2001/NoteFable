import { convertToExcalidrawElements, setCustomTextMetricsProvider } from "@excalidraw/element";
import type { ExcalidrawElementSkeleton } from "@excalidraw/element/transform";
import { MAX_CANVAS_BYTES, MAX_WHITEBOARD_ELEMENTS, validateCanvasData } from "@/lib/canvas-document";
import { NoteValidationError } from "@/lib/note-document";
import type { ProposalChange } from "@/lib/page-ai/types";
import { EDGE_GAP, NUNITO_FONT_FAMILY, randomElementId } from "@/lib/whiteboard/mindmap/elements";
import { deleteMindmapNodes, mindmapFinder, readMindmapTrees, relayoutMindmaps, type MindmapChange, type SceneElement } from "@/lib/whiteboard/mindmap/editing";
import { mindmapDataOf } from "@/lib/whiteboard/mindmap/model";
import { sceneToStored, storedSize, storedToScene, type StoredWhiteboard, type WhiteboardElement } from "@/lib/whiteboard/scene";
import { withServerDom } from "@/lib/whiteboard/server-dom";
import { estimateLineWidth, wrapText } from "@/lib/whiteboard/text-measure";

// AI のホワイトボード作成・編集エンジン（純粋 TS、座標はすべてサーバー側で決定論的に計算）。
// モデルはピクセル座標を一切出さず、構造化された操作（要素の追加・接続・更新・削除・枠への移動・整列・グループ化）だけを渡す。
// 新規要素は @excalidraw/element の convertToExcalidrawElements（withServerDom 内）で本物の Excalidraw 要素として生成し、
// sceneToStored + validateCanvasData("whiteboard", ...) を通して保存時と完全に同じ検証をかける。

export class WhiteboardEditError extends Error {}

export const MAX_AI_WHITEBOARD_OPS = 50;
export const MAX_AI_CREATE_ITEMS = 120;
export const MAX_AI_CREATE_FRAMES = 24;
export const MAX_AI_CREATE_CONNECTIONS = 150;
export const MAX_AI_TEXT_LENGTH = 2_000;
const MAX_FRAME_NAME_LENGTH = 120;
const ELEMENT_GAP = 36;
const CLUSTER_GAP = 24;
const FRAME_PADDING = 44;
const FRAME_TOP_PADDING = 52;
const DEFAULT_FRAME_WIDTH = 480;
const DEFAULT_FRAME_HEIGHT = 320;
const INLINE_DATA = /^\s*data:/i;
const FILE_URL = /^\s*\/api\/pages\/files\?/i;
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export const AI_SHAPE_TYPES = ["rectangle", "ellipse", "diamond", "stickynote", "text"] as const;
export type AiShapeType = (typeof AI_SHAPE_TYPES)[number];
export const AI_STROKE_STYLES = ["solid", "dashed", "dotted"] as const;
export type AiStrokeStyle = (typeof AI_STROKE_STYLES)[number];
export const AI_FONT_SIZES = ["small", "medium", "large", "xl"] as const;
export type AiFontSize = (typeof AI_FONT_SIZES)[number];
export const AI_PLACEMENTS = ["right", "below", "left", "above"] as const;
export type AiPlacement = (typeof AI_PLACEMENTS)[number];
export const AI_LAYOUTS = ["row", "column", "grid", "cluster"] as const;
export type AiLayout = (typeof AI_LAYOUTS)[number];

const FONT_SIZE_PX: Record<AiFontSize, number> = { small: 16, medium: 20, large: 28, xl: 36 };

type ColorSwatch = { stroke: string; fill: string };

const NAMED_COLORS: Record<string, ColorSwatch> = {
  default: { stroke: "#1e1e1e", fill: "transparent" },
  neutral: { stroke: "#1e1e1e", fill: "transparent" },
  yellow: { stroke: "#e67700", fill: "#fff3bf" },
  blue: { stroke: "#1971c2", fill: "#d0ebff" },
  green: { stroke: "#2f9e44", fill: "#d3f9d8" },
  orange: { stroke: "#e8590c", fill: "#ffe8cc" },
  red: { stroke: "#e03131", fill: "#ffc9c9" },
  purple: { stroke: "#9c36b5", fill: "#f3d9fa" },
  teal: { stroke: "#0c8599", fill: "#c5f6fa" },
  pink: { stroke: "#c2255c", fill: "#ffdeeb" },
  gray: { stroke: "#495057", fill: "#f1f3f5" },
  grey: { stroke: "#495057", fill: "#f1f3f5" },
};

const STICKY_DEFAULT: ColorSwatch = { stroke: "#e67700", fill: "#fff3bf" };

let metricsReady = false;
function ensureTextMetrics() {
  if (metricsReady) return;
  metricsReady = true;
  setCustomTextMetricsProvider({ getLineWidth: (text, font) => estimateLineWidth(text, Number.parseFloat(font) || 20) });
}

function sanitizeText(raw: string, maxLength = MAX_AI_TEXT_LENGTH): string {
  const cleaned = raw.replace(/\r\n?/g, "\n").replace(/\u0000/g, "").replace(LONE_SURROGATE, "").trim();
  const guarded = INLINE_DATA.test(cleaned)
    ? cleaned.replace(/data:/i, "data :")
    : FILE_URL.test(cleaned)
      ? cleaned.replace(/files\?/i, "files ?")
      : cleaned;
  return guarded.length > maxLength ? guarded.slice(0, maxLength).trimEnd() : guarded;
}

function resolveColors(type: string, color: string | null | undefined): { strokeColor: string; backgroundColor: string } {
  const key = typeof color === "string" ? color.trim().toLowerCase() : "";
  if (!key || key === "default" || key === "neutral") {
    if (type === "stickynote") return { strokeColor: STICKY_DEFAULT.stroke, backgroundColor: STICKY_DEFAULT.fill };
    return { strokeColor: "#1e1e1e", backgroundColor: "transparent" };
  }
  const named = NAMED_COLORS[key];
  if (named) {
    if (type === "text" || type === "arrow" || type === "line") return { strokeColor: named.stroke, backgroundColor: "transparent" };
    return { strokeColor: named.stroke, backgroundColor: named.fill };
  }
  if (HEX_COLOR.test(key)) {
    if (type === "text" || type === "arrow" || type === "line") return { strokeColor: key, backgroundColor: "transparent" };
    return { strokeColor: "#1e1e1e", backgroundColor: key };
  }
  throw new WhiteboardEditError(`Unsupported color "${color}". Use a color name (default, yellow, blue, green, orange, red, purple, teal, pink, gray) or a hex color like #d0ebff.`);
}

function fontSizePx(preset: AiFontSize | null | undefined, fallback = 20): number {
  return preset ? FONT_SIZE_PX[preset] : fallback;
}

type Box = { x: number; y: number; width: number; height: number };

function measureBox(type: AiShapeType, text: string, fontSize: number): { width: number; height: number; wrapped: string } {
  const maxLineWidth = type === "text" ? 360 : type === "stickynote" ? 220 : 240;
  const lines = text ? wrapText(text, fontSize, maxLineWidth) : [""];
  const longest = Math.max(0, ...lines.map((line) => estimateLineWidth(line, fontSize)));
  const lineHeight = fontSize * 1.28;
  const textHeight = Math.max(lineHeight, lines.length * lineHeight);
  const wrapped = lines.join("\n");

  if (type === "text") {
    return {
      width: Math.max(40, Math.ceil(longest + 12)),
      height: Math.max(Math.ceil(lineHeight), Math.ceil(textHeight + 4)),
      wrapped,
    };
  }
  if (type === "stickynote") {
    const width = Math.max(180, Math.min(280, Math.ceil(longest + 44)));
    const height = Math.max(140, Math.ceil(textHeight + 52));
    return { width, height, wrapped };
  }
  if (type === "ellipse") {
    const width = Math.max(168, Math.ceil(longest * 1.28 + 48));
    const height = Math.max(88, Math.ceil(textHeight * 1.35 + 36));
    return { width, height, wrapped };
  }
  if (type === "diamond") {
    const width = Math.max(184, Math.ceil(longest * 1.48 + 56));
    const height = Math.max(112, Math.ceil(textHeight * 1.55 + 48));
    return { width, height, wrapped };
  }
  // rectangle
  const width = Math.max(150, Math.ceil(longest + 40));
  const height = Math.max(64, Math.ceil(textHeight + 28));
  return { width, height, wrapped };
}

export function elementBounds(el: WhiteboardElement): Box {
  const x = typeof el.x === "number" && Number.isFinite(el.x) ? el.x : 0;
  const y = typeof el.y === "number" && Number.isFinite(el.y) ? el.y : 0;
  if ((el.type === "arrow" || el.type === "line" || el.type === "freedraw") && Array.isArray(el.points) && el.points.length) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const pt of el.points) {
      if (!Array.isArray(pt) || pt.length < 2 || typeof pt[0] !== "number" || typeof pt[1] !== "number") continue;
      const px = x + pt[0];
      const py = y + pt[1];
      if (px < minX) minX = px;
      if (py < minY) minY = py;
      if (px > maxX) maxX = px;
      if (py > maxY) maxY = py;
    }
    if (Number.isFinite(minX)) {
      return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
    }
  }
  const width = typeof el.width === "number" && Number.isFinite(el.width) ? Math.abs(el.width) : 0;
  const height = typeof el.height === "number" && Number.isFinite(el.height) ? Math.abs(el.height) : 0;
  return { x, y, width, height };
}

function unionBoxes(boxes: readonly Box[]): Box | null {
  if (!boxes.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const box of boxes) {
    if (box.x < minX) minX = box.x;
    if (box.y < minY) minY = box.y;
    if (box.x + box.width > maxX) maxX = box.x + box.width;
    if (box.y + box.height > maxY) maxY = box.y + box.height;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function boxesOverlap(a: Box, b: Box, gap = 20): boolean {
  return a.x < b.x + b.width + gap && a.x + a.width + gap > b.x && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;
}

function findFreePosition(desired: { x: number; y: number }, size: { width: number; height: number }, obstacles: readonly Box[], direction: AiPlacement = "right", gap = ELEMENT_GAP): { x: number; y: number } {
  let x = Math.round(desired.x);
  let y = Math.round(desired.y);
  for (let step = 0; step < 64; step++) {
    const candidate: Box = { x, y, width: size.width, height: size.height };
    const hit = obstacles.find((box) => boxesOverlap(candidate, box, gap - 8));
    if (!hit) return { x, y };
    if (direction === "right") x = Math.round(hit.x + hit.width + gap);
    else if (direction === "left") x = Math.round(hit.x - size.width - gap);
    else if (direction === "above") y = Math.round(hit.y - size.height - gap);
    else y = Math.round(hit.y + hit.height + gap);
  }
  return { x, y };
}

function computeArrowGeometry(from: Box, to: Box) {
  const fromCx = from.x + from.width / 2;
  const fromCy = from.y + from.height / 2;
  const toCx = to.x + to.width / 2;
  const toCy = to.y + to.height / 2;
  const dx = toCx - fromCx;
  const dy = toCy - fromCy;

  let startX: number;
  let startY: number;
  let endX: number;
  let endY: number;
  let startFixedPoint: [number, number];
  let endFixedPoint: [number, number];

  if (Math.abs(dx) >= Math.abs(dy)) {
    const goRight = dx >= 0;
    startX = goRight ? from.x + from.width + EDGE_GAP : from.x - EDGE_GAP;
    startY = fromCy;
    endX = goRight ? to.x - EDGE_GAP : to.x + to.width + EDGE_GAP;
    endY = toCy;
    startFixedPoint = goRight ? [1, 0.5001] : [0, 0.5001];
    endFixedPoint = goRight ? [0, 0.5001] : [1, 0.5001];
  } else {
    const goDown = dy >= 0;
    startX = fromCx;
    startY = goDown ? from.y + from.height + EDGE_GAP : from.y - EDGE_GAP;
    endX = toCx;
    endY = goDown ? to.y - EDGE_GAP : to.y + to.height + EDGE_GAP;
    startFixedPoint = goDown ? [0.5001, 1] : [0.5001, 0];
    endFixedPoint = goDown ? [0.5001, 0] : [0.5001, 1];
  }

  const relDx = endX - startX;
  const relDy = endY - startY;
  return {
    x: startX,
    y: startY,
    width: Math.abs(relDx),
    height: Math.abs(relDy),
    points: [[0, 0], [relDx, relDy]] as [number, number][],
    startFixedPoint,
    endFixedPoint,
  };
}

function makeShapeSkeleton(opts: {
  id: string;
  type: AiShapeType;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  fontSize: number;
  color?: string | null;
  strokeStyle?: AiStrokeStyle | null;
  frameId?: string | null;
}): Record<string, unknown> {
  const colors = resolveColors(opts.type, opts.color);
  if (opts.type === "text") {
    return {
      id: opts.id,
      type: "text",
      x: opts.x,
      y: opts.y,
      width: opts.width,
      height: opts.height,
      text: opts.text || "Text",
      fontSize: opts.fontSize,
      fontFamily: NUNITO_FONT_FAMILY,
      textAlign: "left",
      verticalAlign: "top",
      strokeColor: colors.strokeColor,
      roughness: 0,
      ...(opts.frameId ? { frameId: opts.frameId } : {}),
    };
  }
  const base: Record<string, unknown> = {
    id: opts.id,
    type: opts.type,
    x: opts.x,
    y: opts.y,
    width: opts.width,
    height: opts.height,
    strokeColor: colors.strokeColor,
    backgroundColor: colors.backgroundColor,
    fillStyle: "solid",
    strokeWidth: opts.type === "stickynote" ? 1 : 2,
    strokeStyle: opts.strokeStyle ?? "solid",
    roughness: 0,
    ...(opts.type === "rectangle" ? { roundness: { type: 3 } } : {}),
    ...(opts.frameId ? { frameId: opts.frameId } : {}),
  };
  if (opts.text) {
    base.label = {
      text: opts.text,
      fontSize: opts.fontSize,
      fontFamily: NUNITO_FONT_FAMILY,
      textAlign: "center",
      verticalAlign: "middle",
      strokeColor: "#1e1e1e",
    };
  }
  return base;
}

function makeArrowSkeleton(opts: {
  id: string;
  from: WhiteboardElement;
  to: WhiteboardElement;
  label?: string;
  color?: string | null;
  strokeStyle?: AiStrokeStyle | null;
  frameId?: string | null;
}): Record<string, unknown> {
  const geom = computeArrowGeometry(elementBounds(opts.from), elementBounds(opts.to));
  const colors = resolveColors("arrow", opts.color);
  const skeleton: Record<string, unknown> = {
    id: opts.id,
    type: "arrow",
    x: geom.x,
    y: geom.y,
    points: geom.points,
    strokeColor: colors.strokeColor,
    strokeWidth: 2,
    strokeStyle: opts.strokeStyle ?? "solid",
    roughness: 0,
    roundness: { type: 2 },
    startArrowhead: null,
    endArrowhead: "arrow",
    ...(opts.frameId ? { frameId: opts.frameId } : {}),
  };
  if (opts.label) {
    skeleton.label = {
      text: opts.label,
      fontSize: 16,
      fontFamily: NUNITO_FONT_FAMILY,
      textAlign: "center",
      verticalAlign: "middle",
      strokeColor: "#1e1e1e",
    };
  }
  return skeleton;
}

function convertSkeletons(skeletons: readonly Record<string, unknown>[]): WhiteboardElement[] {
  ensureTextMetrics();
  return withServerDom(() => {
    const raw = convertToExcalidrawElements(skeletons as unknown as ExcalidrawElementSkeleton[], { regenerateIds: false });
    return (raw as unknown as WhiteboardElement[]).map((el) => ({ ...el, roughness: 0 }));
  });
}

function addBoundRef(el: WhiteboardElement, ref: { id: string; type: string }) {
  const existing = Array.isArray(el.boundElements) ? (el.boundElements as { id: string; type: string }[]) : [];
  if (existing.some((item) => item && item.id === ref.id)) return;
  el.boundElements = [...existing, ref];
}

function removeBoundRefs(el: WhiteboardElement, removedIds: ReadonlySet<string>) {
  if (!Array.isArray(el.boundElements)) return;
  const filtered = (el.boundElements as { id: string; type: string }[]).filter((item) => item && !removedIds.has(item.id));
  el.boundElements = filtered.length ? filtered : null;
}

const TEXT_CONTAINER_TYPES = new Set(["rectangle", "ellipse", "diamond", "stickynote", "arrow"]);

function fitBoundLabel(
  target: WhiteboardElement,
  bound: WhiteboardElement,
  text: string,
  fontSize: number,
  movedIds: Set<string>,
  obstacles?: readonly Box[],
) {
  const textMeasured = measureBox("text", text || " ", fontSize);
  bound.text = textMeasured.wrapped;
  bound.originalText = text;
  bound.fontSize = fontSize;
  bound.width = textMeasured.width;
  bound.height = textMeasured.height;
  bound.textAlign = "center";
  bound.verticalAlign = "middle";

  if (target.type !== "arrow") {
    const shapeKind: AiShapeType = (AI_SHAPE_TYPES as readonly string[]).includes(target.type) ? target.type as AiShapeType : "rectangle";
    const shapeMeasured = measureBox(shapeKind, text, fontSize);
    let grew = false;
    const prevW = typeof target.width === "number" ? target.width : 0;
    const prevH = typeof target.height === "number" ? target.height : 0;
    if (shapeMeasured.width > prevW) {
      target.width = shapeMeasured.width;
      grew = true;
    }
    if (shapeMeasured.height > prevH) {
      target.height = shapeMeasured.height;
      grew = true;
    }
    if (grew) {
      movedIds.add(target.id);
      if (obstacles && obstacles.length && mindmapDataOf(target.customData)?.role !== "node") {
        const grownBox = elementBounds(target);
        if (obstacles.some((box) => boxesOverlap(grownBox, box, 12))) {
          const pos = findFreePosition({ x: grownBox.x, y: grownBox.y }, { width: grownBox.width, height: grownBox.height }, obstacles, "right");
          target.x = pos.x;
          target.y = pos.y;
        }
      }
    }
    const box = elementBounds(target);
    bound.x = Math.round(box.x + (box.width - textMeasured.width) / 2);
    bound.y = Math.round(box.y + (box.height - textMeasured.height) / 2);
  } else {
    const box = elementBounds(target);
    bound.x = Math.round(box.x + (box.width - textMeasured.width) / 2);
    bound.y = Math.round(box.y + (box.height - textMeasured.height) / 2);
  }
}

function bindArrowEndpoints(arrow: WhiteboardElement, from: WhiteboardElement, to: WhiteboardElement) {
  const geom = computeArrowGeometry(elementBounds(from), elementBounds(to));
  arrow.x = geom.x;
  arrow.y = geom.y;
  arrow.width = geom.width;
  arrow.height = geom.height;
  arrow.points = geom.points;
  arrow.startBinding = { elementId: from.id, fixedPoint: geom.startFixedPoint, mode: "orbit" };
  arrow.endBinding = { elementId: to.id, fixedPoint: geom.endFixedPoint, mode: "orbit" };
  addBoundRef(from, { id: arrow.id, type: "arrow" });
  addBoundRef(to, { id: arrow.id, type: "arrow" });
}

function getElementLabel(elements: readonly WhiteboardElement[], el: WhiteboardElement): string {
  if (el.type === "frame") return typeof el.name === "string" && el.name.trim() ? el.name.trim() : "Frame";
  if (el.type === "text") {
    const raw = typeof el.originalText === "string" ? el.originalText : typeof el.text === "string" ? el.text : "";
    return raw.trim();
  }
  const bound = elements.find((item) => item.isDeleted !== true && item.type === "text" && item.containerId === el.id);
  if (bound) {
    const raw = typeof bound.originalText === "string" ? bound.originalText : typeof bound.text === "string" ? bound.text : "";
    if (raw.trim()) return raw.trim();
  }
  if (typeof el.originalText === "string" && el.originalText.trim()) return el.originalText.trim();
  if (typeof el.text === "string" && el.text.trim()) return el.text.trim();
  return "";
}

function shortLabel(text: string, fallback: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (!oneLine) return fallback;
  return oneLine.length > 48 ? `${oneLine.slice(0, 47)}…` : oneLine;
}

function finalizeWhiteboard(elements: readonly WhiteboardElement[], files: StoredWhiteboard["files"], appState: StoredWhiteboard["appState"]): StoredWhiteboard {
  const live = elements.filter((el) => el.isDeleted !== true);
  if (live.length > MAX_WHITEBOARD_ELEMENTS) {
    throw new WhiteboardEditError(`This edit would exceed the ${MAX_WHITEBOARD_ELEMENTS.toLocaleString("en-US")}-element whiteboard limit.`);
  }
  const stored = sceneToStored({ elements: live, files: files ?? {}, appState: appState ?? {} }).data;
  const plain = JSON.parse(JSON.stringify(stored)) as StoredWhiteboard;
  if (storedSize(plain) > MAX_CANVAS_BYTES.whiteboard) {
    throw new WhiteboardEditError("This edit would make the whiteboard larger than the 2 MB limit.");
  }
  try {
    validateCanvasData("whiteboard", plain);
  } catch (error) {
    if (error instanceof NoteValidationError) {
      throw new WhiteboardEditError(error.message);
    }
    throw error;
  }
  return plain;
}

// ---- Structured Create ----

export type StructuredCreateFrame = {
  ref: string;
  name: string;
  layout?: "row" | "column" | "grid" | null;
};

export type StructuredCreateItem = {
  ref: string;
  type: AiShapeType;
  text: string;
  color?: string | null;
  frameRef?: string | null;
};

export type StructuredCreateConnection = {
  fromRef: string;
  toRef: string;
  label?: string | null;
  color?: string | null;
};

export type StructuredCreateInput = {
  frames?: StructuredCreateFrame[] | null;
  items?: StructuredCreateItem[] | null;
  connections?: StructuredCreateConnection[] | null;
};

function layoutBoxes(sizes: readonly { width: number; height: number }[], layout: AiLayout, originX: number, originY: number): { x: number; y: number }[] {
  if (!sizes.length) return [];
  const gap = layout === "cluster" ? CLUSTER_GAP : ELEMENT_GAP;
  if (layout === "row") {
    const maxH = Math.max(...sizes.map((s) => s.height));
    let x = originX;
    return sizes.map((s) => {
      const pos = { x, y: Math.round(originY + (maxH - s.height) / 2) };
      x += s.width + gap;
      return pos;
    });
  }
  if (layout === "column") {
    const maxW = Math.max(...sizes.map((s) => s.width));
    let y = originY;
    return sizes.map((s) => {
      const pos = { x: Math.round(originX + (maxW - s.width) / 2), y };
      y += s.height + gap;
      return pos;
    });
  }
  const cols = layout === "cluster"
    ? Math.min(3, Math.max(1, Math.ceil(Math.sqrt(sizes.length))))
    : Math.max(1, Math.ceil(Math.sqrt(sizes.length)));
  const rows = Math.ceil(sizes.length / cols);
  const colWidths = Array.from({ length: cols }, (_, c) => {
    let w = 0;
    for (let r = 0; r < rows; r++) {
      const idx = r * cols + c;
      if (idx < sizes.length) w = Math.max(w, sizes[idx].width);
    }
    return w;
  });
  const rowHeights = Array.from({ length: rows }, (_, r) => {
    let h = 0;
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      if (idx < sizes.length) h = Math.max(h, sizes[idx].height);
    }
    return h;
  });
  const colX: number[] = [];
  let cx = originX;
  for (let c = 0; c < cols; c++) { colX.push(cx); cx += colWidths[c] + gap; }
  const rowY: number[] = [];
  let cy = originY;
  for (let r = 0; r < rows; r++) { rowY.push(cy); cy += rowHeights[r] + gap; }

  return sizes.map((s, idx) => {
    const r = Math.floor(idx / cols);
    const c = idx % cols;
    return {
      x: Math.round(colX[c] + (colWidths[c] - s.width) / 2),
      y: Math.round(rowY[r] + (rowHeights[r] - s.height) / 2),
    };
  });
}

export function buildStructuredWhiteboard(
  input: StructuredCreateInput,
  newId: () => string = randomElementId,
): { data: StoredWhiteboard; summaryLines: string[]; focusIds: string[] } {
  const frames = input.frames ?? [];
  const items = input.items ?? [];
  const connections = input.connections ?? [];

  if (frames.length > MAX_AI_CREATE_FRAMES) {
    throw new WhiteboardEditError(`At most ${MAX_AI_CREATE_FRAMES} frames can be created at once.`);
  }
  if (items.length > MAX_AI_CREATE_ITEMS) {
    throw new WhiteboardEditError(`At most ${MAX_AI_CREATE_ITEMS} items can be created at once.`);
  }
  if (connections.length > MAX_AI_CREATE_CONNECTIONS) {
    throw new WhiteboardEditError(`At most ${MAX_AI_CREATE_CONNECTIONS} connections can be created at once.`);
  }

  const frameRefs = new Map<string, { id: string; spec: StructuredCreateFrame; items: { id: string; spec: StructuredCreateItem; box: { width: number; height: number; wrapped: string } }[] }>();
  for (const frame of frames) {
    const ref = typeof frame.ref === "string" ? frame.ref.trim() : "";
    if (!ref || frameRefs.has(ref)) throw new WhiteboardEditError(`Duplicate or empty frame ref "${frame.ref}".`);
    const name = sanitizeText(typeof frame.name === "string" ? frame.name : "", MAX_FRAME_NAME_LENGTH) || "Frame";
    frameRefs.set(ref, { id: newId(), spec: { ...frame, ref, name }, items: [] });
  }

  const itemRefs = new Map<string, { id: string; spec: StructuredCreateItem; frameId: string | null; box: { width: number; height: number; wrapped: string } }>();
  const unframedItems: { id: string; spec: StructuredCreateItem; box: { width: number; height: number; wrapped: string } }[] = [];

  for (const item of items) {
    const ref = typeof item.ref === "string" ? item.ref.trim() : "";
    if (!ref || itemRefs.has(ref) || frameRefs.has(ref)) {
      throw new WhiteboardEditError(`Duplicate or empty item ref "${item.ref}".`);
    }
    if (!(AI_SHAPE_TYPES as readonly string[]).includes(item.type)) {
      throw new WhiteboardEditError(`Unsupported element type "${item.type}".`);
    }
    const text = sanitizeText(typeof item.text === "string" ? item.text : "");
    const fontSize = item.type === "stickynote" ? 18 : 20;
    const box = measureBox(item.type, text, fontSize);
    const id = newId();
    const frameRef = typeof item.frameRef === "string" && item.frameRef.trim() ? item.frameRef.trim() : null;
    if (frameRef && !frameRefs.has(frameRef)) {
      throw new WhiteboardEditError(`Unknown frameRef "${frameRef}" on item "${ref}".`);
    }
    const entry = { id, spec: { ...item, ref, text }, box };
    itemRefs.set(ref, { ...entry, frameId: frameRef ? frameRefs.get(frameRef)!.id : null });
    if (frameRef) frameRefs.get(frameRef)!.items.push(entry);
    else unframedItems.push(entry);
  }

  const skeletons: Record<string, unknown>[] = [];
  const focusIds: string[] = [];
  const summaryLines: string[] = [];

  // Place frames left-to-right (wrapping after 2 frames per row so boards stay balanced).
  const frameEntries = [...frameRefs.values()];
  const framePlacedSizes: { entry: (typeof frameEntries)[number]; width: number; height: number; childPositions: { x: number; y: number }[] }[] = [];
  for (const entry of frameEntries) {
    const layout: AiLayout = entry.spec.layout === "row" || entry.spec.layout === "column" ? entry.spec.layout : "grid";
    if (!entry.items.length) {
      framePlacedSizes.push({ entry, width: DEFAULT_FRAME_WIDTH, height: DEFAULT_FRAME_HEIGHT, childPositions: [] });
      continue;
    }
    const relPositions = layoutBoxes(entry.items.map((it) => it.box), layout, FRAME_PADDING, FRAME_TOP_PADDING);
    const bounds = unionBoxes(relPositions.map((pos, idx) => ({ ...pos, width: entry.items[idx].box.width, height: entry.items[idx].box.height })))!;
    const width = Math.max(DEFAULT_FRAME_WIDTH * 0.6, Math.ceil(bounds.x + bounds.width + FRAME_PADDING));
    const height = Math.max(DEFAULT_FRAME_HEIGHT * 0.6, Math.ceil(bounds.y + bounds.height + FRAME_PADDING));
    framePlacedSizes.push({ entry, width, height, childPositions: relPositions });
  }

  const frameOrigins = layoutBoxes(framePlacedSizes.map((f) => ({ width: f.width, height: f.height })), "grid", 80, 80);
  let maxBottom = 80;
  framePlacedSizes.forEach((fp, idx) => {
    const origin = frameOrigins[idx];
    const childIds = fp.entry.items.map((it) => it.id);
    skeletons.push({
      id: fp.entry.id,
      type: "frame",
      name: fp.entry.spec.name,
      x: origin.x,
      y: origin.y,
      width: fp.width,
      height: fp.height,
      children: childIds,
    });
    focusIds.push(fp.entry.id);
    summaryLines.push(`Frame "${fp.entry.spec.name}" (${fp.entry.items.length} item${fp.entry.items.length === 1 ? "" : "s"})`);
    fp.entry.items.forEach((it, cIdx) => {
      const pos = fp.childPositions[cIdx];
      const fontSize = it.spec.type === "stickynote" ? 18 : 20;
      skeletons.push(makeShapeSkeleton({
        id: it.id,
        type: it.spec.type,
        x: origin.x + pos.x,
        y: origin.y + pos.y,
        width: it.box.width,
        height: it.box.height,
        text: it.box.wrapped,
        fontSize,
        color: it.spec.color,
        frameId: fp.entry.id,
      }));
      focusIds.push(it.id);
    });
    maxBottom = Math.max(maxBottom, origin.y + fp.height);
  });

  if (unframedItems.length) {
    const startY = framePlacedSizes.length ? maxBottom + 72 : 80;
    const layout: AiLayout = connections.length && unframedItems.length <= 6 ? "row" : "grid";
    const positions = layoutBoxes(unframedItems.map((it) => it.box), layout, 80, startY);
    unframedItems.forEach((it, idx) => {
      const pos = positions[idx];
      const fontSize = it.spec.type === "stickynote" ? 18 : 20;
      skeletons.push(makeShapeSkeleton({
        id: it.id,
        type: it.spec.type,
        x: pos.x,
        y: pos.y,
        width: it.box.width,
        height: it.box.height,
        text: it.box.wrapped,
        fontSize,
        color: it.spec.color,
      }));
      focusIds.push(it.id);
      if (it.spec.text) summaryLines.push(`- ${it.spec.type}: ${shortLabel(it.spec.text, it.spec.type)}`);
    });
  }

  // Convert shapes/frames first so we have accurate bounds for arrows.
  const elements = skeletons.length ? convertSkeletons(skeletons) : [];
  const byId = new Map(elements.map((el) => [el.id, el]));

  // Add connections as bound arrows.
  for (const conn of connections) {
    const fromEntry = itemRefs.get(conn.fromRef?.trim() ?? "");
    const toEntry = itemRefs.get(conn.toRef?.trim() ?? "");
    if (!fromEntry || !toEntry) {
      throw new WhiteboardEditError(`Connection refers to unknown item ref ("${conn.fromRef}" -> "${conn.toRef}").`);
    }
    if (fromEntry.id === toEntry.id) {
      throw new WhiteboardEditError(`Connection cannot link item "${conn.fromRef}" to itself.`);
    }
    const fromEl = byId.get(fromEntry.id)!;
    const toEl = byId.get(toEntry.id)!;
    const sharedFrame = fromEntry.frameId && fromEntry.frameId === toEntry.frameId ? fromEntry.frameId : null;
    const label = typeof conn.label === "string" && conn.label.trim() ? sanitizeText(conn.label, 200) : "";
    const arrowId = newId();
    const converted = convertSkeletons([makeArrowSkeleton({ id: arrowId, from: fromEl, to: toEl, label, color: conn.color, frameId: sharedFrame })]);
    const arrowEl = converted.find((el) => el.id === arrowId)!;
    bindArrowEndpoints(arrowEl, fromEl, toEl);
    for (const part of converted) {
      if (sharedFrame) part.frameId = sharedFrame;
      elements.push(part);
      byId.set(part.id, part);
    }
    focusIds.push(arrowId);
  }

  const data = finalizeWhiteboard(elements, {}, {});
  return { data, summaryLines, focusIds };
}

// ---- Structured Edit ----

export type WhiteboardEditOp = {
  op: "add_element" | "add_frame" | "connect" | "update_element" | "delete_elements" | "set_frame" | "arrange" | "group_elements";
  ref?: string | null;
  elementType?: AiShapeType | null;
  elementId?: string | null;
  elementIds?: string[] | null;
  text?: string | null;
  color?: string | null;
  strokeStyle?: AiStrokeStyle | null;
  fontSize?: AiFontSize | null;
  fromId?: string | null;
  toId?: string | null;
  frameId?: string | null;
  nearId?: string | null;
  placement?: AiPlacement | null;
  layout?: AiLayout | null;
  ungroup?: boolean | null;
};

export type WhiteboardEditResult = {
  data: StoredWhiteboard;
  changes: ProposalChange[];
  focusIds: string[];
  unchanged: boolean;
};

function applyMindmapChangeToArray(elements: WhiteboardElement[], change: MindmapChange): WhiteboardElement[] {
  const next = elements.map((el) => {
    const patch = change.patches.get(el.id);
    return patch ? { ...el, ...patch } : el;
  });
  if (change.added.length) {
    const created = convertSkeletons(change.added as Record<string, unknown>[]);
    next.push(...created);
  }
  return next;
}

function expandFrameToContain(frame: WhiteboardElement, memberBoxes: readonly Box[]) {
  const union = unionBoxes(memberBoxes);
  if (!union) return;
  const fBox = elementBounds(frame);
  const left = Math.min(fBox.x, union.x - FRAME_PADDING);
  const top = Math.min(fBox.y, union.y - FRAME_TOP_PADDING);
  const right = Math.max(fBox.x + fBox.width, union.x + union.width + FRAME_PADDING);
  const bottom = Math.max(fBox.y + fBox.height, union.y + union.height + FRAME_PADDING);
  frame.x = Math.round(left);
  frame.y = Math.round(top);
  frame.width = Math.round(right - left);
  frame.height = Math.round(bottom - top);
}

function moveElementWithBoundText(elements: WhiteboardElement[], el: WhiteboardElement, targetX: number, targetY: number) {
  const oldX = typeof el.x === "number" ? el.x : 0;
  const oldY = typeof el.y === "number" ? el.y : 0;
  const dx = targetX - oldX;
  const dy = targetY - oldY;
  if (dx === 0 && dy === 0) return;
  el.x = targetX;
  el.y = targetY;
  for (const child of elements) {
    if (child.isDeleted === true || child.type !== "text" || child.containerId !== el.id) continue;
    child.x = (typeof child.x === "number" ? child.x : 0) + dx;
    child.y = (typeof child.y === "number" ? child.y : 0) + dy;
  }
}

function syncBoundArrowsFor(elements: WhiteboardElement[], movedIds: ReadonlySet<string>) {
  if (!movedIds.size) return;
  const byId = new Map<string, WhiteboardElement>();
  for (const el of elements) {
    if (el.isDeleted !== true) byId.set(el.id, el);
  }
  for (const el of elements) {
    if (el.isDeleted === true || el.type !== "arrow") continue;
    if (mindmapDataOf(el.customData)?.role === "edge") continue;
    const startId = (el.startBinding as { elementId?: string } | null | undefined)?.elementId;
    const endId = (el.endBinding as { elementId?: string } | null | undefined)?.elementId;
    if (!startId || !endId) continue;
    if (!movedIds.has(startId) && !movedIds.has(endId)) continue;
    const from = byId.get(startId);
    const to = byId.get(endId);
    if (!from || !to) continue;
    const prevMidX = (typeof el.x === "number" ? el.x : 0) + (typeof el.width === "number" ? el.width / 2 : 0);
    const prevMidY = (typeof el.y === "number" ? el.y : 0) + (typeof el.height === "number" ? el.height / 2 : 0);
    bindArrowEndpoints(el, from, to);
    const nextMidX = (el.x as number) + (el.width as number) / 2;
    const nextMidY = (el.y as number) + (el.height as number) / 2;
    // Move any bound label on the arrow by the midpoint delta.
    for (const label of elements) {
      if (label.isDeleted === true || label.type !== "text" || label.containerId !== el.id) continue;
      label.x = (typeof label.x === "number" ? label.x : 0) + (nextMidX - prevMidX);
      label.y = (typeof label.y === "number" ? label.y : 0) + (nextMidY - prevMidY);
    }
  }
}

export function applyWhiteboardEdits(
  currentData: unknown,
  rawOps: unknown,
  rawNewId: () => string = randomElementId,
): WhiteboardEditResult {
  if (!Array.isArray(rawOps)) {
    throw new WhiteboardEditError("operations must be an array.");
  }
  if (rawOps.length > MAX_AI_WHITEBOARD_OPS) {
    throw new WhiteboardEditError(`At most ${MAX_AI_WHITEBOARD_OPS} operations are allowed in one call.`);
  }

  const initialScene = storedToScene(currentData);
  const beforeStored = sceneToStored({ elements: initialScene.elements, files: initialScene.files, appState: initialScene.appState }).data;
  const beforeJson = JSON.stringify(beforeStored);

  // Clone elements cleanly so we never mutate caller's objects.
  let elements: WhiteboardElement[] = JSON.parse(JSON.stringify(initialScene.elements)) as WhiteboardElement[];
  const files = initialScene.files;
  const appState = initialScene.appState;

  const usedIds = new Set<string>(elements.map((el) => el.id));
  const newId = (): string => {
    let candidate = rawNewId();
    let tries = 0;
    while (usedIds.has(candidate) && tries < 10_000) {
      candidate = rawNewId();
      tries += 1;
    }
    if (usedIds.has(candidate)) candidate = randomElementId();
    usedIds.add(candidate);
    return candidate;
  };

  const refMap = new Map<string, string>();
  const changes: ProposalChange[] = [];
  const focusIds = new Set<string>();
  const movedIds = new Set<string>();
  const relayoutRoots = new Set<string>();

  const liveElements = () => elements.filter((el) => el.isDeleted !== true);
  const findLive = (idOrRef: string): WhiteboardElement | undefined => {
    const resolved = refMap.get(idOrRef) ?? idOrRef;
    return elements.find((el) => el.isDeleted !== true && el.id === resolved);
  };
  const resolveContainer = (idOrRef: string): WhiteboardElement | undefined => {
    const el = findLive(idOrRef);
    if (!el) return undefined;
    if (el.type === "text" && typeof el.containerId === "string" && el.containerId) {
      const container = findLive(el.containerId);
      if (container && container.type !== "frame") return container;
    }
    return el;
  };
  const registerRef = (ref: unknown, id: string) => {
    if (typeof ref !== "string" || !ref.trim()) return;
    const key = ref.trim();
    if (refMap.has(key)) throw new WhiteboardEditError(`Duplicate local ref "${key}".`);
    refMap.set(key, id);
  };
  const obstacleBoxes = (excludeIds: ReadonlySet<string> = new Set(), onlyFrameId?: string | null): Box[] => {
    const out: Box[] = [];
    for (const el of elements) {
      if (el.isDeleted === true || excludeIds.has(el.id)) continue;
      if (el.type === "text" && typeof el.containerId === "string" && el.containerId) continue;
      if (onlyFrameId !== undefined) {
        if ((el.frameId ?? null) !== onlyFrameId) continue;
        if (el.type === "frame") continue;
      }
      out.push(elementBounds(el));
    }
    return out;
  };

  for (let i = 0; i < rawOps.length; i++) {
    const raw = rawOps[i];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new WhiteboardEditError(`Operation #${i + 1} must be an object.`);
    }
    const op = raw as WhiteboardEditOp;

    if (op.op === "add_element") {
      if (!op.elementType || !(AI_SHAPE_TYPES as readonly string[]).includes(op.elementType)) {
        throw new WhiteboardEditError(`Operation #${i + 1} (add_element): elementType must be one of ${AI_SHAPE_TYPES.join(", ")}.`);
      }
      const text = typeof op.text === "string" ? sanitizeText(op.text) : "";
      const fSize = fontSizePx(op.fontSize, op.elementType === "stickynote" ? 18 : 20);
      const box = measureBox(op.elementType, text, fSize);
      const id = newId();

      let targetFrame: WhiteboardElement | null = null;
      if (typeof op.frameId === "string" && op.frameId.trim()) {
        const frame = findLive(op.frameId.trim());
        if (!frame || frame.type !== "frame") throw new WhiteboardEditError(`Operation #${i + 1}: frame "${op.frameId}" not found.`);
        targetFrame = frame;
      }

      let pos: { x: number; y: number };
      if (targetFrame) {
        const fBox = elementBounds(targetFrame);
        const insideObstacles = obstacleBoxes(new Set([targetFrame.id]), targetFrame.id);
        const anchor = typeof op.nearId === "string" && op.nearId.trim() ? resolveContainer(op.nearId.trim()) : undefined;
        const placement: AiPlacement = op.placement ?? "right";
        if (anchor && (anchor.frameId ?? null) === targetFrame.id) {
          const aBox = elementBounds(anchor);
          const desired = placement === "below"
            ? { x: aBox.x, y: aBox.y + aBox.height + ELEMENT_GAP }
            : placement === "above"
              ? { x: aBox.x, y: aBox.y - box.height - ELEMENT_GAP }
              : placement === "left"
                ? { x: aBox.x - box.width - ELEMENT_GAP, y: aBox.y }
                : { x: aBox.x + aBox.width + ELEMENT_GAP, y: aBox.y };
          pos = findFreePosition(desired, box, insideObstacles, placement);
        } else {
          pos = findFreePosition({ x: fBox.x + FRAME_PADDING, y: fBox.y + FRAME_TOP_PADDING }, box, insideObstacles, "right");
        }
      } else if (typeof op.nearId === "string" && op.nearId.trim()) {
        const anchor = resolveContainer(op.nearId.trim());
        if (!anchor) throw new WhiteboardEditError(`Operation #${i + 1}: nearId "${op.nearId}" not found.`);
        const aBox = elementBounds(anchor);
        const placement: AiPlacement = op.placement ?? "right";
        const desired = placement === "below"
          ? { x: aBox.x, y: aBox.y + aBox.height + ELEMENT_GAP }
          : placement === "above"
            ? { x: aBox.x, y: aBox.y - box.height - ELEMENT_GAP }
            : placement === "left"
              ? { x: aBox.x - box.width - ELEMENT_GAP, y: aBox.y }
              : { x: aBox.x + aBox.width + ELEMENT_GAP, y: aBox.y };
        pos = findFreePosition(desired, box, obstacleBoxes(), placement);
      } else {
        const allBoxes = obstacleBoxes();
        const union = unionBoxes(allBoxes);
        const desired = union ? { x: union.x, y: union.y + union.height + ELEMENT_GAP * 1.5 } : { x: 100, y: 100 };
        pos = findFreePosition(desired, box, allBoxes, "right");
      }

      const created = convertSkeletons([makeShapeSkeleton({
        id,
        type: op.elementType,
        x: pos.x,
        y: pos.y,
        width: box.width,
        height: box.height,
        text: box.wrapped,
        fontSize: fSize,
        color: op.color,
        strokeStyle: op.strokeStyle,
        frameId: targetFrame?.id ?? null,
      })]);
      for (const el of created) {
        if (targetFrame) el.frameId = targetFrame.id;
        elements.push(el);
      }
      if (targetFrame) {
        const memberBoxes = liveElements()
          .filter((el) => el.frameId === targetFrame!.id && !(el.type === "text" && el.containerId))
          .map(elementBounds);
        expandFrameToContain(targetFrame, memberBoxes);
      }
      registerRef(op.ref, id);
      focusIds.add(id);
      const label = shortLabel(text, op.elementType);
      changes.push({
        op: "add",
        block: 0,
        target: { type: "elements", count: 1, name: label },
        after: `${op.elementType}: ${text || "(empty)"}`,
      });
      continue;
    }

    if (op.op === "add_frame") {
      const name = sanitizeText(typeof op.text === "string" ? op.text : "", MAX_FRAME_NAME_LENGTH) || "Frame";
      const id = newId();
      const childInputs = Array.isArray(op.elementIds) ? op.elementIds.filter((s): s is string => typeof s === "string" && s.trim().length > 0) : [];
      const children: WhiteboardElement[] = [];
      const seenChild = new Set<string>();
      for (const rawId of childInputs) {
        const target = resolveContainer(rawId.trim());
        if (!target) throw new WhiteboardEditError(`Operation #${i + 1} (add_frame): element "${rawId}" not found.`);
        if (target.type === "frame") throw new WhiteboardEditError(`Operation #${i + 1} (add_frame): cannot nest frame "${rawId}" inside another frame.`);
        if (!seenChild.has(target.id)) {
          seenChild.add(target.id);
          children.push(target);
        }
      }

      let frameBox: Box;
      if (children.length) {
        const union = unionBoxes(children.map(elementBounds))!;
        frameBox = {
          x: Math.round(union.x - FRAME_PADDING),
          y: Math.round(union.y - FRAME_TOP_PADDING),
          width: Math.round(union.width + FRAME_PADDING * 2),
          height: Math.round(union.height + FRAME_TOP_PADDING + FRAME_PADDING),
        };
      } else {
        const allBoxes = obstacleBoxes();
        const union = unionBoxes(allBoxes);
        let desired = union ? { x: union.x, y: union.y + union.height + ELEMENT_GAP * 2 } : { x: 80, y: 80 };
        if (typeof op.nearId === "string" && op.nearId.trim()) {
          const anchor = resolveContainer(op.nearId.trim());
          if (!anchor) throw new WhiteboardEditError(`Operation #${i + 1} (add_frame): nearId "${op.nearId}" not found.`);
          const aBox = elementBounds(anchor);
          const placement: AiPlacement = op.placement ?? "right";
          desired = placement === "below"
            ? { x: aBox.x, y: aBox.y + aBox.height + ELEMENT_GAP * 1.5 }
            : placement === "above"
              ? { x: aBox.x, y: aBox.y - DEFAULT_FRAME_HEIGHT - ELEMENT_GAP * 1.5 }
              : placement === "left"
                ? { x: aBox.x - DEFAULT_FRAME_WIDTH - ELEMENT_GAP * 1.5, y: aBox.y }
                : { x: aBox.x + aBox.width + ELEMENT_GAP * 1.5, y: aBox.y };
        }
        const pos = findFreePosition(desired, { width: DEFAULT_FRAME_WIDTH, height: DEFAULT_FRAME_HEIGHT }, allBoxes, op.placement ?? "right");
        frameBox = { x: pos.x, y: pos.y, width: DEFAULT_FRAME_WIDTH, height: DEFAULT_FRAME_HEIGHT };
      }

      const [frameEl] = convertSkeletons([{
        id,
        type: "frame",
        name,
        x: frameBox.x,
        y: frameBox.y,
        width: frameBox.width,
        height: frameBox.height,
        children: [],
      }]);
      elements.push(frameEl);
      for (const child of children) {
        child.frameId = id;
        for (const bound of elements) {
          if (bound.isDeleted !== true && bound.type === "text" && bound.containerId === child.id) bound.frameId = id;
        }
      }
      registerRef(op.ref, id);
      focusIds.add(id);
      changes.push({
        op: "add",
        block: 0,
        target: { type: "elements", count: 1, name },
        after: children.length ? `Frame "${name}" (${children.length} element${children.length === 1 ? "" : "s"})` : `Frame "${name}"`,
      });
      continue;
    }

    if (op.op === "connect") {
      if (typeof op.fromId !== "string" || !op.fromId.trim() || typeof op.toId !== "string" || !op.toId.trim()) {
        throw new WhiteboardEditError(`Operation #${i + 1} (connect): fromId and toId are required.`);
      }
      const fromEl = resolveContainer(op.fromId.trim());
      const toEl = resolveContainer(op.toId.trim());
      if (!fromEl) throw new WhiteboardEditError(`Operation #${i + 1} (connect): source element "${op.fromId}" not found.`);
      if (!toEl) throw new WhiteboardEditError(`Operation #${i + 1} (connect): target element "${op.toId}" not found.`);
      if (fromEl.type === "frame" || toEl.type === "frame") {
        throw new WhiteboardEditError(`Operation #${i + 1} (connect): cannot connect a frame directly; connect elements instead.`);
      }
      if (fromEl.id === toEl.id) {
        throw new WhiteboardEditError(`Operation #${i + 1} (connect): cannot connect an element to itself.`);
      }
      const arrowId = newId();
      const label = typeof op.text === "string" && op.text.trim() ? sanitizeText(op.text, 200) : "";
      const sharedFrame = typeof fromEl.frameId === "string" && fromEl.frameId === toEl.frameId ? fromEl.frameId : null;
      const converted = convertSkeletons([makeArrowSkeleton({
        id: arrowId,
        from: fromEl,
        to: toEl,
        label,
        color: op.color,
        strokeStyle: op.strokeStyle,
        frameId: sharedFrame,
      })]);
      const arrowEl = converted.find((el) => el.id === arrowId)!;
      bindArrowEndpoints(arrowEl, fromEl, toEl);
      for (const part of converted) {
        if (sharedFrame) part.frameId = sharedFrame;
        elements.push(part);
      }
      registerRef(op.ref, arrowId);
      focusIds.add(arrowId);
      const fromName = shortLabel(getElementLabel(elements, fromEl), fromEl.type);
      const toName = shortLabel(getElementLabel(elements, toEl), toEl.type);
      changes.push({
        op: "add",
        block: 0,
        target: { type: "elements", count: 1, name: label || `${fromName} -> ${toName}` },
        after: label ? `${fromName} -> ${toName} ("${label}")` : `${fromName} -> ${toName}`,
      });
      continue;
    }

    if (op.op === "update_element") {
      if (typeof op.elementId !== "string" || !op.elementId.trim()) {
        throw new WhiteboardEditError(`Operation #${i + 1} (update_element): elementId is required.`);
      }
      const target = resolveContainer(op.elementId.trim());
      if (!target) throw new WhiteboardEditError(`Operation #${i + 1} (update_element): element "${op.elementId}" not found.`);
      if (target.locked === true) {
        throw new WhiteboardEditError(`Operation #${i + 1} (update_element): element "${op.elementId}" is locked.`);
      }

      const beforeSummary: string[] = [];
      const afterSummary: string[] = [];
      let changed = false;

      if (op.text !== null && op.text !== undefined) {
        if (typeof op.text !== "string") throw new WhiteboardEditError(`Operation #${i + 1} (update_element): text must be a string or null.`);
        const nextText = sanitizeText(op.text, target.type === "frame" ? MAX_FRAME_NAME_LENGTH : MAX_AI_TEXT_LENGTH);
        const prevText = getElementLabel(elements, target);
        if (target.type === "frame") {
          if (prevText !== nextText) {
            target.name = nextText || "Frame";
            beforeSummary.push(prevText || "(unnamed)");
            afterSummary.push(nextText || "Frame");
            changed = true;
          }
        } else if (target.type === "text") {
          const fSize = fontSizePx(op.fontSize, typeof target.fontSize === "number" ? target.fontSize : 20);
          const measured = measureBox("text", nextText || " ", fSize);
          if (prevText !== nextText) {
            target.text = measured.wrapped;
            target.originalText = nextText;
            target.width = measured.width;
            target.height = measured.height;
            beforeSummary.push(prevText || "(empty)");
            afterSummary.push(nextText || "(empty)");
            changed = true;
          }
        } else {
          // Only shapes, sticky notes and arrows can hold a bound text label in Excalidraw.
          if (!TEXT_CONTAINER_TYPES.has(target.type)) {
            throw new WhiteboardEditError(`Operation #${i + 1} (update_element): element type "${target.type}" cannot hold a bound text label.`);
          }
          const bound = elements.find((item) => item.isDeleted !== true && item.type === "text" && item.containerId === target.id);
          const fSize = fontSizePx(op.fontSize, typeof bound?.fontSize === "number" ? bound.fontSize : target.type === "stickynote" ? 18 : 20);
          const obstacles = liveElements()
            .filter((el) => el.id !== target.id && el.type !== "frame" && el.type !== "arrow" && el.type !== "line" && !(el.type === "text" && el.containerId))
            .map(elementBounds);
          if (bound) {
            if (prevText !== nextText) {
              fitBoundLabel(target, bound, nextText, fSize, movedIds, obstacles);
              beforeSummary.push(prevText || "(empty)");
              afterSummary.push(nextText || "(empty)");
              changed = true;
            }
          } else if (nextText) {
            const textId = newId();
            const [createdText] = convertSkeletons([{
              id: textId,
              type: "text",
              x: typeof target.x === "number" ? target.x : 0,
              y: typeof target.y === "number" ? target.y : 0,
              text: nextText,
              fontSize: fSize,
              fontFamily: NUNITO_FONT_FAMILY,
              textAlign: "center",
              verticalAlign: "middle",
              strokeColor: "#1e1e1e",
              roughness: 0,
            }]);
            createdText.containerId = target.id;
            if (typeof target.frameId === "string") createdText.frameId = target.frameId;
            fitBoundLabel(target, createdText, nextText, fSize, movedIds, obstacles);
            addBoundRef(target, { id: textId, type: "text" });
            elements.push(createdText);
            beforeSummary.push("(empty)");
            afterSummary.push(nextText);
            changed = true;
          }
          // If this is a mindmap node, schedule tree relayout so node sizes stay neat.
          const mm = mindmapDataOf(target.customData);
          if (changed && mm?.role === "node") {
            const found = mindmapFinder(elements as unknown as SceneElement[])(target.id);
            if (found) relayoutRoots.add(found.tree.root.id);
          }
        }
      }

      if (op.color !== null && op.color !== undefined) {
        if (target.type !== "frame" && target.type !== "image") {
          const colors = resolveColors(target.type, op.color);
          const prevColor = `${target.strokeColor ?? ""}/${target.backgroundColor ?? ""}`;
          target.strokeColor = colors.strokeColor;
          if (target.type !== "text" && target.type !== "arrow" && target.type !== "line") {
            target.backgroundColor = colors.backgroundColor;
            if (!target.fillStyle) target.fillStyle = "solid";
          }
          const nextColor = `${target.strokeColor ?? ""}/${target.backgroundColor ?? ""}`;
          if (prevColor !== nextColor) {
            afterSummary.push(`color: ${op.color}`);
            changed = true;
          }
        }
      }

      if (op.strokeStyle !== null && op.strokeStyle !== undefined) {
        if (!(AI_STROKE_STYLES as readonly string[]).includes(op.strokeStyle)) {
          throw new WhiteboardEditError(`Operation #${i + 1}: invalid strokeStyle "${op.strokeStyle}".`);
        }
        if (target.strokeStyle !== op.strokeStyle) {
          target.strokeStyle = op.strokeStyle;
          afterSummary.push(`style: ${op.strokeStyle}`);
          changed = true;
        }
      }

      if (op.fontSize !== null && op.fontSize !== undefined) {
        if (!(AI_FONT_SIZES as readonly string[]).includes(op.fontSize)) {
          throw new WhiteboardEditError(`Operation #${i + 1}: invalid fontSize "${op.fontSize}".`);
        }
        const px = FONT_SIZE_PX[op.fontSize];
        const textTarget = target.type === "text"
          ? target
          : elements.find((item) => item.isDeleted !== true && item.type === "text" && item.containerId === target.id);
        if (textTarget && textTarget.fontSize !== px) {
          const currentText = typeof textTarget.originalText === "string" ? textTarget.originalText : typeof textTarget.text === "string" ? textTarget.text : "";
          if (target.type === "text") {
            const measured = measureBox("text", currentText || " ", px);
            textTarget.fontSize = px;
            textTarget.text = measured.wrapped;
            textTarget.width = measured.width;
            textTarget.height = measured.height;
          } else {
            const obstacles = liveElements()
              .filter((el) => el.id !== target.id && el.type !== "frame" && el.type !== "arrow" && el.type !== "line" && !(el.type === "text" && el.containerId))
              .map(elementBounds);
            fitBoundLabel(target, textTarget, currentText, px, movedIds, obstacles);
            const mm = mindmapDataOf(target.customData);
            if (mm?.role === "node") {
              const found = mindmapFinder(elements as unknown as SceneElement[])(target.id);
              if (found) relayoutRoots.add(found.tree.root.id);
            }
          }
          afterSummary.push(`size: ${op.fontSize}`);
          changed = true;
        }
      }

      if (changed) {
        focusIds.add(target.id);
        const label = shortLabel(getElementLabel(elements, target), target.type);
        changes.push({
          op: "update",
          block: 0,
          target: { type: "elements", count: 1, name: label },
          ...(beforeSummary.length ? { before: beforeSummary.join(" · ") } : {}),
          ...(afterSummary.length ? { after: afterSummary.join(" · ") } : {}),
        });
      }
      continue;
    }

    if (op.op === "delete_elements") {
      const ids = Array.isArray(op.elementIds) ? op.elementIds.filter((s): s is string => typeof s === "string" && s.trim().length > 0) : [];
      if (!ids.length) throw new WhiteboardEditError(`Operation #${i + 1} (delete_elements): elementIds must be a non-empty array.`);

      const targets: WhiteboardElement[] = [];
      const seen = new Set<string>();
      for (const rawId of ids) {
        const el = resolveContainer(rawId.trim());
        if (!el) throw new WhiteboardEditError(`Operation #${i + 1} (delete_elements): element "${rawId}" not found.`);
        if (el.locked === true) throw new WhiteboardEditError(`Operation #${i + 1} (delete_elements): element "${rawId}" is locked.`);
        if (!seen.has(el.id)) {
          seen.add(el.id);
          targets.push(el);
        }
      }

      const deletedNames: string[] = [];
      const mindmapIds: string[] = [];
      const regularIds = new Set<string>();
      const deletedFrameIds = new Set<string>();

      for (const target of targets) {
        deletedNames.push(shortLabel(getElementLabel(elements, target), target.type));
        if (mindmapDataOf(target.customData)?.role === "node") {
          mindmapIds.push(target.id);
        } else {
          regularIds.add(target.id);
          if (target.type === "frame") deletedFrameIds.add(target.id);
        }
      }

      // Cascade mindmap deletions using the mindmap engine so subtrees, edges, sibling orders, and locked branches stay consistent.
      if (mindmapIds.length) {
        const trees = readMindmapTrees(elements as unknown as SceneElement[]);
        const find = mindmapFinder(elements as unknown as SceneElement[], trees);
        for (const mid of mindmapIds) {
          const found = find(mid);
          if (found) relayoutRoots.add(found.tree.root.id);
        }
        const mmChange = deleteMindmapNodes(elements as unknown as SceneElement[], mindmapIds);
        elements = applyMindmapChangeToArray(elements, mmChange);
      }

      if (regularIds.size) {
        // Also collect bound text elements of deleted containers.
        const allRemoved = new Set<string>(regularIds);
        for (const el of elements) {
          if (el.isDeleted === true) continue;
          if (el.type === "text" && typeof el.containerId === "string" && regularIds.has(el.containerId)) {
            allRemoved.add(el.id);
          }
        }
        for (const el of elements) {
          if (el.isDeleted === true) continue;
          if (allRemoved.has(el.id)) {
            el.isDeleted = true;
            continue;
          }
          if (typeof el.frameId === "string" && deletedFrameIds.has(el.frameId)) {
            el.frameId = null;
          }
          const startId = (el.startBinding as { elementId?: string } | null | undefined)?.elementId;
          if (startId && allRemoved.has(startId)) el.startBinding = null;
          const endId = (el.endBinding as { elementId?: string } | null | undefined)?.elementId;
          if (endId && allRemoved.has(endId)) el.endBinding = null;
          removeBoundRefs(el, allRemoved);
        }
      }

      changes.push({
        op: "delete",
        block: 0,
        target: targets.length === 1
          ? { type: "elements", count: 1, name: deletedNames[0] }
          : { type: "elements", count: targets.length },
        before: deletedNames.slice(0, 6).join(", ") + (deletedNames.length > 6 ? ` (+${deletedNames.length - 6})` : ""),
      });
      continue;
    }

    if (op.op === "set_frame") {
      const ids = Array.isArray(op.elementIds) ? op.elementIds.filter((s): s is string => typeof s === "string" && s.trim().length > 0) : [];
      if (!ids.length) throw new WhiteboardEditError(`Operation #${i + 1} (set_frame): elementIds must be a non-empty array.`);
      let targetFrame: WhiteboardElement | null = null;
      if (typeof op.frameId === "string" && op.frameId.trim()) {
        const frame = findLive(op.frameId.trim());
        if (!frame || frame.type !== "frame") throw new WhiteboardEditError(`Operation #${i + 1} (set_frame): frame "${op.frameId}" not found.`);
        targetFrame = frame;
      }

      const targets: WhiteboardElement[] = [];
      const seen = new Set<string>();
      for (const rawId of ids) {
        const el = resolveContainer(rawId.trim());
        if (!el) throw new WhiteboardEditError(`Operation #${i + 1} (set_frame): element "${rawId}" not found.`);
        if (el.type === "frame") throw new WhiteboardEditError(`Operation #${i + 1} (set_frame): cannot place frame "${rawId}" inside another frame.`);
        if (mindmapDataOf(el.customData)?.role === "node" || mindmapDataOf(el.customData)?.role === "edge") {
          throw new WhiteboardEditError(`Operation #${i + 1} (set_frame): mind-map elements are laid out as a tree and cannot be moved individually into or out of frames.`);
        }
        if (!seen.has(el.id)) {
          seen.add(el.id);
          targets.push(el);
        }
      }

      const nextFrameId = targetFrame?.id ?? null;
      let anyChanged = false;
      for (const el of targets) {
        if ((el.frameId ?? null) !== nextFrameId) {
          el.frameId = nextFrameId;
          anyChanged = true;
        }
        for (const bound of elements) {
          if (bound.isDeleted !== true && bound.type === "text" && bound.containerId === el.id) {
            bound.frameId = nextFrameId;
          }
        }
        focusIds.add(el.id);
      }

      if (targetFrame) {
        // Ensure elements assigned to this frame sit cleanly inside it without overlapping existing children.
        const fBox = elementBounds(targetFrame);
        const targetIds = new Set(targets.map((t) => t.id));
        const existingInside = liveElements()
          .filter((el) => el.frameId === targetFrame!.id && !targetIds.has(el.id) && !(el.type === "text" && el.containerId))
          .map(elementBounds);
        for (const el of targets) {
          const b = elementBounds(el);
          const inside = b.x >= fBox.x && b.y >= fBox.y && b.x + b.width <= fBox.x + fBox.width && b.y + b.height <= fBox.y + fBox.height;
          if (!inside) {
            const pos = findFreePosition({ x: fBox.x + FRAME_PADDING, y: fBox.y + FRAME_TOP_PADDING }, b, existingInside, "right");
            moveElementWithBoundText(elements, el, pos.x, pos.y);
            existingInside.push({ x: pos.x, y: pos.y, width: b.width, height: b.height });
            movedIds.add(el.id);
            anyChanged = true;
          }
        }
        const memberBoxes = liveElements()
          .filter((el) => el.frameId === targetFrame!.id && !(el.type === "text" && el.containerId))
          .map(elementBounds);
        expandFrameToContain(targetFrame, memberBoxes);
        focusIds.add(targetFrame.id);
      }

      if (anyChanged) {
        const frameName = targetFrame ? shortLabel(getElementLabel(elements, targetFrame), "Frame") : null;
        changes.push({
          op: "move",
          block: 0,
          target: targets.length === 1
            ? { type: "elements", count: 1, name: shortLabel(getElementLabel(elements, targets[0]), targets[0].type) }
            : { type: "elements", count: targets.length },
          after: frameName ? `Move into frame "${frameName}"` : "Remove from frame",
        });
      }
      continue;
    }

    if (op.op === "arrange") {
      const ids = Array.isArray(op.elementIds) ? op.elementIds.filter((s): s is string => typeof s === "string" && s.trim().length > 0) : [];
      if (!ids.length) throw new WhiteboardEditError(`Operation #${i + 1} (arrange): elementIds must be a non-empty array.`);
      const layout: AiLayout = op.layout && (AI_LAYOUTS as readonly string[]).includes(op.layout) ? op.layout : "grid";

      const targets: WhiteboardElement[] = [];
      const seen = new Set<string>();
      for (const rawId of ids) {
        const el = resolveContainer(rawId.trim());
        if (!el) throw new WhiteboardEditError(`Operation #${i + 1} (arrange): element "${rawId}" not found.`);
        if (el.type === "frame") {
          // If a frame ID was passed, arrange its direct non-text children.
          for (const child of liveElements()) {
            if (child.frameId === el.id && child.type !== "frame" && !(child.type === "text" && child.containerId) && child.type !== "arrow" && child.type !== "line" && !seen.has(child.id)) {
              seen.add(child.id);
              targets.push(child);
            }
          }
          continue;
        }
        if (el.type === "arrow" || el.type === "line") continue;
        if (!seen.has(el.id)) {
          seen.add(el.id);
          targets.push(el);
        }
      }
      if (!targets.length) throw new WhiteboardEditError(`Operation #${i + 1} (arrange): no arrangeable elements found.`);
      if (targets.some((el) => mindmapDataOf(el.customData)?.role === "node")) {
        throw new WhiteboardEditError(`Operation #${i + 1} (arrange): mind-map nodes are automatically laid out as a tree and cannot be rearranged individually.`);
      }
      if (targets.some((el) => el.locked === true)) {
        throw new WhiteboardEditError(`Operation #${i + 1} (arrange): one or more selected elements are locked.`);
      }

      let targetFrame: WhiteboardElement | null = null;
      if (typeof op.frameId === "string" && op.frameId.trim()) {
        const frame = findLive(op.frameId.trim());
        if (!frame || frame.type !== "frame") throw new WhiteboardEditError(`Operation #${i + 1} (arrange): frame "${op.frameId}" not found.`);
        targetFrame = frame;
      }

      const currentUnion = unionBoxes(targets.map(elementBounds))!;
      const originX = targetFrame ? elementBounds(targetFrame).x + FRAME_PADDING : Math.round(currentUnion.x);
      const originY = targetFrame ? elementBounds(targetFrame).y + FRAME_TOP_PADDING : Math.round(currentUnion.y);
      const sizes = targets.map((el) => {
        const b = elementBounds(el);
        return { width: Math.max(40, b.width), height: Math.max(40, b.height) };
      });
      const positions = layoutBoxes(sizes, layout, originX, originY);

      targets.forEach((el, idx) => {
        moveElementWithBoundText(elements, el, positions[idx].x, positions[idx].y);
        movedIds.add(el.id);
        focusIds.add(el.id);
      });

      let newFrameName: string | null = null;
      if (targetFrame) {
        for (const el of targets) {
          el.frameId = targetFrame.id;
          for (const bound of elements) {
            if (bound.isDeleted !== true && bound.type === "text" && bound.containerId === el.id) bound.frameId = targetFrame.id;
          }
        }
        const memberBoxes = liveElements()
          .filter((el) => el.frameId === targetFrame!.id && !(el.type === "text" && el.containerId))
          .map(elementBounds);
        expandFrameToContain(targetFrame, memberBoxes);
        focusIds.add(targetFrame.id);
      } else if (typeof op.text === "string" && op.text.trim()) {
        // Optional frame wrapper around the arranged group (great for "Group & organize"!).
        newFrameName = sanitizeText(op.text, MAX_FRAME_NAME_LENGTH) || "Group";
        const arrangedUnion = unionBoxes(targets.map(elementBounds))!;
        const frameId = newId();
        const [frameEl] = convertSkeletons([{
          id: frameId,
          type: "frame",
          name: newFrameName,
          x: Math.round(arrangedUnion.x - FRAME_PADDING),
          y: Math.round(arrangedUnion.y - FRAME_TOP_PADDING),
          width: Math.round(arrangedUnion.width + FRAME_PADDING * 2),
          height: Math.round(arrangedUnion.height + FRAME_TOP_PADDING + FRAME_PADDING),
          children: [],
        }]);
        elements.push(frameEl);
        for (const el of targets) {
          el.frameId = frameId;
          for (const bound of elements) {
            if (bound.isDeleted !== true && bound.type === "text" && bound.containerId === el.id) bound.frameId = frameId;
          }
        }
        registerRef(op.ref, frameId);
        focusIds.add(frameId);
      }

      changes.push({
        op: "reorder",
        block: 0,
        target: { type: "elements", count: targets.length },
        after: newFrameName
          ? `Arrange ${targets.length} element${targets.length === 1 ? "" : "s"} in ${layout} inside frame "${newFrameName}"`
          : targetFrame
            ? `Arrange ${targets.length} element${targets.length === 1 ? "" : "s"} in ${layout} inside frame "${getElementLabel(elements, targetFrame)}"`
            : `Arrange ${targets.length} element${targets.length === 1 ? "" : "s"} in ${layout}`,
      });
      continue;
    }

    if (op.op === "group_elements") {
      const ids = Array.isArray(op.elementIds) ? op.elementIds.filter((s): s is string => typeof s === "string" && s.trim().length > 0) : [];
      if (ids.length < (op.ungroup ? 1 : 2)) {
        throw new WhiteboardEditError(`Operation #${i + 1} (group_elements): provide at least ${op.ungroup ? 1 : 2} element IDs.`);
      }
      const targets: WhiteboardElement[] = [];
      const seen = new Set<string>();
      for (const rawId of ids) {
        const el = resolveContainer(rawId.trim());
        if (!el) throw new WhiteboardEditError(`Operation #${i + 1} (group_elements): element "${rawId}" not found.`);
        if (!seen.has(el.id)) {
          seen.add(el.id);
          targets.push(el);
        }
      }

      if (op.ungroup) {
        let changed = false;
        for (const el of targets) {
          if (Array.isArray(el.groupIds) && el.groupIds.length) {
            el.groupIds = [];
            changed = true;
          }
          for (const bound of elements) {
            if (bound.isDeleted !== true && bound.type === "text" && bound.containerId === el.id && Array.isArray(bound.groupIds) && bound.groupIds.length) {
              bound.groupIds = [];
              changed = true;
            }
          }
          focusIds.add(el.id);
        }
        if (changed) {
          changes.push({ op: "update", block: 0, target: { type: "elements", count: targets.length }, after: `Ungroup ${targets.length} elements` });
        }
      } else {
        const groupId = newId();
        for (const el of targets) {
          const prev = Array.isArray(el.groupIds) ? (el.groupIds as string[]) : [];
          el.groupIds = [...prev, groupId];
          for (const bound of elements) {
            if (bound.isDeleted !== true && bound.type === "text" && bound.containerId === el.id) {
              const bPrev = Array.isArray(bound.groupIds) ? (bound.groupIds as string[]) : [];
              bound.groupIds = [...bPrev, groupId];
            }
          }
          focusIds.add(el.id);
        }
        changes.push({ op: "update", block: 0, target: { type: "elements", count: targets.length }, after: `Group ${targets.length} elements` });
      }
      continue;
    }

    throw new WhiteboardEditError(`Operation #${i + 1}: unsupported op "${String((op as { op?: unknown }).op)}".`);
  }

  // Relayout any mindmap trees that had nodes resized or deleted.
  if (relayoutRoots.size) {
    const mmRelayout = relayoutMindmaps(elements as unknown as SceneElement[], relayoutRoots);
    if (mmRelayout.patches.size || mmRelayout.added.length) {
      elements = applyMindmapChangeToArray(elements, mmRelayout);
    }
  }

  // Re-route bound non-mindmap arrows connected to moved/resized elements.
  syncBoundArrowsFor(elements, movedIds);

  const data = finalizeWhiteboard(elements, files, appState);
  const unchanged = JSON.stringify(data) === beforeJson && !changes.length;
  return { data, changes, focusIds: [...focusIds], unchanged };
}
