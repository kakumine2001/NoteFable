import { parseNoteFileUrl } from "@/lib/note-file-keys";
import { MAX_SLIDE_ELEMENTS, MAX_SLIDE_NOTES, MAX_SLIDES } from "@/lib/canvas-document";
import { normalizeRichDoc, type RichDoc } from "@/lib/slides/rich-text";

// スライド（幻灯片）の本体の形（docs/architecture/slides.md）。NoteCanvas.data に入る。
// サーバーは外枠（slides[].id・elements[].id・notes・hidden・layout・theme がオブジェクト）だけを確かめるので、
// 中身はここで定める。画面に出す前にはいつも normalizeDeck を通す（壊れた値・知らない値・外部 URL を落とす）。
// このファイルは prisma を読み込まない（画面・公開ページのサーバー部品の両方から使う）。

// 1 枚は 16:9 の 1920 × 1080（論理ピクセル）。表示ではこれを縮める。PPTX では 13.333 × 7.5 インチ（1 px = 0.5 pt）。
export const SLIDE_WIDTH = 1920;
export const SLIDE_HEIGHT = 1080;
export const DECK_FORMAT = 1;

// 色は主題の色の名前か #rrggbb。主題を替えると名前の色がそろって替わる。
export const COLOR_TOKENS = ["background", "surface", "text", "muted", "heading", "accent", "accent2", "accent3", "line"] as const;
export type ColorToken = (typeof COLOR_TOKENS)[number];
export type ColorRef = ColorToken | `#${string}`;
const HEX = /^#[0-9a-f]{6}$/i;
export function isColorRef(value: unknown): value is ColorRef {
  return typeof value === "string" && ((COLOR_TOKENS as readonly string[]).includes(value) || HEX.test(value));
}

export const LAYOUT_IDS = ["title", "section", "bullets", "twoColumn", "imageText", "quote", "fullImage", "blank"] as const;
export type LayoutId = (typeof LAYOUT_IDS)[number];
export const isLayoutId = (value: unknown): value is LayoutId => typeof value === "string" && (LAYOUT_IDS as readonly string[]).includes(value);

export const SLIDE_TRANSITIONS = ["none", "fade", "slide"] as const;
export type SlideTransition = (typeof SLIDE_TRANSITIONS)[number];
export const isSlideTransition = (value: unknown): value is SlideTransition => typeof value === "string" && (SLIDE_TRANSITIONS as readonly string[]).includes(value);

// 放映時の切り替えアニメ用クラス。初回表示（direction === null）・「なし」・動きを減らす設定では付けない。
export function slideTransitionClass(transition: SlideTransition | undefined, direction: "forward" | "backward" | null, reducedMotion = false): string {
  if (reducedMotion || !direction || !transition || transition === "none") return "";
  if (transition === "fade") return "slide-transition-fade";
  return direction === "backward" ? "slide-transition-slide-backward" : "slide-transition-slide-forward";
}

// 版式の置き場所（プレースホルダー）の役目。版式を替えるときは役目ごとに中身を移す。
export const ROLES = ["title", "subtitle", "body", "body2", "image", "quote", "attribution", "caption"] as const;
export type Role = (typeof ROLES)[number];
const isRole = (value: unknown): value is Role => typeof value === "string" && (ROLES as readonly string[]).includes(value);

export type FontRole = "heading" | "body" | "mono";
export type HAlign = "left" | "center" | "right" | "justify";
export type VAlign = "top" | "middle" | "bottom";
export type TextStyle = {
  font: FontRole;
  // 論理ピクセル（1920 幅のとき）。
  size: number;
  color: ColorRef;
  align: HAlign;
  valign: VAlign;
  lineHeight: number;
  bold: boolean;
  italic: boolean;
};

export const SHAPE_KINDS = ["rect", "roundRect", "ellipse", "triangle", "rightTriangle", "diamond", "pentagon", "hexagon", "star", "arrowRight", "arrowLeft", "chevron", "parallelogram", "plus", "callout"] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];
export type Dash = "solid" | "dash" | "dot";
export type LineCap = "none" | "arrow" | "triangle" | "oval";

type ElementBase = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  // 度（時計回り）。線は回さない（向きは端点で表す）。
  rotation: number;
  // 組み合わせ（グループ）の ID。同じ値の要素は一緒に選ばれ、一緒に動く。
  group?: string;
  // 版式の置き場所の役目。自由に置いた要素には無い。
  role?: Role;
  opacity?: number;
};
export type TextElement = ElementBase & { type: "text"; doc: RichDoc; style: TextStyle; fill: ColorRef | null; autoHeight: boolean };
export type ShapeElement = ElementBase & { type: "shape"; shape: ShapeKind; fill: ColorRef | null; stroke: ColorRef | null; strokeWidth: number; dash: Dash; doc: RichDoc; style: TextStyle };
// 線は箱（x, y, w, h）の対角。flipH / flipV で向きを変える（PPTX と同じ表し方）。
export type LineElement = ElementBase & { type: "line"; stroke: ColorRef; strokeWidth: number; dash: Dash; start: LineCap; end: LineCap; flipH: boolean; flipV: boolean };
// src は自分の note-files の URL（/api/pages/files?key=…）。空文字は「画像を置く場所」（版式の置き場所）。
// generated は AI で作った画像（報告のためにプロンプトを残す。公開ページには出さない）。
export type ImageElement = ElementBase & { type: "image"; src: string; alt: string; fit: "cover" | "contain"; radius: number; generated?: { prompt: string } };
export type TableCell = { text: string };
export type TableElement = ElementBase & {
  type: "table"; rows: { cells: TableCell[] }[]; cols: number[]; header: boolean;
  style: { size: number; color: ColorRef; border: ColorRef; headerFill: ColorRef; font: FontRole };
};
// ホワイトボードの枠の静止画（#152 のホワイトボードから取り込む）。src はその時点の画像（note-files）。
export type WhiteboardElement = ElementBase & { type: "whiteboard"; src: string; pageId: string; frameId: string; frameName: string };
export type SlideElement = TextElement | ShapeElement | LineElement | ImageElement | TableElement | WhiteboardElement;
export type ElementType = SlideElement["type"];

export type Slide = {
  id: string;
  layout: LayoutId;
  hidden?: boolean;
  // 演説者ノート（プレーンテキスト）。
  notes?: string;
  // あると、この枚から総覧の新しい行（章）が始まる。値は章の名前（空でもよい）。先頭の枚は名前が無くても 1 行目。
  section?: string;
  background?: ColorRef | null;
  // 放映時の切り替え（fade / slide）。未指定と none は即座に切り替え（保存時は none を省き、古い本体と完全互換にする）。
  transition?: SlideTransition;
  elements: SlideElement[];
};
export type ThemeMode = "light" | "dark";
export type DeckTheme = { id: string; mode: ThemeMode };
export type Deck = { format: number; theme: DeckTheme; slides: Slide[] };

export const DEFAULT_THEME: DeckTheme = { id: "simple", mode: "light" };

// ---- ID ----

export function newId(): string {
  const bytes = new Uint8Array(9);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(36).padStart(2, "0")).join("").slice(0, 16);
}

// ---- 読み込み（壊れた値を直す） ----

const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const MAX_COORD = 100_000;
function num(value: unknown, fallback: number, min = -MAX_COORD, max = MAX_COORD) {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}
const color = (value: unknown, fallback: ColorRef): ColorRef => (isColorRef(value) ? value : fallback);
const optionalColor = (value: unknown, fallback: ColorRef | null): ColorRef | null => (value === null ? null : isColorRef(value) ? value : fallback);
const pick = <T extends string>(value: unknown, options: readonly T[], fallback: T): T => (typeof value === "string" && (options as readonly string[]).includes(value) ? value as T : fallback);
const shortText = (value: unknown, max: number) => (typeof value === "string" ? value.slice(0, max) : "");

// 画像の URL は自分の note-files のものだけ（外部の URL・埋め込みは表示しない。公開ページで外部に読み込みを漏らさない）。
export function safeImageSrc(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  const parsed = parseNoteFileUrl(value);
  return parsed && parsed !== "empty" ? value : "";
}

export const DEFAULT_TEXT_STYLE: TextStyle = { font: "body", size: 40, color: "text", align: "left", valign: "top", lineHeight: 1.3, bold: false, italic: false };

export function normalizeTextStyle(value: unknown, fallback: TextStyle = DEFAULT_TEXT_STYLE): TextStyle {
  const style = object(value) ? value : {};
  return {
    font: pick(style.font, ["heading", "body", "mono"] as const, fallback.font),
    size: num(style.size, fallback.size, 4, 800),
    color: color(style.color, fallback.color),
    align: pick(style.align, ["left", "center", "right", "justify"] as const, fallback.align),
    valign: pick(style.valign, ["top", "middle", "bottom"] as const, fallback.valign),
    lineHeight: num(style.lineHeight, fallback.lineHeight, 0.8, 3),
    bold: typeof style.bold === "boolean" ? style.bold : fallback.bold,
    italic: typeof style.italic === "boolean" ? style.italic : fallback.italic,
  };
}

function normalizeBase(value: Record<string, unknown>, id: string): ElementBase {
  const base: ElementBase = {
    id, x: num(value.x, 0), y: num(value.y, 0), w: num(value.w, 100, 0), h: num(value.h, 100, 0), rotation: num(value.rotation, 0, -360, 360),
  };
  if (typeof value.group === "string" && value.group && value.group.length <= 120) base.group = value.group;
  if (isRole(value.role)) base.role = value.role;
  if (typeof value.opacity === "number" && Number.isFinite(value.opacity)) base.opacity = Math.min(1, Math.max(0, value.opacity));
  return base;
}

export function normalizeElement(value: unknown, id: string): SlideElement | null {
  if (!object(value)) return null;
  const base = normalizeBase(value, id);
  switch (value.type) {
    case "text":
      return { ...base, type: "text", doc: normalizeRichDoc(value.doc), style: normalizeTextStyle(value.style), fill: optionalColor(value.fill, null), autoHeight: value.autoHeight === true };
    case "shape":
      return {
        ...base, type: "shape", shape: pick(value.shape, SHAPE_KINDS, "rect"), fill: optionalColor(value.fill, "accent"), stroke: optionalColor(value.stroke, null),
        strokeWidth: num(value.strokeWidth, 0, 0, 200), dash: pick(value.dash, ["solid", "dash", "dot"] as const, "solid"),
        doc: normalizeRichDoc(value.doc), style: normalizeTextStyle(value.style, { ...DEFAULT_TEXT_STYLE, align: "center", valign: "middle", color: "background" }),
      };
    case "line":
      return {
        ...base, rotation: 0, type: "line", stroke: color(value.stroke, "text"), strokeWidth: num(value.strokeWidth, 4, 0.5, 200),
        dash: pick(value.dash, ["solid", "dash", "dot"] as const, "solid"), start: pick(value.start, ["none", "arrow", "triangle", "oval"] as const, "none"),
        end: pick(value.end, ["none", "arrow", "triangle", "oval"] as const, "none"), flipH: value.flipH === true, flipV: value.flipV === true,
      };
    case "image": {
      const image: ImageElement = {
        ...base, type: "image", src: safeImageSrc(value.src), alt: shortText(value.alt, 500), fit: pick(value.fit, ["cover", "contain"] as const, "cover"), radius: num(value.radius, 0, 0, 540),
      };
      if (object(value.generated) && typeof value.generated.prompt === "string") image.generated = { prompt: value.generated.prompt.slice(0, 4000) };
      return image;
    }
    case "table": {
      const rows = Array.isArray(value.rows) ? value.rows.slice(0, 50) : [];
      const width = Math.min(20, Math.max(1, ...rows.map((row) => (object(row) && Array.isArray(row.cells) ? row.cells.length : 0))));
      const normalizedRows = rows.map((row) => {
        const cells = object(row) && Array.isArray(row.cells) ? row.cells : [];
        return { cells: Array.from({ length: width }, (_, index) => ({ text: object(cells[index]) ? shortText(cells[index].text, 2000) : "" })) };
      });
      if (!normalizedRows.length) normalizedRows.push({ cells: Array.from({ length: width }, () => ({ text: "" })) });
      const cols = Array.isArray(value.cols) && value.cols.length === width ? value.cols.map((col) => num(col, 1, 0.05, 20)) : Array.from({ length: width }, () => 1);
      const style = object(value.style) ? value.style : {};
      return {
        ...base, type: "table", rows: normalizedRows, cols, header: value.header !== false,
        style: {
          size: num(style.size, 28, 6, 200), color: color(style.color, "text"), border: color(style.border, "line"), headerFill: color(style.headerFill, "surface"),
          font: pick(style.font, ["heading", "body", "mono"] as const, "body"),
        },
      };
    }
    case "whiteboard":
      return {
        ...base, type: "whiteboard", src: safeImageSrc(value.src), pageId: shortText(value.pageId, 64), frameId: shortText(value.frameId, 120), frameName: shortText(value.frameName, 200),
      };
    default:
      return null;
  }
}

function normalizeSlide(value: unknown, seenSlides: Set<string>, seenElements: Set<string>): Slide | null {
  if (!object(value)) return null;
  const id = typeof value.id === "string" && value.id && value.id.length <= 120 && !seenSlides.has(value.id) ? value.id : newId();
  seenSlides.add(id);
  const elements: SlideElement[] = [];
  for (const raw of Array.isArray(value.elements) ? value.elements.slice(0, MAX_SLIDE_ELEMENTS) : []) {
    const rawId = object(raw) && typeof raw.id === "string" && raw.id && raw.id.length <= 120 && !seenElements.has(raw.id) ? raw.id : newId();
    const element = normalizeElement(raw, rawId);
    if (!element) continue;
    seenElements.add(element.id);
    elements.push(element);
  }
  const slide: Slide = { id, layout: isLayoutId(value.layout) ? value.layout : "blank", elements };
  if (value.hidden === true) slide.hidden = true;
  if (typeof value.notes === "string" && value.notes) slide.notes = value.notes.slice(0, MAX_SLIDE_NOTES);
  if (typeof value.section === "string") slide.section = value.section.slice(0, 200);
  if (value.background !== undefined) slide.background = optionalColor(value.background, null);
  if (value.transition === "fade" || value.transition === "slide") slide.transition = value.transition;
  return slide;
}

// 保存された本体（または他の端末・古い版・AI が書いたもの）を、画面で安全に扱える形にする。知らない値は既定値にし、
// 壊れた要素・知らない種類の要素は捨て、重複した ID は付け直す。
export function normalizeDeck(value: unknown): Deck {
  const data = object(value) ? value : {};
  const theme = object(data.theme) ? data.theme : {};
  const seenSlides = new Set<string>();
  const seenElements = new Set<string>();
  const slides = (Array.isArray(data.slides) ? data.slides.slice(0, MAX_SLIDES) : [])
    .map((slide) => normalizeSlide(slide, seenSlides, seenElements)).filter((slide): slide is Slide => slide !== null);
  return {
    format: DECK_FORMAT,
    theme: { id: typeof theme.id === "string" && theme.id.length <= 64 ? theme.id : DEFAULT_THEME.id, mode: theme.mode === "dark" ? "dark" : "light" },
    slides,
  };
}

// ---- 一覧 ----

export function visibleSlides(deck: Deck) {
  return deck.slides.filter((slide) => !slide.hidden);
}

// 総覧の行（章）。section を持つ枚から新しい行が始まる。
export type SlideRow = { title: string; slides: Slide[]; start: number };
export function slideRows(slides: Slide[]): SlideRow[] {
  const rows: SlideRow[] = [];
  slides.forEach((slide, index) => {
    if (!rows.length || slide.section !== undefined) rows.push({ title: slide.section ?? "", slides: [], start: index });
    rows[rows.length - 1].slides.push(slide);
  });
  return rows;
}

// 行の並びから平らな並びへ戻す。各行の先頭の枚が行の名前（section）を持つ。空の行は消える。
export function slidesFromRows(rows: { title: string; slides: Slide[] }[]): Slide[] {
  const out: Slide[] = [];
  rows.filter((row) => row.slides.length).forEach((row, rowIndex) => {
    row.slides.forEach((slide, index) => {
      const { section: _section, ...rest } = slide;
      void _section;
      out.push(index === 0 && (rowIndex > 0 || row.title) ? { ...rest, section: row.title } : rest);
    });
  });
  return out;
}

// ---- ファイル ----

// 本体が参照している画像（note-files の URL）。公開ページで、この中にあるファイルだけを返す。
export function deckImageSources(deck: Deck): string[] {
  const out = new Set<string>();
  for (const slide of deck.slides) for (const element of slide.elements) {
    if ((element.type === "image" || element.type === "whiteboard") && element.src) out.add(element.src);
  }
  return [...out];
}
