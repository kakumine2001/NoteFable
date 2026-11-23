import { DEFAULT_TEXT_STYLE, newId, SLIDE_HEIGHT, SLIDE_WIDTH, type ImageElement, type LineElement, type ShapeElement, type ShapeKind, type TableElement, type TextElement, type WhiteboardElement } from "@/lib/slides/model";
import { richDocFromText } from "@/lib/slides/rich-text";

// 挿入する要素の初期値（スライドの中央に置く）。

const center = (w: number, h: number) => ({ x: Math.round((SLIDE_WIDTH - w) / 2), y: Math.round((SLIDE_HEIGHT - h) / 2) });

export function createTextElement(text = "", at?: { x: number; y: number }): TextElement {
  const w = 800;
  const h = 80;
  const position = at ? { x: Math.round(at.x - w / 2), y: Math.round(at.y - h / 2) } : center(w, h);
  return { id: newId(), type: "text", ...position, w, h, rotation: 0, doc: richDocFromText(text), style: { ...DEFAULT_TEXT_STYLE }, fill: null, autoHeight: true };
}

export function createShapeElement(shape: ShapeKind): ShapeElement {
  const w = shape === "arrowRight" || shape === "arrowLeft" || shape === "chevron" || shape === "parallelogram" ? 480 : 360;
  const h = 360 * (w === 480 ? 0.6 : 1);
  return {
    id: newId(), type: "shape", ...center(w, h), w, h, rotation: 0, shape, fill: "accent", stroke: null, strokeWidth: 0, dash: "solid",
    doc: richDocFromText(""), style: { ...DEFAULT_TEXT_STYLE, align: "center", valign: "middle", color: "background" },
  };
}

export function createLineElement(arrow = false): LineElement {
  return { id: newId(), type: "line", x: 660, y: 540, w: 600, h: 0, rotation: 0, stroke: "text", strokeWidth: 6, dash: "solid", start: "none", end: arrow ? "arrow" : "none", flipH: false, flipV: false };
}

export function createTableElement(rows: number, cols: number): TableElement {
  const w = Math.min(1600, cols * 320);
  const h = Math.min(840, rows * 90);
  return {
    id: newId(), type: "table", ...center(w, h), w, h, rotation: 0,
    rows: Array.from({ length: rows }, () => ({ cells: Array.from({ length: cols }, () => ({ text: "" })) })),
    cols: Array.from({ length: cols }, () => 1), header: true,
    style: { size: 28, color: "text", border: "line", headerFill: "surface", font: "body" },
  };
}

// ホワイトボードの枠の静止画（画像と同じ大きさの決め方）。
export function createWhiteboardElement(frame: { pageId: string; frameId: string; frameName: string; src: string; width: number; height: number }): WhiteboardElement {
  const { x, y, w, h } = createImageElement(frame.src, frame.width, frame.height);
  return { id: newId(), type: "whiteboard", x, y, w, h, rotation: 0, src: frame.src, pageId: frame.pageId.slice(0, 64), frameId: frame.frameId.slice(0, 120), frameName: frame.frameName.slice(0, 200) };
}

// 画像を、元の縦横比のままスライドに収まる大きさで中央（または at の位置）に置く。
export function createImageElement(src: string, naturalWidth: number, naturalHeight: number, alt = "", at?: { x: number; y: number }): ImageElement {
  const ratio = naturalWidth > 0 && naturalHeight > 0 ? naturalWidth / naturalHeight : 16 / 9;
  let w = Math.min(1200, naturalWidth || 1200);
  let h = w / ratio;
  if (h > 800) { h = 800; w = h * ratio; }
  w = Math.round(w);
  h = Math.round(h);
  const position = at ? { x: Math.round(Math.min(SLIDE_WIDTH - w, Math.max(0, at.x - w / 2))), y: Math.round(Math.min(SLIDE_HEIGHT - h, Math.max(0, at.y - h / 2))) } : center(w, h);
  return { id: newId(), type: "image", ...position, w, h, rotation: 0, src, alt: alt.slice(0, 500), fit: "cover", radius: 0 };
}
