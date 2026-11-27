import { prepareNoteMarkdown } from "@/lib/answer-export";
import {
  MAX_CANVAS_BYTES,
  MAX_SLIDE_ELEMENTS,
  MAX_SLIDE_NOTES,
  MAX_SLIDES,
  validateCanvasData,
  type CanvasData,
} from "@/lib/canvas-document";
import { markdownToBlocks } from "@/lib/note-markdown";
import type { ProposalChange } from "@/lib/page-ai/types";
import { cleanText, oneLine } from "@/lib/slides/ai-wizard";
import { applyLayout, createSlide, layoutDefinition, placeholderHasContent } from "@/lib/slides/layouts";
import {
  DECK_FORMAT,
  DEFAULT_THEME,
  isLayoutId,
  isSlideTransition,
  newId,
  normalizeDeck,
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  slideRows,
  slidesFromRows,
  type Deck,
  type DeckTheme,
  type ImageElement,
  type LayoutId,
  type Slide,
  type SlideElement,
  type SlideTransition,
  type TextElement,
  type ThemeMode,
  type WhiteboardElement,
} from "@/lib/slides/model";
import { blocksHaveVisibleContent, noteToDeckResult } from "@/lib/slides/note-to-deck";
import { deleteSlides } from "@/lib/slides/ops";
import {
  isRichDocEmpty,
  normalizeRichDoc,
  richDocFromText,
  richDocText,
  type RichBlock,
  type RichDoc,
  type RichInline,
} from "@/lib/slides/rich-text";
import { SLIDE_THEMES } from "@/lib/slides/themes";

// スライド（幻灯片）の AI 作成・編集・一括スタイル変更（SA2）の決定論的エンジン。
// モデルは座標を一切出力しない。Markdown の本文や版式・テーマ・操作だけを受け取り、
// noteToDeckResult・applyLayout・normalizeDeck・validateCanvasData で安全な Deck を組み立てる。
// prisma・DOM には依存しない純粋なモジュール。

export const MAX_AI_SLIDES_OPS = 50;
export const MAX_AI_CREATE_SLIDES = 100;
export const MAX_SLIDE_BODY_CHARS = 60_000;
export const MAX_SLIDE_TITLE_CHARS = 200;
export const MAX_SECTION_CHARS = 200;

export const SLIDE_THEME_IDS = SLIDE_THEMES.map((theme) => theme.id) as [string, ...string[]];
export const SLIDE_THEME_MODES = ["light", "dark"] as const;

export class SlidesEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SlidesEditError";
  }
}

export type CreateSlideInput = {
  title?: string | null;
  body?: string | null;
  notes?: string | null;
  layout?: string | null;
  section?: string | null;
};

export type BuildAiSlidesDeckInput = {
  title: string;
  theme?: { themeId?: string | null; mode?: string | null } | null;
  slides?: readonly CreateSlideInput[] | null;
};

export type BuildAiSlidesDeckResult = {
  data: CanvasData;
  deck: Deck;
  content: string;
  changes: ProposalChange[];
  focusIds: string[];
};

export type SlidesEditResult = {
  data: CanvasData;
  deck: Deck;
  changes: ProposalChange[];
  focusIds: string[];
  unchanged: boolean;
};

type Block = ReturnType<typeof markdownToBlocks>[number];

type NoteRawInline =
  | { type: "text"; text: string; styles?: Record<string, unknown> }
  | { type: "link"; href: string; content: NoteRawInline[] }
  | { type: "mathInline"; props: { latex: string } };

type NoteRawBlock = {
  id: string;
  type: string;
  props: Record<string, unknown>;
  content?: unknown;
  children: NoteRawBlock[];
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function isValidThemeId(value: unknown): value is string {
  return typeof value === "string" && SLIDE_THEMES.some((theme) => theme.id === value);
}

export function isValidThemeMode(value: unknown): value is ThemeMode {
  return value === "light" || value === "dark";
}

function asOptionalString(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new SlidesEditError(`${field} must be a string or null.`);
  return value;
}

function asOptionalBoolean(value: unknown, field: string): boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "boolean") throw new SlidesEditError(`${field} must be a boolean or null.`);
  return value;
}

function asOptionalLayout(value: unknown, field = "layout"): LayoutId | null {
  if (value === null || value === undefined) return null;
  if (!isLayoutId(value)) throw new SlidesEditError(`${field} must be a valid slide layout or null.`);
  return value;
}

function asOptionalTransition(value: unknown): SlideTransition | null {
  if (value === null || value === undefined) return null;
  if (!isSlideTransition(value)) throw new SlidesEditError("transition must be one of none, fade, slide, or null.");
  return value;
}

function validateNotes(raw: string | null): string | null {
  if (raw === null) return null;
  const cleaned = cleanText(raw).trim();
  if (cleaned.length > MAX_SLIDE_NOTES) {
    throw new SlidesEditError(`Speaker notes must be at most ${MAX_SLIDE_NOTES} characters.`);
  }
  return cleaned;
}

function validateTitleText(raw: string | null, field = "title"): string | null {
  if (raw === null) return null;
  const cleaned = oneLine(raw);
  if (cleaned.length > MAX_SLIDE_TITLE_CHARS) {
    throw new SlidesEditError(`${field} must be at most ${MAX_SLIDE_TITLE_CHARS} characters.`);
  }
  return cleaned;
}

function validateBodyText(raw: string | null, field = "body"): string | null {
  if (raw === null) return null;
  const cleaned = cleanText(raw);
  if (cleaned.length > MAX_SLIDE_BODY_CHARS) {
    throw new SlidesEditError(`${field} must be at most ${MAX_SLIDE_BODY_CHARS} characters.`);
  }
  return cleaned;
}

function validateSectionText(raw: string | null): string | null {
  if (raw === null) return null;
  const cleaned = oneLine(raw);
  if (cleaned.length > MAX_SECTION_CHARS) {
    throw new SlidesEditError(`section must be at most ${MAX_SECTION_CHARS} characters.`);
  }
  return cleaned;
}

// 本文中の画像・区切り線・目次は取り除き（子は残す）、H1 は小見出しに落として 1 枚分の意図しない分割を防ぐ。
function sanitizeBodyBlocks(blocks: Block[]): NoteRawBlock[] {
  return blocks.flatMap((block) => {
    const children = sanitizeBodyBlocks(block.children);
    if (block.type === "image" || block.type === "divider" || block.type === "tableOfContents") return children;
    const props = block.type === "heading" && block.props.level === 1 ? { ...block.props, level: 3 } : block.props;
    return [{ ...block, props, children }];
  });
}

function headingBlockFor(title: string, titleInline?: readonly NoteRawInline[]): NoteRawBlock[] {
  if (titleInline?.length) {
    return [{ id: "", type: "heading", props: { level: 2 }, content: [...titleInline], children: [] }];
  }
  if (!title) return [];
  const parsed = markdownToBlocks(prepareNoteMarkdown(`## ${title}`, { dropImages: true })).slice(0, 1);
  if (blocksHaveVisibleContent(parsed)) return parsed;
  return [{ id: "", type: "heading", props: { level: 2 }, content: [{ type: "text", text: title, styles: {} }], children: [] }];
}

function isSimpleBodyBlocks(blocks: readonly NoteRawBlock[], maxChars: number): string | null {
  if (!blocks.length) return "";
  if (blocks.some((b) => b.type !== "paragraph" || b.children.length > 0)) return null;
  const lines: string[] = [];
  for (const b of blocks) {
    const content = Array.isArray(b.content) ? b.content : [];
    const text = content
      .map((node) => {
        if (!isObject(node)) return "";
        if (node.type === "text" && typeof node.text === "string") return node.text;
        return "";
      })
      .join("")
      .trim();
    const hasRich = content.some((node) => {
      if (!isObject(node)) return false;
      if (node.type === "mathInline" || node.type === "link") return true;
      if (node.type === "text" && isObject(node.styles) && Object.keys(node.styles).length > 0) return true;
      return false;
    });
    if (hasRich) return null;
    if (text) lines.push(text);
  }
  const joined = lines.join("\n").trim();
  return joined.length <= maxChars ? joined : null;
}

// 2 段組み版式を指定されたとき、箇条書きや複数段落を左右の body / body2 に均等に分ける。
// 既に空の body2 プレースホルダーがある場合はそこへ流し込む（中身がある body2 はそのまま保つ）。
function splitBodyIntoTwoColumns(slide: Slide): Slide {
  const bodyEl = slide.elements.find((el): el is TextElement => el.type === "text" && el.role === "body");
  const existingBody2 = slide.elements.find((el): el is TextElement => el.type === "text" && el.role === "body2");
  if (!bodyEl || (existingBody2 && !isRichDocEmpty(existingBody2.doc))) {
    return slide.layout === "twoColumn" ? slide : applyLayout(slide, "twoColumn");
  }

  const blocks = bodyEl.doc.content;
  let leftDoc: RichDoc | null = null;
  let rightDoc: RichDoc | null = null;

  if (blocks.length === 1 && (blocks[0].type === "bullet_list" || blocks[0].type === "ordered_list") && blocks[0].content.length >= 2) {
    const list = blocks[0];
    const mid = Math.ceil(list.content.length / 2);
    if (list.type === "bullet_list") {
      leftDoc = { type: "doc", content: [{ type: "bullet_list", content: list.content.slice(0, mid) }] };
      rightDoc = { type: "doc", content: [{ type: "bullet_list", content: list.content.slice(mid) }] };
    } else {
      const start = list.attrs?.order ?? 1;
      leftDoc = { type: "doc", content: [{ type: "ordered_list", attrs: { order: start }, content: list.content.slice(0, mid) }] };
      rightDoc = { type: "doc", content: [{ type: "ordered_list", attrs: { order: start + mid }, content: list.content.slice(mid) }] };
    }
  } else if (blocks.length >= 2) {
    const mid = Math.ceil(blocks.length / 2);
    leftDoc = { type: "doc", content: blocks.slice(0, mid) };
    rightDoc = { type: "doc", content: blocks.slice(mid) };
  }

  if (!leftDoc || !rightDoc) {
    return slide.layout === "twoColumn" ? slide : applyLayout(slide, "twoColumn");
  }

  const updatedLeft: TextElement = { ...bodyEl, doc: normalizeRichDoc(leftDoc) };
  const nextElements = slide.elements.map((el) => {
    if (el.id === bodyEl.id) return updatedLeft;
    if (existingBody2 && el.id === existingBody2.id) return { ...existingBody2, doc: normalizeRichDoc(rightDoc!) };
    return el;
  });
  if (!existingBody2) {
    nextElements.push({
      ...bodyEl,
      id: newId(),
      role: "body2",
      doc: normalizeRichDoc(rightDoc),
    });
  }
  const updatedSlide: Slide = { ...slide, elements: nextElements };
  return updatedSlide.layout === "twoColumn" ? updatedSlide : applyLayout(updatedSlide, "twoColumn");
}

function stripSection(slide: Slide): Slide {
  const { section: _section, ...rest } = slide;
  void _section;
  return rest as Slide;
}

function applyMetadata(
  slide: Slide,
  meta: { notes?: string | null; hidden?: boolean | null; transition?: SlideTransition | null; section?: string | null },
): Slide {
  let out: Slide = { ...slide };
  if (meta.notes !== undefined && meta.notes !== null) {
    if (meta.notes) out.notes = meta.notes;
    else {
      const { notes: _notes, ...rest } = out;
      void _notes;
      out = rest as Slide;
    }
  }
  if (meta.hidden !== undefined && meta.hidden !== null) {
    if (meta.hidden) out.hidden = true;
    else {
      const { hidden: _hidden, ...rest } = out;
      void _hidden;
      out = rest as Slide;
    }
  }
  if (meta.transition !== undefined && meta.transition !== null) {
    if (meta.transition === "fade" || meta.transition === "slide") out.transition = meta.transition;
    else {
      const { transition: _transition, ...rest } = out;
      void _transition;
      out = rest as Slide;
    }
  }
  if (meta.section !== undefined && meta.section !== null) {
    out.section = meta.section;
  }
  return out;
}

function alignRichDoc(doc: RichDoc, align: string | null): RichDoc {
  return {
    type: "doc",
    content: doc.content.map((block) => (
      block.type === "paragraph"
        ? { ...block, attrs: { align } }
        : block
    )),
  };
}

function hasRichFormattingInDoc(doc: RichDoc): boolean {
  if (doc.content.length > 1) return true;
  for (const block of doc.content) {
    if (block.type !== "paragraph") return true;
    for (const node of block.content ?? []) {
      if (node.type !== "text" || (node.marks && node.marks.length > 0)) return true;
    }
  }
  return false;
}

// 1 枚分のタイトル・ブロック列・版式から、安全領域に収まる 1 枚以上のスライドを作る。
function buildSlidesFromParsedBlocks(
  input: {
    title: string;
    titleInline?: readonly NoteRawInline[];
    titleDoc?: RichDoc;
    bodyBlocks: NoteRawBlock[];
    notes: string | null;
    layout: LayoutId | null;
    section?: string | null;
    hidden?: boolean | null;
    transition?: SlideTransition | null;
  },
  theme: DeckTheme,
): Slide[] {
  const title = input.title.trim();
  const bodyParsed = input.bodyBlocks;
  const hasVisibleBody = blocksHaveVisibleContent(bodyParsed);
  const hasTitleDoc = Boolean(input.titleDoc && !isRichDocEmpty(input.titleDoc));
  const hasRichTitle = Boolean(input.titleDoc && hasRichFormattingInDoc(input.titleDoc)) || Boolean(
    input.titleInline?.some(
      (node) => node.type !== "text" || (node.styles && Object.keys(node.styles).length > 0),
    ),
  );

  if (!title && !hasTitleDoc && !input.titleInline?.length && !hasVisibleBody) {
    const empty = createSlide(input.layout ?? "blank");
    return [applyMetadata(empty, { notes: input.notes, hidden: input.hidden, transition: input.transition, section: input.section })];
  }

  // title / section / quote は単純な文字だけなら専用プレースホルダーに直接入れて自然な見た目を保つ。
  if (input.layout === "title" && !hasRichTitle) {
    const simpleSub = isSimpleBodyBlocks(bodyParsed, 320);
    if (simpleSub !== null) {
      const slide = createSlide("title", { ...(title ? { title } : {}), ...(simpleSub ? { subtitle: simpleSub } : {}) });
      if (!simpleSub) slide.elements = slide.elements.filter((el) => el.role !== "subtitle");
      return [applyMetadata(slide, { notes: input.notes, hidden: input.hidden, transition: input.transition, section: input.section })];
    }
  }
  if (input.layout === "section" && !hasRichTitle) {
    const simpleSub = isSimpleBodyBlocks(bodyParsed, 240);
    if (simpleSub !== null) {
      const slide = createSlide("section", { ...(title ? { title } : {}), ...(simpleSub ? { subtitle: simpleSub } : {}) });
      if (!simpleSub) slide.elements = slide.elements.filter((el) => el.role !== "subtitle");
      return [applyMetadata(slide, { notes: input.notes, hidden: input.hidden, transition: input.transition, section: input.section })];
    }
  }
  if (input.layout === "quote") {
    const simpleBody = isSimpleBodyBlocks(bodyParsed, 400);
    if (simpleBody !== null) {
      const hasAttr = Boolean(simpleBody && (title || hasTitleDoc));
      const quoteText = simpleBody || title;
      const attribution = hasAttr ? title : "";
      const slide = createSlide("quote", { quote: quoteText, ...(attribution ? { attribution } : {}) });
      if (hasTitleDoc && input.titleDoc) {
        const targetRole = hasAttr ? "attribution" : "quote";
        const idx = slide.elements.findIndex((el) => el.type === "text" && el.role === targetRole);
        if (idx >= 0) {
          const targetEl = slide.elements[idx] as TextElement;
          slide.elements[idx] = { ...targetEl, doc: normalizeRichDoc(alignRichDoc(input.titleDoc, targetEl.style.align)) };
        }
      }
      if (!hasAttr) slide.elements = slide.elements.filter((el) => el.role !== "attribution");
      return [applyMetadata(slide, { notes: input.notes, hidden: input.hidden, transition: input.transition, section: input.section })];
    }
  }

  // quote 版式では title が引用元（attribution）を表すため、noteToDeckResult の見出しに入れると本文側（quote）へ誤流入する。
  const isQuoteRichBody = input.layout === "quote";
  const blocks = isQuoteRichBody
    ? bodyParsed
    : [...headingBlockFor(title, input.titleInline), ...bodyParsed];
  const { deck, truncatedSlides } = noteToDeckResult({ title: "", blocks, theme });
  if (truncatedSlides > 0) {
    throw new SlidesEditError(`Slide content exceeds the maximum of ${MAX_SLIDES} slides.`);
  }
  const built = deck.slides.map(stripSection);
  if (!built.length) {
    const fallback = createSlide(input.layout ?? "blank", title ? (isQuoteRichBody ? { attribution: title } : { title }) : {});
    if (hasTitleDoc && input.titleDoc) {
      const targetRole = isQuoteRichBody ? "attribution" : "title";
      const idx = fallback.elements.findIndex((el) => el.type === "text" && el.role === targetRole);
      if (idx >= 0) {
        const targetEl = fallback.elements[idx] as TextElement;
        fallback.elements[idx] = { ...targetEl, doc: normalizeRichDoc(alignRichDoc(input.titleDoc, targetEl.style.align)) };
      }
    }
    return [applyMetadata(fallback, { notes: input.notes, hidden: input.hidden, transition: input.transition, section: input.section })];
  }

  if (input.layout) {
    built[0] = input.layout === "twoColumn"
      ? splitBodyIntoTwoColumns(built[0])
      : built[0].layout === input.layout
        ? built[0]
        : applyLayout(built[0], input.layout);
  }

  if (isQuoteRichBody) {
    const attrIdx = built[0].elements.findIndex((el) => el.type === "text" && el.role === "attribution");
    if (title || hasTitleDoc) {
      if (attrIdx >= 0) {
        const attrEl = built[0].elements[attrIdx] as TextElement;
        built[0].elements[attrIdx] = {
          ...attrEl,
          doc: hasTitleDoc && input.titleDoc
            ? normalizeRichDoc(alignRichDoc(input.titleDoc, attrEl.style.align))
            : richDocFromText(title, attrEl.style.align),
        };
      } else {
        const addedAttr = createHeadingElement("quote", "attribution", title);
        if (addedAttr) {
          built[0].elements.push(
            hasTitleDoc && input.titleDoc
              ? { ...addedAttr, doc: normalizeRichDoc(alignRichDoc(input.titleDoc, addedAttr.style.align)) }
              : addedAttr,
          );
        }
      }
    } else if (attrIdx >= 0 && isRichDocEmpty((built[0].elements[attrIdx] as TextElement).doc)) {
      built[0].elements.splice(attrIdx, 1);
    }
  }

  built[0] = applyMetadata(built[0], {
    notes: input.notes,
    hidden: input.hidden,
    transition: input.transition,
    section: input.section,
  });
  if (input.hidden || input.transition) {
    for (let i = 1; i < built.length; i++) {
      built[i] = applyMetadata(built[i], { hidden: input.hidden, transition: input.transition });
    }
  }
  return built;
}

// 1 枚分のタイトル・Markdown 本文・版式から、安全領域に収まる 1 枚以上のスライドを作る。
function buildSlidesFromContent(
  input: {
    title: string;
    titleInline?: readonly NoteRawInline[];
    titleDoc?: RichDoc;
    body: string;
    notes: string | null;
    layout: LayoutId | null;
    section?: string | null;
    hidden?: boolean | null;
    transition?: SlideTransition | null;
  },
  theme: DeckTheme,
): Slide[] {
  const body = input.body.trim();
  const bodyParsed = body ? sanitizeBodyBlocks(markdownToBlocks(prepareNoteMarkdown(body, { dropImages: true }))) : [];
  return buildSlidesFromParsedBlocks(
    {
      title: input.title,
      titleInline: input.titleInline,
      titleDoc: input.titleDoc,
      bodyBlocks: bodyParsed,
      notes: input.notes,
      layout: input.layout,
      section: input.section,
      hidden: input.hidden,
      transition: input.transition,
    },
    theme,
  );
}

// 既存スライドから表示用の短いタイトルと要約を取り出す（提案カードの before/after 表示用）。
function slideTitleOf(slide: Slide): string {
  const titleEl = slide.elements.find((el) => el.type === "text" && el.role === "title")
    ?? slide.elements.find((el) => el.type === "text" && el.role === "quote")
    ?? slide.elements.find((el) => el.type === "text" && !isRichDocEmpty(el.doc));
  return titleEl?.type === "text" ? oneLine(richDocText(titleEl.doc)).slice(0, 120) : "";
}

function slideSummary(slide: Slide): string {
  const parts: string[] = [];
  for (const el of slide.elements) {
    if (el.type === "text" || el.type === "shape") {
      const txt = richDocText(el.doc).trim();
      if (txt) parts.push(txt);
    } else if (el.type === "table") {
      const rows = el.rows.map((row) => row.cells.map((cell) => cell.text.trim()).join(" | ")).filter(Boolean);
      if (rows.length) parts.push(rows.slice(0, 4).join("\n"));
    } else if (el.type === "image" && el.src) {
      parts.push(`[Image: ${el.alt.trim() || "image"}]`);
    } else if (el.type === "whiteboard" && el.src) {
      parts.push(`[Whiteboard: ${el.frameName.trim() || "whiteboard"}]`);
    }
  }
  if (slide.notes?.trim()) {
    parts.push(`Notes: ${oneLine(slide.notes).slice(0, 140)}`);
  }
  const joined = parts.join("\n").trim();
  if (joined.length > 360) return `${joined.slice(0, 359)}…`;
  return joined || `(${slide.layout})`;
}

// 既存の画像・ホワイトボード枠など、本文の書き換えで消してはならない要素。
function isPreservedMediaElement(element: SlideElement): element is ImageElement | WhiteboardElement {
  if (element.type === "image") return Boolean(element.src || element.pendingImagePrompt);
  if (element.type === "whiteboard") return Boolean(element.src);
  return false;
}

function isNonBodyDecoration(element: SlideElement): boolean {
  return isPreservedMediaElement(element) || element.type === "line" || element.type === "shape";
}

// テキスト枠の実際の幅・高さ・文字サイズに対して、RichDoc が溢れず収まるかを概算する。
function visualWidthUnits(text: string): number {
  let units = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    units += code > 0x2e7f ? 1.85 : 1;
  }
  return units;
}

const DISPLAY_FRAC_CMDS = new Set(["dfrac", "cfrac", "dbinom"]);
const STACK_CMDS = new Set(["dfrac", "cfrac", "frac", "tfrac", "binom", "dbinom", "genfrac", "stackrel", "overset", "underset"]);
const INFIX_FRAC_CMDS = new Set(["over", "atop", "above"]);
const BIG_OP_CMDS = new Set(["sum", "int", "iint", "iiint", "oint", "prod", "coprod", "bigcup", "bigcap", "bigoplus", "bigotimes", "lim", "sup", "inf"]);

// 分数（\dfrac / \cfrac / \frac / \over 等）・大型演算子・複数行（\\）の入れ子から KaTeX 表示高さの倍率を概算する。
function estimateLatexHeightMultiplier(latex: string, displayMode: boolean): number {
  const src = latex.trim();
  if (!src) return displayMode ? 1.8 : 1.0;

  const parseSequence = (start: number, stopOnClose: boolean, depth: number, inDisplay: boolean): { em: number; next: number } => {
    if (depth > 32) return { em: 1.0, next: start };
    let i = start;
    let totalRowEm = 0;
    let rowMaxEm = 1.0;
    let infixNumEm: number | null = null;
    let infixWeight = inDisplay ? 1.0 : 0.72;

    const readArg = (pos: number, argDisplay: boolean): { em: number; next: number } => {
      let j = pos;
      while (j < src.length && /\s/.test(src[j])) j++;
      if (j >= src.length) return { em: 1.0, next: j };
      if (src[j] === "{") {
        return parseSequence(j + 1, true, depth + 1, argDisplay);
      }
      if (src[j] === "\\") {
        let k = j + 1;
        if (k < src.length && /[A-Za-z]/.test(src[k])) {
          while (k < src.length && /[A-Za-z]/.test(src[k])) k++;
        } else if (k < src.length) {
          k++;
        }
        return { em: 1.0, next: k };
      }
      return { em: 1.0, next: j + 1 };
    };

    const finalizeRow = () => {
      let em = rowMaxEm;
      if (infixNumEm !== null) {
        em = infixWeight * (infixNumEm + rowMaxEm + 0.15);
        infixNumEm = null;
      }
      totalRowEm += em;
      rowMaxEm = 1.0;
    };

    while (i < src.length) {
      const ch = src[i];
      if (stopOnClose && ch === "}") {
        finalizeRow();
        return { em: Math.max(1.0, totalRowEm), next: i + 1 };
      }
      if (ch === "{") {
        const inner = parseSequence(i + 1, true, depth + 1, inDisplay);
        rowMaxEm = Math.max(rowMaxEm, inner.em);
        i = inner.next;
        continue;
      }
      if (ch === "\\") {
        if (src[i + 1] === "\\") {
          finalizeRow();
          i += 2;
          continue;
        }
        let j = i + 1;
        if (j < src.length && /[A-Za-z]/.test(src[j])) {
          while (j < src.length && /[A-Za-z]/.test(src[j])) j++;
          const cmd = src.slice(i + 1, j);
          if (INFIX_FRAC_CMDS.has(cmd)) {
            infixNumEm = rowMaxEm;
            infixWeight = inDisplay ? 1.0 : 0.72;
            rowMaxEm = 1.0;
            i = j;
            continue;
          }
          if (STACK_CMDS.has(cmd)) {
            const argDisplay = DISPLAY_FRAC_CMDS.has(cmd) ? true : cmd === "tfrac" ? false : inDisplay;
            let cursor = j;
            while (cursor < src.length && /\s/.test(src[cursor])) cursor++;
            if (cmd === "cfrac" && src[cursor] === "[") {
              const closeBracket = src.indexOf("]", cursor + 1);
              if (closeBracket >= 0) cursor = closeBracket + 1;
            } else if (cmd === "genfrac") {
              for (let g = 0; g < 4; g++) cursor = readArg(cursor, argDisplay).next;
            }
            const first = readArg(cursor, argDisplay);
            const second = readArg(first.next, argDisplay);
            const weight = (cmd === "stackrel" || cmd === "overset" || cmd === "underset")
              ? 0.75
              : (argDisplay ? 1.0 : 0.72);
            const stackedEm = weight * (first.em + second.em + 0.15);
            rowMaxEm = Math.max(rowMaxEm, stackedEm);
            i = second.next;
            continue;
          }
          if (BIG_OP_CMDS.has(cmd)) {
            rowMaxEm = Math.max(rowMaxEm, inDisplay ? 1.65 : 1.35);
          }
          i = j;
          continue;
        }
        i = Math.min(src.length, i + 2);
        continue;
      }
      i++;
    }
    finalizeRow();
    return { em: Math.max(1.0, totalRowEm), next: i };
  };

  const result = parseSequence(0, false, 0, displayMode).em;
  return displayMode ? Math.max(1.8, result) : Math.max(1.0, result);
}

function measureRichDocHeight(doc: RichDoc, box: Pick<TextElement, "w" | "h" | "style">): { requiredHeight: number; innerHeight: number } {
  const innerHeight = Math.max(16, box.h - 24);
  if (isRichDocEmpty(doc)) {
    return { requiredHeight: 0, innerHeight };
  }
  const fontSize = Math.max(12, box.style.size || 40);
  const lineHeight = Math.max(1.0, box.style.lineHeight || 1.3);
  const innerWidth = Math.max(20, box.w - 32);
  const unitsPerLine = Math.max(1, innerWidth / (fontSize * 0.56));
  const linePx = fontSize * lineHeight;

  const measureBlocks = (blocks: readonly RichBlock[], indentUnits: number): number => {
    let heightPx = 0;
    for (const block of blocks) {
      if (block.type === "paragraph") {
        let paraFontSize = fontSize;
        for (const node of block.content ?? []) {
          if (node.type === "text") {
            for (const mark of node.marks ?? []) {
              if (mark.type === "size" && mark.attrs.size > paraFontSize) paraFontSize = mark.attrs.size;
            }
          }
        }
        let maxInlineMathPx = 0;
        for (const node of block.content ?? []) {
          if (node.type === "math_inline") {
            maxInlineMathPx = Math.max(maxInlineMathPx, paraFontSize * estimateLatexHeightMultiplier(node.attrs.latex, false));
          }
        }
        const paraUnitsPerLine = Math.max(1, innerWidth / (paraFontSize * 0.56));
        const paraLinePx = paraFontSize * lineHeight;
        const text = richDocText({ type: "doc", content: [block] });
        const lines = text.split("\n").reduce(
          (sum, seg) => sum + Math.max(1, Math.ceil(visualWidthUnits(seg) / Math.max(1, paraUnitsPerLine - indentUnits))),
          0,
        );
        heightPx += Math.max(0, lines - 1) * paraLinePx + Math.max(paraLinePx, maxInlineMathPx) + paraFontSize * 0.25;
      } else if (block.type === "bullet_list" || block.type === "ordered_list") {
        for (const item of block.content) {
          heightPx += measureBlocks(item.content, indentUnits + 2.5);
        }
      } else if (block.type === "code_block") {
        const text = (block.content ?? []).map((n) => n.text).join("");
        const lines = text.split("\n").reduce(
          (sum, seg) => sum + Math.max(1, Math.ceil(visualWidthUnits(seg) / Math.max(1, unitsPerLine - indentUnits - 2))),
          0,
        );
        heightPx += lines * linePx * 0.9 + fontSize * 0.6;
      } else if (block.type === "math_block") {
        const mathMult = estimateLatexHeightMultiplier(block.attrs.latex, true);
        heightPx += Math.max(linePx * 1.8, fontSize * mathMult + fontSize * 0.5);
      }
    }
    return heightPx;
  };

  return { requiredHeight: measureBlocks(doc.content, 0), innerHeight };
}

function fitsInTextBox(doc: RichDoc, box: Pick<TextElement, "w" | "h" | "style">): boolean {
  const { requiredHeight, innerHeight } = measureRichDocHeight(doc, box);
  return requiredHeight <= innerHeight * 1.05;
}

// 本文 Markdown が単一のリッチテキスト枠（表・コールアウト・複数カラム・あふれ無し）に収まるなら、その RichDoc を返す。
function singleBodyRichDoc(body: string, theme: DeckTheme): RichDoc | null {
  const trimmed = body.trim();
  if (!trimmed) return richDocFromText("");
  const parsed = sanitizeBodyBlocks(markdownToBlocks(prepareNoteMarkdown(trimmed, { dropImages: true })));
  if (!blocksHaveVisibleContent(parsed)) return richDocFromText("");
  const { deck, truncatedSlides } = noteToDeckResult({ title: "", blocks: parsed, theme });
  if (truncatedSlides > 0 || deck.slides.length !== 1) return null;
  const elements = deck.slides[0].elements;
  if (elements.length === 1 && elements[0].type === "text") {
    return normalizeRichDoc(elements[0].doc);
  }
  return null;
}

const REVERSE_NOTE_TEXT_COLORS: Record<string, string> = {
  muted: "gray",
  accent: "blue",
  "#dc2626": "red",
  "#ea580c": "orange",
  "#ca8a04": "yellow",
  "#16a34a": "green",
  "#9333ea": "purple",
  "#db2777": "pink",
  "#92400e": "brown",
};

// RichDoc / TableElement を Markdown 文字列へ落とさずに noteToDeckResult 用の BlockNote 生ブロックへ直接変換する（merge_slides 用）。
// リテラルな `![alt](url)`・`---`・`**...**` が再パースで画像・区切り線・太字に化けるのを防ぐ。
function richInlinesToNoteInlines(inlines: readonly RichInline[] | undefined): NoteRawInline[] {
  if (!inlines?.length) return [];
  const out: NoteRawInline[] = [];
  for (const node of inlines) {
    if (node.type === "hard_break") {
      const prev = out[out.length - 1];
      if (prev && prev.type === "text" && (!prev.styles || Object.keys(prev.styles).length === 0)) {
        prev.text += "\n";
      } else {
        out.push({ type: "text", text: "\n", styles: {} });
      }
      continue;
    }
    if (node.type === "math_inline") {
      out.push({ type: "mathInline", props: { latex: node.attrs.latex } });
      continue;
    }
    const styles: Record<string, unknown> = {};
    let linkHref: string | null = null;
    for (const mark of node.marks ?? []) {
      if (mark.type === "strong") styles.bold = true;
      else if (mark.type === "em") styles.italic = true;
      else if (mark.type === "underline") styles.underline = true;
      else if (mark.type === "strike") styles.strike = true;
      else if (mark.type === "code") styles.code = true;
      else if (mark.type === "color") {
        const mapped = REVERSE_NOTE_TEXT_COLORS[mark.attrs.color.toLowerCase()];
        styles.textColor = mapped ?? mark.attrs.color;
      } else if (mark.type === "size") {
        styles.fontSize = mark.attrs.size;
      } else if (mark.type === "link") {
        linkHref = mark.attrs.href;
      }
    }
    const textNode: NoteRawInline = { type: "text", text: node.text, styles };
    out.push(linkHref ? { type: "link", href: linkHref, content: [textNode] } : textNode);
  }
  return out;
}

function richDocToHeadingInline(doc: RichDoc): NoteRawInline[] {
  const out: NoteRawInline[] = [];
  for (const block of doc.content) {
    let nodes: NoteRawInline[] = [];
    if (block.type === "paragraph") {
      nodes = richInlinesToNoteInlines(block.content).map((node) => {
        if (node.type === "text") return { ...node, text: node.text.replace(/\r?\n/g, " ") };
        return node;
      });
    } else if (block.type === "code_block") {
      const text = oneLine((block.content ?? []).map((n) => n.text).join(""));
      if (text) nodes = [{ type: "text", text, styles: { code: true } }];
    } else if (block.type === "math_block") {
      nodes = [{ type: "mathInline", props: { latex: block.attrs.latex } }];
    } else {
      const text = oneLine(richDocText({ type: "doc", content: [block] }));
      if (text) nodes = [{ type: "text", text, styles: {} }];
    }
    if (nodes.length) {
      if (out.length) out.push({ type: "text", text: " ", styles: {} });
      out.push(...nodes);
    }
  }
  return out;
}

function richBlocksToNoteBlocks(blocks: readonly RichBlock[]): NoteRawBlock[] {
  const out: NoteRawBlock[] = [];
  for (const block of blocks) {
    if (block.type === "paragraph") {
      const content = richInlinesToNoteInlines(block.content);
      const align = block.attrs?.align;
      out.push({
        id: newId(),
        type: "paragraph",
        props: align ? { textAlignment: align } : {},
        content,
        children: [],
      });
    } else if (block.type === "bullet_list" || block.type === "ordered_list") {
      const order = block.type === "ordered_list" ? (block.attrs?.order ?? 1) : 1;
      block.content.forEach((item, idx) => {
        const [first, ...rest] = item.content;
        const headContent = first?.type === "paragraph" ? richInlinesToNoteInlines(first.content) : [];
        const align = first?.type === "paragraph" ? first.attrs?.align : null;
        const children = first?.type === "paragraph" ? richBlocksToNoteBlocks(rest) : richBlocksToNoteBlocks(item.content);
        const props: Record<string, unknown> = {};
        if (block.type === "ordered_list" && idx === 0 && order !== 1) props.start = order;
        if (align) props.textAlignment = align;
        out.push({
          id: newId(),
          type: block.type === "ordered_list" ? "numberedListItem" : "bulletListItem",
          props,
          content: headContent,
          children,
        });
      });
    } else if (block.type === "code_block") {
      const code = (block.content ?? []).map((n) => n.text).join("");
      const lang = block.attrs?.language ?? "";
      out.push({
        id: newId(),
        type: "codeBlock",
        props: lang ? { language: lang } : {},
        content: code ? [{ type: "text", text: code, styles: {} }] : [],
        children: [],
      });
    } else if (block.type === "math_block") {
      out.push({
        id: newId(),
        type: "mathBlock",
        props: { latex: block.attrs.latex },
        children: [],
      });
    }
  }
  return out;
}

function tableElementToNoteBlock(el: Extract<SlideElement, { type: "table" }>): NoteRawBlock {
  return {
    id: newId(),
    type: "table",
    props: {},
    content: {
      type: "tableContent",
      preserveCellWhitespace: true,
      columnWidths: el.cols.map((w) => (w > 0 ? w : null)),
      headerRows: el.header ? 1 : 0,
      rows: el.rows.map((row) => ({
        cells: row.cells.map((cell) => [{ type: "text", text: cell.text, styles: {} }]),
      })),
    },
    children: [],
  };
}

function createHeadingElement(layout: LayoutId, headingRole: "title" | "attribution", text: string): TextElement | undefined {
  const hasRole = layoutDefinition(layout).placeholders.some((p) => p.role === headingRole);
  const fallbackLayout: LayoutId = hasRole ? layout : headingRole === "attribution" ? "quote" : "bullets";
  const created = createSlide(fallbackLayout, { [headingRole]: text });
  return created.elements.find((el): el is TextElement => el.type === "text" && el.role === headingRole);
}

// 1 枚のスロット（title / body / quote / subtitle 等）を既存要素のまま更新し、画像・白板枠・図形・線を残す。
function applyContentUpdateToSlide(
  slide: Slide,
  updates: { title: string | null; body: string | null; targetLayout?: LayoutId | null },
  theme: DeckTheme,
): { primary: Slide; continuations: Slide[] } {
  const hasTitleUpdate = updates.title !== null;
  const hasBodyUpdate = updates.body !== null;
  if (!hasTitleUpdate && !hasBodyUpdate) return { primary: slide, continuations: [] };

  const targetLayout = updates.targetLayout ?? null;
  const layoutChanged = targetLayout !== null && targetLayout !== slide.layout;
  const effectiveLayout = targetLayout ?? slide.layout;
  const headingRole: "title" | "attribution" = effectiveLayout === "quote" ? "attribution" : "title";

  // 1. タイトルのみの更新：既存のタイトル枠（無ければ新規追加）だけを差し替える。
  if (hasTitleUpdate && !hasBodyUpdate) {
    let baseSlide: Slide = { ...slide, elements: slide.elements.map((el) => ({ ...el })) };
    if (layoutChanged) {
      if (effectiveLayout === "quote" && slide.elements.some((el) => el.type === "text" && (el.role === "body" || el.role === "quote") && !isRichDocEmpty(el.doc))) {
        // 既存の本文があるスライドを quote へ切り替えながら title（= attribution）を指定したときは、
        // 旧 title が FALLBACK_ROLES 経由で quote 本文に入らないよう先に外す。
        baseSlide = { ...baseSlide, elements: baseSlide.elements.filter((el) => !(el.type === "text" && el.role === "title")) };
      }
      baseSlide = effectiveLayout === "twoColumn" ? splitBodyIntoTwoColumns(baseSlide) : applyLayout(baseSlide, effectiveLayout);
    }
    const elements = [...baseSlide.elements];
    const newTitle = updates.title!;
    const headingIdx = elements.findIndex((el) => el.type === "text" && el.role === headingRole);
    if (headingIdx >= 0) {
      const existing = elements[headingIdx] as TextElement;
      elements[headingIdx] = { ...existing, doc: richDocFromText(newTitle, existing.style.align) };
      return { primary: { ...baseSlide, elements }, continuations: [] };
    }
    if (newTitle) {
      const addedHeading = createHeadingElement(effectiveLayout, headingRole, newTitle);
      if (addedHeading) elements.push(addedHeading);
    }
    return { primary: { ...baseSlide, elements }, continuations: [] };
  }

  // 2. 本文（および任意でタイトル）の更新：版式が変わらず単純なリッチテキストで、実際の配置枠に収まるなら
  //    既存の枠をその場で差し替えて座標・書式・装飾をすべて保つ。
  const elements = slide.elements.map((el) => ({ ...el }));
  const simpleBody = singleBodyRichDoc(updates.body!, theme);
  const bodyRole = effectiveLayout === "title" || effectiveLayout === "section"
    ? "subtitle"
    : effectiveLayout === "quote"
      ? "quote"
      : effectiveLayout === "fullImage"
        ? "caption"
        : "body";
  const existingBody = elements.find((el): el is TextElement => el.type === "text" && el.role === bodyRole);
  const hasExtraBody2OrTables = elements.some(
    (el) => (el.type === "text" && el.role === "body2" && !isRichDocEmpty(el.doc)) || el.type === "table",
  );
  // 2 段組みで複数箇条書き・複数段落が来た場合は、左枠に詰め込まず 2 列へ分ける（空の body2 がある場合も含む）。
  const wantsTwoColumnSplit = effectiveLayout === "twoColumn" && simpleBody !== null && (
    simpleBody.content.length >= 2 ||
    (simpleBody.content.length === 1 &&
      (simpleBody.content[0].type === "bullet_list" || simpleBody.content[0].type === "ordered_list") &&
      simpleBody.content[0].content.length >= 2)
  );

  if (!layoutChanged && simpleBody && existingBody && !hasExtraBody2OrTables && !wantsTwoColumnSplit && fitsInTextBox(simpleBody, existingBody)) {
    const existingBodyId = existingBody.id;
    if (hasTitleUpdate) {
      const titleIdx = elements.findIndex((el) => el.type === "text" && el.role === headingRole);
      if (titleIdx >= 0) {
        const existingTitle = elements[titleIdx] as TextElement;
        elements[titleIdx] = { ...existingTitle, doc: richDocFromText(updates.title!, existingTitle.style.align) };
      } else if (updates.title) {
        const addedTitle = createHeadingElement(effectiveLayout, headingRole, updates.title);
        if (addedTitle) elements.unshift(addedTitle);
      }
    }
    // タイトルを先頭に差し込んでもズレないよう、必ず要素 ID で本文枠を探して書き換える。
    const bodyIdx = elements.findIndex((el) => el.id === existingBodyId);
    if (bodyIdx >= 0) {
      const targetBody = elements[bodyIdx] as TextElement;
      elements[bodyIdx] = { ...targetBody, doc: simpleBody };
    }
    return { primary: { ...slide, elements }, continuations: [] };
  }

  // 3. 表・複数要素・あふれ・版式変更・2段組み振り分けを含む本文更新、または既存本文枠が無いスライド：
  //    画像・ホワイトボード枠・図形・線と、未変更の既存タイトル要素（ID・書式込み）を守りながら再レイアウトする。
  const preservedDecorations = slide.elements.filter(isNonBodyDecoration);
  const existingTitleEl = slide.elements.find((el): el is TextElement => el.type === "text" && el.role === headingRole)
    ?? (headingRole !== "attribution" ? slide.elements.find((el): el is TextElement => el.type === "text" && el.role === "title") : undefined);
  const keepExistingTitleVerbatim = !hasTitleUpdate && existingTitleEl !== undefined && !isRichDocEmpty(existingTitleEl.doc);
  const effectiveTitle = hasTitleUpdate ? updates.title! : (existingTitleEl ? oneLine(richDocText(existingTitleEl.doc)) : "");

  const rebuilt = buildSlidesFromContent(
    {
      title: effectiveTitle,
      body: updates.body!,
      notes: null,
      layout: effectiveLayout === "blank" ? null : effectiveLayout,
    },
    theme,
  );
  const first = rebuilt[0];
  let nextElements = [...first.elements];

  // タイトル未指定時は、再生成されたプレーンなタイトル枠を元のタイトル要素（ID・太字/数式などの書式）で差し替える。
  if (keepExistingTitleVerbatim && existingTitleEl) {
    const rebuiltHeadingIdx = nextElements.findIndex((el) => el.type === "text" && el.role === headingRole);
    if (rebuiltHeadingIdx >= 0) {
      const rebuiltHeading = nextElements[rebuiltHeadingIdx] as TextElement;
      nextElements[rebuiltHeadingIdx] = {
        ...existingTitleEl,
        x: rebuiltHeading.x,
        y: rebuiltHeading.y,
        w: rebuiltHeading.w,
        h: rebuiltHeading.h,
      };
    } else {
      nextElements.unshift(existingTitleEl);
    }
  }

  // 元のスライドに画像・ホワイトボード枠があり、再構築側が空の画像プレースホルダーを作っていたら、空のプレースホルダーを外して元のメディアを残す。
  const hasPreservedMedia = preservedDecorations.some(isPreservedMediaElement);
  if (hasPreservedMedia) {
    nextElements = nextElements.filter((el) => !(el.type === "image" && !el.src && !el.pendingImagePrompt));
  }
  const existingIds = new Set(nextElements.map((el) => el.id));
  const toAttach = preservedDecorations.filter((el) => !existingIds.has(el.id));

  // 右半分に画像やホワイトボード枠がある場合は、新しく置いた文字枠が重ならないように幅を調整する。
  const rightMedia = toAttach.find((el) => isPreservedMediaElement(el) && el.x >= SLIDE_WIDTH * 0.45);
  if (rightMedia) {
    const safeRight = Math.max(640, rightMedia.x - 48);
    nextElements = nextElements.map((el) => {
      if ((el.type === "text" || el.type === "table") && el.x < safeRight && el.x + el.w > safeRight) {
        return { ...el, w: Math.max(360, safeRight - el.x) };
      }
      return el;
    });
  }

  // 画像は奥、テキストや表は手前に置く。
  const backMedia = toAttach.filter(isPreservedMediaElement);
  const frontDecor = toAttach.filter((el) => !isPreservedMediaElement(el));
  const mergedElements = [...backMedia, ...nextElements, ...frontDecor];
  if (mergedElements.length > MAX_SLIDE_ELEMENTS) {
    throw new SlidesEditError(`Slide exceeds the maximum of ${MAX_SLIDE_ELEMENTS} elements.`);
  }

  const primary: Slide = {
    ...slide,
    layout: first.layout,
    elements: mergedElements,
  };
  const continuations = rebuilt.slice(1).map((extra) =>
    applyMetadata(extra, { hidden: slide.hidden ?? null, transition: slide.transition ?? null }),
  );
  return { primary, continuations };
}

// ---- Restyle 用の厳格なコンテンツ不変チェック（安定 slide.id・element.id 単位で構造比較） ----

function isEmptyLayoutPlaceholder(element: SlideElement): boolean {
  return Boolean(element.role) && !placeholderHasContent(element);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

// applyLayout が正当に書き換えるレイアウト所有フィールドだけを外し、本文・書式・リンク・コード言語・数式・表・画像メタ・図形・線を厳密比較する。
// 自由要素および降格した元プレースホルダーの style / fill / autoHeight の変更検知は assertDeckTextPreserved 側で行う。
function canonicalPreservedElement(element: SlideElement): Record<string, unknown> {
  if (element.type === "text") {
    const {
      x: _x, y: _y, w: _w, h: _h, rotation: _rotation, role: _role,
      style: _style, fill: _fill, autoHeight: _autoHeight,
      ...rest
    } = element;
    void _x; void _y; void _w; void _h; void _rotation; void _role; void _style; void _fill; void _autoHeight;
    return { ...rest, doc: normalizeRichDoc(element.doc) };
  }
  if (element.type === "image" || element.type === "whiteboard") {
    const { x: _x, y: _y, w: _w, h: _h, rotation: _rotation, role: _role, ...rest } = element;
    void _x; void _y; void _w; void _h; void _rotation; void _role;
    return rest;
  }
  if (element.type === "table") {
    const { role: _role, cols, ...rest } = element;
    void _role;
    const sum = cols.reduce((acc, n) => acc + (n > 0 ? n : 0), 0);
    const normalizedCols = sum > 0 ? cols.map((n) => Math.round((n / sum) * 10_000) / 10_000) : cols;
    return { ...rest, cols: normalizedCols };
  }
  // shape / line は applyLayout が中身・書式を書き換えない（移らない role を外すだけ）。
  const { role: _role, ...rest } = element;
  void _role;
  return rest;
}

export type SlideTextInventory = {
  id: string;
  notes: string;
  section: string | null;
  hidden: boolean;
  transition: SlideTransition | null;
  background: unknown;
  elements: Record<string, Record<string, unknown>>;
};

export function extractDeckTextInventory(deck: Deck): SlideTextInventory[] {
  return deck.slides.map((slide) => {
    const elements: Record<string, Record<string, unknown>> = {};
    for (const el of slide.elements) {
      if (isEmptyLayoutPlaceholder(el)) continue;
      elements[el.id] = canonicalPreservedElement(el);
    }
    return {
      id: slide.id,
      notes: slide.notes ?? "",
      section: slide.section ?? null,
      hidden: Boolean(slide.hidden),
      transition: slide.transition ?? null,
      background: slide.background ?? null,
      elements,
    };
  });
}

// 整套换风格（restyle_deck）のサーバー側ハード不変条件：
// 1 文字・1 リンク・1 書式・1 コード言語・1 図形/線/表/画像メタでも書き換わったり消えたり増えていたら必ず拒否する。
export function assertDeckTextPreserved(
  before: Deck,
  after: Deck,
  options?: { allowPlaceholderToDemotedStyleChange?: boolean },
): void {
  const beforeInv = extractDeckTextInventory(before);
  const afterInv = extractDeckTextInventory(after);
  if (beforeInv.length !== afterInv.length) {
    throw new SlidesEditError("Restyle invariant violated: slide count changed.");
  }
  for (let i = 0; i < beforeInv.length; i++) {
    const b = beforeInv[i];
    const a = afterInv[i];
    if (b.id !== a.id) {
      throw new SlidesEditError("Restyle invariant violated: slide order or IDs changed.");
    }
    if (b.notes !== a.notes) {
      throw new SlidesEditError(`Restyle invariant violated: speaker notes changed on slide ${b.id}.`);
    }
    if (b.section !== a.section) {
      throw new SlidesEditError(`Restyle invariant violated: section changed on slide ${b.id}.`);
    }
    if (b.hidden !== a.hidden || b.transition !== a.transition || stableStringify(b.background) !== stableStringify(a.background)) {
      throw new SlidesEditError(`Restyle invariant violated: slide metadata changed on slide ${b.id}.`);
    }
    const beforeIds = Object.keys(b.elements).sort();
    const afterIds = Object.keys(a.elements).sort();
    if (JSON.stringify(beforeIds) !== JSON.stringify(afterIds)) {
      throw new SlidesEditError(`Restyle invariant violated: elements added or removed on slide ${b.id}.`);
    }
    const beforeById = new Map(before.slides[i].elements.map((el) => [el.id, el]));
    const afterById = new Map(after.slides[i].elements.map((el) => [el.id, el]));
    for (const id of beforeIds) {
      if (stableStringify(b.elements[id]) !== stableStringify(a.elements[id])) {
        throw new SlidesEditError(`Restyle invariant violated: content changed on slide ${b.id} element ${id}.`);
      }
      const beforeEl = beforeById.get(id);
      const afterEl = afterById.get(id);
      if (
        beforeEl?.type === "text"
        && afterEl?.type === "text"
        && (options?.allowPlaceholderToDemotedStyleChange ? !beforeEl.role : (!beforeEl.role || !afterEl.role))
        && stableStringify({ style: beforeEl.style, fill: beforeEl.fill, autoHeight: beforeEl.autoHeight })
          !== stableStringify({ style: afterEl.style, fill: afterEl.fill, autoHeight: afterEl.autoHeight })
      ) {
        throw new SlidesEditError(`Restyle invariant violated: style changed on slide ${b.id} element ${id}.`);
      }
    }
  }
}

const LOSSLESS_ALIGNS = ["left", "center", "right", "justify"];
const LOSSLESS_SIMPLE_MARKS = ["strong", "em", "underline", "strike", "code"];

function extractLosslessMarksSignature(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  const marks: unknown[] = [];
  const seen = new Set<string>();
  for (const mark of value) {
    if (!isObject(mark) || typeof mark.type !== "string" || seen.has(mark.type)) continue;
    const attrs = isObject(mark.attrs) ? mark.attrs : {};
    if (LOSSLESS_SIMPLE_MARKS.includes(mark.type)) {
      marks.push({ type: mark.type });
    } else if (mark.type === "link") {
      marks.push({ type: "link", href: typeof attrs.href === "string" ? attrs.href.trim() : attrs.href });
    } else if (mark.type === "color") {
      marks.push({ type: "color", color: attrs.color });
    } else if (mark.type === "size") {
      marks.push({
        type: "size",
        size: typeof attrs.size === "number" && Number.isFinite(attrs.size) ? Math.min(800, Math.max(4, attrs.size)) : attrs.size,
      });
    } else {
      marks.push({ type: "unknown", raw: mark });
    }
    seen.add(mark.type);
  }
  return marks;
}

function extractLosslessInlineSignature(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  const out: unknown[] = [];
  for (const node of value) {
    if (!isObject(node)) {
      out.push({ type: "unknown", raw: node });
      continue;
    }
    if (node.type === "text" && typeof node.text === "string") {
      const text = node.text.replace(/\u0000/g, "");
      if (text) out.push({ type: "text", text, marks: extractLosslessMarksSignature(node.marks) });
    } else if (node.type === "hard_break") {
      out.push({ type: "hard_break" });
    } else if (node.type === "math_inline") {
      const attrs = isObject(node.attrs) ? node.attrs : {};
      const latex = typeof attrs.latex === "string" ? attrs.latex.replace(/\u0000/g, "") : "";
      out.push({ type: "math_inline", latex });
    } else {
      out.push({ type: "unknown", raw: node });
    }
  }
  return out;
}

function extractLosslessBlocksSignature(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  const blocks: unknown[] = [];
  for (const node of value) {
    if (!isObject(node)) {
      blocks.push({ type: "unknown", raw: node });
      continue;
    }
    if (node.type === "paragraph") {
      const align = isObject(node.attrs) && typeof node.attrs.align === "string" && LOSSLESS_ALIGNS.includes(node.attrs.align)
        ? node.attrs.align
        : null;
      blocks.push({ type: "paragraph", align, content: extractLosslessInlineSignature(node.content) });
    } else if (node.type === "bullet_list" || node.type === "ordered_list") {
      const items: unknown[] = [];
      for (const item of Array.isArray(node.content) ? node.content : []) {
        if (!isObject(item) || item.type !== "list_item") continue;
        const content = extractLosslessBlocksSignature(item.content);
        if (!content.length || (content[0] as { type?: string }).type !== "paragraph") {
          content.unshift({ type: "paragraph", align: null, content: [] });
        }
        items.push({ type: "list_item", content });
      }
      if (!items.length) continue;
      if (node.type === "bullet_list") {
        blocks.push({ type: "bullet_list", content: items });
      } else {
        const order = isObject(node.attrs) && typeof node.attrs.order === "number" && Number.isSafeInteger(node.attrs.order)
          ? Math.min(9999, Math.max(0, node.attrs.order))
          : 1;
        blocks.push({ type: "ordered_list", order, content: items });
      }
    } else if (node.type === "code_block") {
      const text = (Array.isArray(node.content) ? node.content : [])
        .map((child) => (isObject(child) && typeof child.text === "string" ? child.text.replace(/\u0000/g, "") : ""))
        .join("");
      const rawLang = isObject(node.attrs) && typeof node.attrs.language === "string"
        ? node.attrs.language.replace(/\u0000/g, "").trim()
        : "";
      const language = rawLang && !/^(text|plain|plaintext)$/i.test(rawLang) ? rawLang : "";
      blocks.push({ type: "code_block", language, text });
    } else if (node.type === "math_block") {
      const attrs = isObject(node.attrs) ? node.attrs : {};
      const latex = typeof attrs.latex === "string" ? attrs.latex.replace(/\u0000/g, "") : "";
      blocks.push({ type: "math_block", latex });
    } else {
      blocks.push({ type: "unknown", raw: node });
    }
  }
  return blocks;
}

function extractLosslessRichDocSignature(value: unknown): unknown[] {
  const blocks = isObject(value) && value.type === "doc" ? extractLosslessBlocksSignature(value.content) : [];
  return blocks.length ? blocks : [{ type: "paragraph", align: null, content: [] }];
}

type SlideRawExemptions = {
  entireSlide?: boolean;
  notes?: boolean;
  section?: boolean;
  bodyElements?: boolean;
  headingRole?: "title" | "attribution";
  elementIds?: Set<string>;
};

function assertRawSlideNotLossy(rawSlide: unknown, initialSlide: Slide, index: number, exemption?: SlideRawExemptions): void {
  if (!isObject(rawSlide)) {
    throw new SlidesEditError(`Restyle invariant violated: stored slide ${index + 1} is malformed.`);
  }
  if (typeof rawSlide.id !== "string" || !rawSlide.id || rawSlide.id !== initialSlide.id) {
    throw new SlidesEditError(`Restyle invariant violated: stored slide ID changed on slide ${index + 1}.`);
  }
  if (!exemption?.section && typeof rawSlide.section === "string" && rawSlide.section !== (initialSlide.section ?? "")) {
    throw new SlidesEditError(`Restyle invariant violated: stored section would be truncated on slide ${initialSlide.id}.`);
  }
  if (!exemption?.notes && typeof rawSlide.notes === "string" && rawSlide.notes !== (initialSlide.notes ?? "")) {
    throw new SlidesEditError(`Restyle invariant violated: stored speaker notes would be altered on slide ${initialSlide.id}.`);
  }
  const rawElements = Array.isArray(rawSlide.elements) ? rawSlide.elements : [];
  if (rawElements.length !== initialSlide.elements.length) {
    throw new SlidesEditError(`Restyle invariant violated: stored elements would be dropped on slide ${initialSlide.id}.`);
  }
  const slideHeadingRole: "title" | "attribution" = initialSlide.layout === "quote" ? "attribution" : "title";
  for (let j = 0; j < rawElements.length; j++) {
    const rawEl = rawElements[j];
    const initEl = initialSlide.elements[j];
    if (!isObject(rawEl) || rawEl.id !== initEl.id || rawEl.type !== initEl.type) {
      throw new SlidesEditError(`Restyle invariant violated: stored element metadata would be altered on slide ${initialSlide.id}.`);
    }
    const isExemptedElement = Boolean(
      exemption?.elementIds?.has(initEl.id)
      || (exemption?.headingRole !== undefined && initEl.role === exemption.headingRole)
      || (exemption?.bodyElements && !isNonBodyDecoration(initEl) && initEl.role !== slideHeadingRole),
    );
    if (isExemptedElement) continue;
    if (initEl.type === "text" || initEl.type === "shape") {
      if (stableStringify(extractLosslessRichDocSignature(rawEl.doc)) !== stableStringify(extractLosslessRichDocSignature(initEl.doc))) {
        throw new SlidesEditError(`Restyle invariant violated: stored text/math/code content would be truncated on slide ${initialSlide.id} element ${initEl.id}.`);
      }
    } else if (initEl.type === "table") {
      const rawRows = Array.isArray(rawEl.rows) ? rawEl.rows : [];
      if (rawRows.length > 0) {
        if (rawRows.length !== initEl.rows.length) {
          throw new SlidesEditError(`Restyle invariant violated: stored table rows would be truncated on slide ${initialSlide.id} element ${initEl.id}.`);
        }
        for (let r = 0; r < rawRows.length; r++) {
          const rawRow = rawRows[r];
          const rawCells = isObject(rawRow) && Array.isArray(rawRow.cells) ? rawRow.cells : [];
          if (rawCells.length > initEl.rows[r].cells.length) {
            throw new SlidesEditError(`Restyle invariant violated: stored table columns would be truncated on slide ${initialSlide.id} element ${initEl.id}.`);
          }
          for (let c = 0; c < rawCells.length; c++) {
            const rawCell = rawCells[c];
            const rawText = isObject(rawCell) && typeof rawCell.text === "string" ? rawCell.text : "";
            if (rawText !== initEl.rows[r].cells[c].text) {
              throw new SlidesEditError(`Restyle invariant violated: stored table cell would be truncated on slide ${initialSlide.id} element ${initEl.id}.`);
            }
          }
        }
      }
    } else if (initEl.type === "image") {
      if (typeof rawEl.alt === "string" && rawEl.alt !== initEl.alt) {
        throw new SlidesEditError(`Restyle invariant violated: stored image alt would be truncated on slide ${initialSlide.id} element ${initEl.id}.`);
      }
      if (typeof rawEl.src === "string" && rawEl.src && rawEl.src !== initEl.src) {
        throw new SlidesEditError(`Restyle invariant violated: stored image source would be altered on slide ${initialSlide.id} element ${initEl.id}.`);
      }
      if (isObject(rawEl.generated) && typeof rawEl.generated.prompt === "string" && rawEl.generated.prompt !== (initEl.generated?.prompt ?? "")) {
        throw new SlidesEditError(`Restyle invariant violated: stored image prompt would be truncated on slide ${initialSlide.id} element ${initEl.id}.`);
      }
      if (!initEl.src && typeof rawEl.pendingImagePrompt === "string") {
        const cleaned = rawEl.pendingImagePrompt.replace(/\u0000/g, "").replace(/\s+/g, " ").trim();
        if (cleaned && cleaned !== (initEl.pendingImagePrompt ?? "")) {
          throw new SlidesEditError(`Restyle invariant violated: stored pending image prompt would be truncated on slide ${initialSlide.id} element ${initEl.id}.`);
        }
      }
    } else if (initEl.type === "whiteboard") {
      if (typeof rawEl.src === "string" && rawEl.src && rawEl.src !== initEl.src) {
        throw new SlidesEditError(`Restyle invariant violated: stored whiteboard source would be altered on slide ${initialSlide.id} element ${initEl.id}.`);
      }
      if (
        (typeof rawEl.pageId === "string" && rawEl.pageId !== initEl.pageId)
        || (typeof rawEl.frameId === "string" && rawEl.frameId !== initEl.frameId)
        || (typeof rawEl.frameName === "string" && rawEl.frameName !== initEl.frameName)
      ) {
        throw new SlidesEditError(`Restyle invariant violated: stored whiteboard metadata would be truncated on slide ${initialSlide.id} element ${initEl.id}.`);
      }
    }
  }
}

// normalizeDeck が保存済みデッキの section / notes / RichDoc / 表 / 画像メタ等を暗黙に切り詰めてしまわないか、生データと初期正規化結果を突き合わせて確かめる。
function assertRawStoredDeckNotLossyForRestyle(
  rawData: unknown,
  initialDeck: Deck,
  exemptions?: ReadonlyMap<string, SlideRawExemptions>,
): void {
  if (!isObject(rawData) || !Array.isArray(rawData.slides)) return;
  const rawSlides = rawData.slides;
  if (rawSlides.length !== initialDeck.slides.length) {
    throw new SlidesEditError("Restyle invariant violated: stored slide count does not match normalized deck.");
  }
  for (let i = 0; i < rawSlides.length; i++) {
    const rawSlide = rawSlides[i];
    const initialSlide = initialDeck.slides[i];
    const exemption = exemptions?.get(initialSlide.id);
    if (exemption?.entireSlide) continue;
    assertRawSlideNotLossy(rawSlide, initialSlide, i, exemption);
  }
}

// ---- 新規スライド作成（propose_slides_create） ----

function resolveThemeArg(raw: BuildAiSlidesDeckInput["theme"]): DeckTheme {
  if (raw === null || raw === undefined) return { ...DEFAULT_THEME };
  if (!isObject(raw)) throw new SlidesEditError("theme must be an object or null.");
  const themeId = raw.themeId === null || raw.themeId === undefined ? DEFAULT_THEME.id : raw.themeId;
  const mode = raw.mode === null || raw.mode === undefined ? DEFAULT_THEME.mode : raw.mode;
  if (!isValidThemeId(themeId)) {
    throw new SlidesEditError(`theme.themeId must be one of ${SLIDE_THEME_IDS.join(", ")}.`);
  }
  if (!isValidThemeMode(mode)) {
    throw new SlidesEditError('theme.mode must be "light" or "dark".');
  }
  return { id: themeId, mode };
}

function finalizeDeck(deck: Deck): { deck: Deck; data: CanvasData } {
  if (deck.slides.length > MAX_SLIDES) {
    throw new SlidesEditError(`Slide deck exceeds the maximum of ${MAX_SLIDES} slides.`);
  }
  for (const slide of deck.slides) {
    if (slide.elements.length > MAX_SLIDE_ELEMENTS) {
      throw new SlidesEditError(`Slide exceeds the maximum of ${MAX_SLIDE_ELEMENTS} elements.`);
    }
    if (slide.notes && slide.notes.length > MAX_SLIDE_NOTES) {
      throw new SlidesEditError(`Speaker notes must be at most ${MAX_SLIDE_NOTES} characters.`);
    }
  }
  const normalized = JSON.parse(JSON.stringify(normalizeDeck(deck))) as Deck;
  const validated = validateCanvasData("slides", normalized);
  if (validated.size > MAX_CANVAS_BYTES.slides) {
    throw new SlidesEditError("This page is larger than 2 MB and cannot be saved.");
  }
  return { deck: normalized, data: validated.data };
}

export function buildAiSlidesDeck(input: BuildAiSlidesDeckInput): BuildAiSlidesDeckResult {
  const title = oneLine(input.title);
  if (!title) throw new SlidesEditError("title must be a non-empty string.");
  if (title.length > MAX_SLIDE_TITLE_CHARS) {
    throw new SlidesEditError(`title must be at most ${MAX_SLIDE_TITLE_CHARS} characters.`);
  }

  const theme = resolveThemeArg(input.theme);
  const rawSlides = input.slides ?? [];
  if (!Array.isArray(rawSlides)) throw new SlidesEditError("slides must be an array.");
  if (rawSlides.length > MAX_AI_CREATE_SLIDES) {
    throw new SlidesEditError(`At most ${MAX_AI_CREATE_SLIDES} slides can be specified in one call.`);
  }

  const builtSlides: Slide[] = [];
  if (rawSlides.length === 0) {
    const cover = createSlide("title", { title });
    cover.elements = cover.elements.filter((el) => el.role !== "subtitle");
    builtSlides.push(cover);
  } else {
    for (let i = 0; i < rawSlides.length; i++) {
      const entry = rawSlides[i];
      if (!isObject(entry)) throw new SlidesEditError(`slides[${i}] must be an object.`);
      const slideTitle = validateTitleText(asOptionalString(entry.title, `slides[${i}].title`), `slides[${i}].title`) ?? "";
      const slideBody = validateBodyText(asOptionalString(entry.body, `slides[${i}].body`), `slides[${i}].body`) ?? "";
      const slideNotes = validateNotes(asOptionalString(entry.notes, `slides[${i}].notes`));
      const slideLayout = asOptionalLayout(entry.layout, `slides[${i}].layout`);
      const slideSection = validateSectionText(asOptionalString(entry.section, `slides[${i}].section`));

      const created = buildSlidesFromContent(
        { title: slideTitle, body: slideBody, notes: slideNotes, layout: slideLayout, section: slideSection },
        theme,
      );
      if (builtSlides.length + created.length > MAX_SLIDES) {
        throw new SlidesEditError(`Slide deck exceeds the maximum of ${MAX_SLIDES} slides.`);
      }
      builtSlides.push(...created);
    }
  }

  const { deck, data } = finalizeDeck({ format: DECK_FORMAT, theme, slides: builtSlides });

  const lines = [
    `Theme: ${deck.theme.id} (${deck.theme.mode}) · ${deck.slides.length} slide${deck.slides.length === 1 ? "" : "s"}`,
    ...deck.slides.slice(0, 12).map((slide, idx) => {
      const t = slideTitleOf(slide) || `(${slide.layout})`;
      return `${idx + 1}. ${t}`;
    }),
  ];
  if (deck.slides.length > 12) {
    lines.push(`… (+${deck.slides.length - 12} more slide${deck.slides.length - 12 === 1 ? "" : "s"})`);
  }

  const changes: ProposalChange[] = deck.slides.slice(0, 12).map((slide, idx) => ({
    op: "add",
    block: 0,
    target: { type: "slide", number: idx + 1 },
    after: slideSummary(slide),
  }));

  const focusIds = deck.slides.slice(0, 4).map((slide) => slide.id);
  return { data, deck, content: lines.join("\n"), changes, focusIds };
}

// ---- 既存スライドの編集（propose_slides_edit） ----

// 保存済みのスライド ID は空白を含めて厳密一致で照合し、ローカル ref が既存スライド ID を上書きできないようにする。
function resolveSlideId(raw: string | null, deck: Deck, refs: Map<string, string>, field: string): string {
  if (raw === null || !raw.trim()) throw new SlidesEditError(`${field} is required.`);
  if (deck.slides.some((slide) => slide.id === raw)) return raw;
  return refs.get(raw) ?? raw;
}

function findSlideIndexOrThrow(deck: Deck, slideId: string): number {
  const index = deck.slides.findIndex((slide) => slide.id === slideId);
  if (index < 0) {
    throw new SlidesEditError(`Slide "${slideId}" was not found. Use stable slide IDs from read_note.`);
  }
  return index;
}

function parseSlideIdList(raw: unknown, deck: Deck, refs: Map<string, string>, field: string, minCount: number): string[] {
  if (!Array.isArray(raw) || raw.length < minCount) {
    throw new SlidesEditError(`${field} must be an array of at least ${minCount} slide ID${minCount === 1 ? "" : "s"}.`);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string" || !item.trim()) {
      throw new SlidesEditError(`${field} entries must be non-empty slide IDs.`);
    }
    const resolved = deck.slides.some((slide) => slide.id === item) ? item : (refs.get(item) ?? item);
    if (seen.has(resolved)) {
      throw new SlidesEditError(`Duplicate slide ID "${item}" in ${field}.`);
    }
    seen.add(resolved);
    out.push(resolved);
  }
  return out;
}

function registerRef(refs: Map<string, string>, knownSlideIds: Set<string>, rawRef: string | null, realId: string) {
  knownSlideIds.add(realId);
  if (rawRef === null) return;
  if (!rawRef.trim() || rawRef !== rawRef.trim()) {
    throw new SlidesEditError("ref must be a non-empty string without leading or trailing whitespace, or null.");
  }
  if (refs.has(rawRef)) throw new SlidesEditError(`Duplicate local ref "${rawRef}".`);
  if (knownSlideIds.has(rawRef)) {
    throw new SlidesEditError(`Local ref "${rawRef}" conflicts with an existing slide ID.`);
  }
  refs.set(rawRef, realId);
}

// 複数枚を統合するとき、AI が title / body を省略した場合に、text と table を Markdown 再パース無しで直接ブロック配列へ結合する。
// 図形（shape）・線（line）・画像・白板枠はそのまま要素として引き継ぐため、本文側へ重複展開しない。
function combineSlidesToBlocks(
  slides: Slide[],
  targetLayout: LayoutId | null,
): { title: string; titleInline: NoteRawInline[]; titleDoc?: RichDoc; bodyBlocks: NoteRawBlock[] } {
  const first = slides[0];
  const explicitTitleEl = first.elements.find((el): el is TextElement => el.type === "text" && el.role === "title");
  const quoteAttrEl = targetLayout === "quote"
    ? first.elements.find((el): el is TextElement => el.type === "text" && el.role === "attribution")
    : undefined;
  const firstHeadingEl = explicitTitleEl ?? quoteAttrEl;
  const firstTitle = firstHeadingEl ? oneLine(richDocText(firstHeadingEl.doc)) : "";
  const titleInline = firstHeadingEl ? richDocToHeadingInline(firstHeadingEl.doc) : [];
  const firstTitleKey = stableStringify(titleInline);

  const bodyBlocks: NoteRawBlock[] = [];
  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];
    const titleEl = slide.elements.find((el): el is TextElement => el.type === "text" && el.role === "title");
    if (i > 0 && titleEl) {
      const headingText = oneLine(richDocText(titleEl.doc));
      const headingInline = richDocToHeadingInline(titleEl.doc);
      if (headingText && headingInline.length && stableStringify(headingInline) !== firstTitleKey) {
        bodyBlocks.push({
          id: newId(),
          type: "heading",
          props: { level: 3 },
          content: headingInline,
          children: [],
        });
      }
    }
    for (const el of slide.elements) {
      if (el === titleEl || (i === 0 && el === firstHeadingEl)) continue;
      if (el.type === "text") {
        if (isRichDocEmpty(el.doc)) continue;
        bodyBlocks.push(...richBlocksToNoteBlocks(el.doc.content));
      } else if (el.type === "table") {
        bodyBlocks.push(tableElementToNoteBlock(el));
      }
    }
  }
  return {
    title: firstTitle,
    titleInline,
    ...(firstHeadingEl ? { titleDoc: normalizeRichDoc(firstHeadingEl.doc) } : {}),
    bodyBlocks,
  };
}

function attachPreservedDecorations(
  baseElements: SlideElement[],
  decorations: SlideElement[],
): SlideElement[] {
  if (!decorations.length) return baseElements;
  const hasPreservedMedia = decorations.some(isPreservedMediaElement);
  let nextElements = hasPreservedMedia
    ? baseElements.filter((el) => !(el.type === "image" && !el.src && !el.pendingImagePrompt))
    : [...baseElements];
  const usedIds = new Set(nextElements.map((el) => el.id));
  const toAttach = decorations.map((el) => (usedIds.has(el.id) ? { ...el, id: newId() } : (usedIds.add(el.id), el)));
  const rightMedia = toAttach.find((el) => isPreservedMediaElement(el) && el.x >= SLIDE_WIDTH * 0.45);
  if (rightMedia) {
    const safeRight = Math.max(640, rightMedia.x - 48);
    nextElements = nextElements.map((el) => (
      (el.type === "text" || el.type === "table") && el.x < safeRight && el.x + el.w > safeRight
        ? { ...el, w: Math.max(360, safeRight - el.x) }
        : el
    ));
  }
  const backMedia = toAttach.filter(isPreservedMediaElement);
  const frontDecor = toAttach.filter((el) => !isPreservedMediaElement(el));
  const merged = [...backMedia, ...nextElements, ...frontDecor];
  if (merged.length > MAX_SLIDE_ELEMENTS) {
    throw new SlidesEditError(`Slide exceeds the maximum of ${MAX_SLIDE_ELEMENTS} elements.`);
  }
  return merged;
}

// 並び替え時のアンカー指定の妥当性検証。空白だけの afterSlideId や afterSlideId + atStart=true の矛盾を弾く。
function validateAnchorArgs(afterRaw: string | null, atStart: boolean | null): { afterRaw: string | null; atStart: boolean } {
  if (afterRaw !== null && !afterRaw.trim()) {
    throw new SlidesEditError("afterSlideId must be a non-empty slide ID or null.");
  }
  if (afterRaw !== null && atStart === true) {
    throw new SlidesEditError("Specify either afterSlideId or atStart=true, not both.");
  }
  return { afterRaw, atStart: atStart === true };
}

export function applySlidesEdits(rawData: unknown, rawOperations: unknown): SlidesEditResult {
  if (!Array.isArray(rawOperations)) {
    throw new SlidesEditError("operations must be an array.");
  }
  if (rawOperations.length > MAX_AI_SLIDES_OPS) {
    throw new SlidesEditError(`At most ${MAX_AI_SLIDES_OPS} operations are allowed per call.`);
  }

  const initialDeck = JSON.parse(JSON.stringify(normalizeDeck(rawData))) as Deck;
  let deck: Deck = JSON.parse(JSON.stringify(initialDeck)) as Deck;
  const changes: ProposalChange[] = [];
  const focusIds: string[] = [];
  const addFocus = (id: string) => {
    if (id && !focusIds.includes(id)) focusIds.push(id);
  };
  const refs = new Map<string, string>();
  const initialLayoutById = new Map<string, LayoutId>(initialDeck.slides.map((slide) => [slide.id, slide.layout]));
  const knownSlideIds = new Set<string>(initialDeck.slides.map((slide) => slide.id));
  let allOpsAreRestyle = rawOperations.length > 0;
  let hasRestyleOp = false;
  const rawExemptions = new Map<string, SlideRawExemptions>();
  const exemptSlide = (slideId: string, patch: { entireSlide?: boolean; notes?: boolean; section?: boolean; bodyElements?: boolean; headingRole?: "title" | "attribution"; elementId?: string }) => {
    if (!initialLayoutById.has(slideId)) return;
    const prev = rawExemptions.get(slideId) ?? {};
    const elementIds = prev.elementIds ? new Set(prev.elementIds) : new Set<string>();
    if (patch.elementId) elementIds.add(patch.elementId);
    rawExemptions.set(slideId, {
      ...prev,
      ...(patch.entireSlide ? { entireSlide: true } : {}),
      ...(patch.notes ? { notes: true } : {}),
      ...(patch.section ? { section: true } : {}),
      ...(patch.bodyElements ? { bodyElements: true } : {}),
      ...(patch.headingRole ? { headingRole: patch.headingRole } : {}),
      ...(elementIds.size ? { elementIds } : {}),
    });
  };

  for (let opIndex = 0; opIndex < rawOperations.length; opIndex++) {
    const rawOp = rawOperations[opIndex];
    if (!isObject(rawOp) || typeof rawOp.op !== "string") {
      throw new SlidesEditError(`operations[${opIndex}] must be an object with an op string.`);
    }
    if (rawOp.op === "restyle_deck") hasRestyleOp = true;
    else allOpsAreRestyle = false;

    switch (rawOp.op) {
      case "update_slide": {
        const slideId = resolveSlideId(asOptionalString(rawOp.slideId, "slideId"), deck, refs, "slideId");
        const idx = findSlideIndexOrThrow(deck, slideId);
        const beforeSlide = deck.slides[idx];
        const title = validateTitleText(asOptionalString(rawOp.title, "title"));
        const body = validateBodyText(asOptionalString(rawOp.body, "body"));
        const notes = validateNotes(asOptionalString(rawOp.notes, "notes"));
        const layout = asOptionalLayout(rawOp.layout);
        const hidden = asOptionalBoolean(rawOp.hidden, "hidden");
        const transition = asOptionalTransition(rawOp.transition);
        const section = validateSectionText(asOptionalString(rawOp.section, "section"));

        const initLayout = initialLayoutById.get(slideId);
        if (initLayout) {
          exemptSlide(slideId, {
            notes: notes !== null,
            section: section !== null,
            bodyElements: body !== null,
            headingRole: title !== null ? ((layout ?? initLayout) === "quote" ? "attribution" : "title") : undefined,
          });
        }

        if (title === null && body === null && notes === null && layout === null && hidden === null && transition === null && section === null) {
          throw new SlidesEditError("update_slide requires at least one field to update (title, body, notes, layout, hidden, transition, or section).");
        }

        const beforeSummary = slideSummary(beforeSlide);
        const { primary, continuations } = applyContentUpdateToSlide(beforeSlide, { title, body, targetLayout: layout }, deck.theme);
        let updated = applyMetadata(primary, { notes, hidden, transition, section });
        if (layout && updated.layout !== layout) {
          updated = layout === "twoColumn" ? splitBodyIntoTwoColumns(updated) : applyLayout(updated, layout);
        } else if (updated.layout === "twoColumn" && body !== null) {
          updated = splitBodyIntoTwoColumns(updated);
        }

        if (deck.slides.length + continuations.length > MAX_SLIDES) {
          throw new SlidesEditError(`Slide deck exceeds the maximum of ${MAX_SLIDES} slides.`);
        }

        const nextSlides = [...deck.slides];
        nextSlides.splice(idx, 1, updated, ...continuations);
        deck = { ...deck, slides: nextSlides };

        addFocus(updated.id);
        for (const extra of continuations) {
          knownSlideIds.add(extra.id);
          addFocus(extra.id);
        }

        const metaNotes: string[] = [];
        if (layout && beforeSlide.layout !== updated.layout) metaNotes.push(`layout: ${updated.layout}`);
        if (hidden !== null && Boolean(beforeSlide.hidden) !== Boolean(updated.hidden)) metaNotes.push(updated.hidden ? "hidden" : "visible");
        if (transition !== null && (beforeSlide.transition ?? "none") !== (updated.transition ?? "none")) metaNotes.push(`transition: ${updated.transition ?? "none"}`);
        if (section !== null && beforeSlide.section !== updated.section) metaNotes.push(`section: ${updated.section || "(unnamed)"}`);
        const afterText = metaNotes.length ? `${slideSummary(updated)}\n[${metaNotes.join(", ")}]` : slideSummary(updated);

        changes.push({
          op: "update",
          block: 0,
          target: { type: "slide", number: idx + 1 },
          before: beforeSummary,
          after: afterText,
        });
        for (let c = 0; c < continuations.length; c++) {
          changes.push({
            op: "add",
            block: 0,
            target: { type: "slide", number: idx + 2 + c },
            after: slideSummary(continuations[c]),
          });
        }
        break;
      }

      case "update_element": {
        const slideId = resolveSlideId(asOptionalString(rawOp.slideId, "slideId"), deck, refs, "slideId");
        const elementId = asOptionalString(rawOp.elementId, "elementId");
        if (elementId === null || !elementId.trim()) {
          throw new SlidesEditError("update_element requires a non-empty elementId.");
        }
        const body = validateBodyText(asOptionalString(rawOp.body, "body"));
        if (body === null) {
          throw new SlidesEditError("update_element requires body text.");
        }

        const idx = findSlideIndexOrThrow(deck, slideId);
        const beforeSlide = deck.slides[idx];
        const elIdx = beforeSlide.elements.findIndex((el) => el.id === elementId);
        if (elIdx < 0) {
          throw new SlidesEditError(`Element "${elementId}" was not found on slide "${slideId}". Use element IDs from read_note.`);
        }
        const targetEl = beforeSlide.elements[elIdx];
        if (targetEl.type !== "text" && targetEl.type !== "shape") {
          throw new SlidesEditError(`Element "${elementId}" is a ${targetEl.type} element and cannot be rewritten with update_element.`);
        }
        exemptSlide(slideId, { elementId });

        const nextDoc = singleBodyRichDoc(body, deck.theme);
        if (!nextDoc) {
          throw new SlidesEditError("update_element body must fit in a single text box without tables or multi-slide overflow. Shorten the text or use update_slide.");
        }

        let updatedEl: SlideElement = { ...targetEl, doc: nextDoc };
        if (targetEl.type === "shape") {
          if (!fitsInTextBox(nextDoc, targetEl)) {
            throw new SlidesEditError(`update_element body overflows shape element "${elementId}". Shorten the text or use update_slide.`);
          }
        } else {
          const { requiredHeight, innerHeight } = measureRichDocHeight(nextDoc, targetEl);
          if (requiredHeight > innerHeight * 1.05) {
            if (targetEl.autoHeight) {
              const neededBoxHeight = Math.ceil(requiredHeight + 24);
              const maxAllowedHeight = Math.max(0, SLIDE_HEIGHT - Math.max(0, targetEl.y) - 24);
              if (neededBoxHeight > maxAllowedHeight) {
                throw new SlidesEditError(`update_element body overflows slide bounds for text element "${elementId}". Shorten the text or use update_slide.`);
              }
              updatedEl = { ...updatedEl, h: Math.max(targetEl.h, neededBoxHeight) };
            } else {
              throw new SlidesEditError(`update_element body overflows text box "${elementId}". Shorten the text or use update_slide.`);
            }
          }
        }

        const beforeText = richDocText(targetEl.doc).trim() || `(${targetEl.type})`;
        const afterText = richDocText(nextDoc).trim() || "(empty)";
        const updatedSlide: Slide = {
          ...beforeSlide,
          elements: beforeSlide.elements.map((el) => (el.id === elementId ? updatedEl : el)),
        };
        deck = { ...deck, slides: deck.slides.map((s, i) => (i === idx ? updatedSlide : s)) };
        addFocus(updatedSlide.id);
        changes.push({
          op: "update",
          block: 0,
          target: { type: "slide", number: idx + 1 },
          before: beforeText,
          after: afterText,
        });
        break;
      }

      case "set_layout": {
        const slideId = resolveSlideId(asOptionalString(rawOp.slideId, "slideId"), deck, refs, "slideId");
        const layout = asOptionalLayout(rawOp.layout);
        if (!layout) throw new SlidesEditError("set_layout requires a valid layout.");
        const idx = findSlideIndexOrThrow(deck, slideId);
        const beforeSlide = deck.slides[idx];
        const updated = layout === "twoColumn" ? splitBodyIntoTwoColumns(beforeSlide) : applyLayout(beforeSlide, layout);
        deck = { ...deck, slides: deck.slides.map((s, i) => (i === idx ? updated : s)) };
        addFocus(updated.id);
        changes.push({
          op: "update",
          block: 0,
          target: { type: "slide", number: idx + 1 },
          before: `Layout: ${beforeSlide.layout}`,
          after: `Layout: ${updated.layout}`,
        });
        break;
      }

      case "split_slide": {
        const slideId = resolveSlideId(asOptionalString(rawOp.slideId, "slideId"), deck, refs, "slideId");
        const idx = findSlideIndexOrThrow(deck, slideId);
        const beforeSlide = deck.slides[idx];

        const firstTitle = validateTitleText(asOptionalString(rawOp.title, "title"));
        const firstBody = validateBodyText(asOptionalString(rawOp.body, "body"));
        const firstNotes = validateNotes(asOptionalString(rawOp.notes, "notes"));
        const firstLayout = asOptionalLayout(rawOp.layout);

        const secondTitle = validateTitleText(asOptionalString(rawOp.secondTitle, "secondTitle"), "secondTitle");
        const secondBody = validateBodyText(asOptionalString(rawOp.secondBody, "secondBody"), "secondBody");
        const secondNotes = validateNotes(asOptionalString(rawOp.secondNotes, "secondNotes"));
        const secondLayout = asOptionalLayout(rawOp.secondLayout, "secondLayout");
        const ref = asOptionalString(rawOp.ref, "ref");

        const initLayout = initialLayoutById.get(slideId);
        if (initLayout) {
          exemptSlide(slideId, {
            notes: firstNotes !== null,
            bodyElements: true,
            headingRole: (firstLayout ?? initLayout) === "quote" ? "attribution" : "title",
          });
        }

        if ((firstTitle === null || !firstTitle) && (firstBody === null || !firstBody.trim())) {
          throw new SlidesEditError("split_slide requires title or body for the first slide.");
        }
        if ((secondTitle === null || !secondTitle) && (secondBody === null || !secondBody.trim())) {
          throw new SlidesEditError("split_slide requires secondTitle or secondBody for the second slide.");
        }

        // notes を省略したときは、secondNotes の有無にかかわらず 1 枚目の元のノートを保つ（空文字を渡したときだけ消去）。
        const effectiveFirstNotes = firstNotes !== null ? firstNotes : (beforeSlide.notes ?? null);

        const firstRebuilt = buildSlidesFromContent(
          {
            title: firstTitle ?? "",
            body: firstBody ?? "",
            notes: effectiveFirstNotes,
            layout: firstLayout ?? (beforeSlide.layout === "blank" ? null : beforeSlide.layout),
            section: beforeSlide.section ?? null,
            hidden: beforeSlide.hidden ?? null,
            transition: beforeSlide.transition ?? null,
          },
          deck.theme,
        );
        // 元のメディア・図形・線を 1 枚目に保ち、元スライドの安定 ID と背景も引き継ぐ。
        const preservedDecorations = beforeSlide.elements.filter(isNonBodyDecoration);
        const firstSlide: Slide = {
          ...firstRebuilt[0],
          id: beforeSlide.id,
          ...(beforeSlide.background !== undefined ? { background: beforeSlide.background } : {}),
          elements: attachPreservedDecorations(firstRebuilt[0].elements, preservedDecorations),
        };

        const secondRebuilt = buildSlidesFromContent(
          {
            title: secondTitle ?? "",
            body: secondBody ?? "",
            notes: secondNotes,
            layout: secondLayout ?? (beforeSlide.layout === "blank" ? null : beforeSlide.layout),
            hidden: beforeSlide.hidden ?? null,
            transition: beforeSlide.transition ?? null,
          },
          deck.theme,
        );
        const secondSlide: Slide = {
          ...secondRebuilt[0],
          ...(beforeSlide.background !== undefined ? { background: beforeSlide.background } : {}),
        };
        registerRef(refs, knownSlideIds, ref, secondSlide.id);

        const replacement = [firstSlide, ...firstRebuilt.slice(1), secondSlide, ...secondRebuilt.slice(1)];
        if (deck.slides.length - 1 + replacement.length > MAX_SLIDES) {
          throw new SlidesEditError(`Slide deck exceeds the maximum of ${MAX_SLIDES} slides.`);
        }

        const nextSlides = [...deck.slides];
        nextSlides.splice(idx, 1, ...replacement);
        deck = { ...deck, slides: nextSlides };

        for (const s of replacement) {
          knownSlideIds.add(s.id);
          addFocus(s.id);
        }
        changes.push({
          op: "update",
          block: 0,
          target: { type: "slide", number: idx + 1 },
          before: slideSummary(beforeSlide),
          after: slideSummary(replacement[0]),
        });
        for (let r = 1; r < replacement.length; r++) {
          changes.push({
            op: "add",
            block: 0,
            target: { type: "slide", number: idx + 1 + r },
            after: slideSummary(replacement[r]),
          });
        }
        break;
      }

      case "merge_slides": {
        const targetIds = parseSlideIdList(rawOp.slideIds, deck, refs, "slideIds", 2);
        const indices = targetIds.map((id) => findSlideIndexOrThrow(deck, id));
        const orderedTargets = targetIds
          .map((id, i) => ({ id, idx: indices[i], slide: deck.slides[indices[i]] }))
          .sort((a, b) => a.idx - b.idx);
        const primaryTarget = orderedTargets[0];
        const removedSet = new Set(orderedTargets.slice(1).map((entry) => entry.id));

        const requestedTitle = validateTitleText(asOptionalString(rawOp.title, "title"));
        const requestedBody = validateBodyText(asOptionalString(rawOp.body, "body"));
        const requestedNotes = validateNotes(asOptionalString(rawOp.notes, "notes"));
        const requestedLayout = asOptionalLayout(rawOp.layout);
        const effectiveLayout = requestedLayout ?? (primaryTarget.slide.layout === "blank" ? null : primaryTarget.slide.layout);

        for (const entry of orderedTargets) {
          const initLayout = initialLayoutById.get(entry.id);
          if (!initLayout) continue;
          const isPrimary = entry.id === primaryTarget.id;
          exemptSlide(entry.id, {
            notes: requestedNotes !== null,
            bodyElements: requestedBody !== null,
            headingRole: requestedTitle !== null || (!isPrimary && requestedBody !== null)
              ? ((isPrimary && effectiveLayout === "quote") || initLayout === "quote" ? "attribution" : "title")
              : undefined,
          });
        }

        const combined = combineSlidesToBlocks(
          orderedTargets.map((entry) => entry.slide),
          effectiveLayout,
        );
        const mergedTitle = requestedTitle ?? combined.title;
        let mergedNotes: string | null = requestedNotes;
        if (mergedNotes === null) {
          const allNotes = orderedTargets.map((entry) => entry.slide.notes?.trim()).filter((n): n is string => Boolean(n));
          if (allNotes.length) {
            const joined = allNotes.join("\n\n");
            if (joined.length > MAX_SLIDE_NOTES) {
              throw new SlidesEditError(`Combined speaker notes exceed ${MAX_SLIDE_NOTES} characters.`);
            }
            mergedNotes = joined;
          }
        }

        const rebuilt = requestedBody !== null
          ? buildSlidesFromContent(
            {
              title: mergedTitle,
              ...(requestedTitle === null && combined.titleInline.length ? { titleInline: combined.titleInline } : {}),
              ...(requestedTitle === null && combined.titleDoc ? { titleDoc: combined.titleDoc } : {}),
              body: requestedBody,
              notes: mergedNotes,
              layout: effectiveLayout,
              section: primaryTarget.slide.section ?? null,
              hidden: primaryTarget.slide.hidden ?? null,
              transition: primaryTarget.slide.transition ?? null,
            },
            deck.theme,
          )
          : buildSlidesFromParsedBlocks(
            {
              title: mergedTitle,
              ...(requestedTitle === null && combined.titleInline.length ? { titleInline: combined.titleInline } : {}),
              ...(requestedTitle === null && combined.titleDoc ? { titleDoc: combined.titleDoc } : {}),
              bodyBlocks: combined.bodyBlocks,
              notes: mergedNotes,
              layout: effectiveLayout,
              section: primaryTarget.slide.section ?? null,
              hidden: primaryTarget.slide.hidden ?? null,
              transition: primaryTarget.slide.transition ?? null,
            },
            deck.theme,
          );

        // 統合対象の全スライドから画像・ホワイトボード枠・図形・線を回収して失わないようにする。
        const preservedDecorations = orderedTargets.flatMap((entry) => entry.slide.elements.filter(isNonBodyDecoration));
        const mergedSlide: Slide = {
          ...rebuilt[0],
          id: primaryTarget.slide.id,
          ...(primaryTarget.slide.background !== undefined ? { background: primaryTarget.slide.background } : {}),
          elements: attachPreservedDecorations(rebuilt[0].elements, preservedDecorations),
        };

        const extraSlides = rebuilt.slice(1);
        // 削除対象を除いたうえで、最初のスライド位置を統合スライドに差し替える（章名引き継ぎは deleteSlides を利用）。
        const pruned = deleteSlides(deck, removedSet);
        const newPrimaryIdx = pruned.slides.findIndex((s) => s.id === primaryTarget.id);
        if (pruned.slides.length + extraSlides.length > MAX_SLIDES) {
          throw new SlidesEditError(`Slide deck exceeds the maximum of ${MAX_SLIDES} slides.`);
        }
        const nextSlides = [...pruned.slides];
        nextSlides.splice(newPrimaryIdx, 1, mergedSlide, ...extraSlides);
        deck = { ...deck, slides: nextSlides };

        for (const entry of orderedTargets) addFocus(entry.id);
        for (const extra of extraSlides) {
          knownSlideIds.add(extra.id);
          addFocus(extra.id);
        }

        changes.push({
          op: "update",
          block: 0,
          target: { type: "slide", number: newPrimaryIdx + 1 },
          before: orderedTargets.map((entry) => `Slide ${entry.idx + 1}: ${slideTitleOf(entry.slide) || slideSummary(entry.slide)}`).join("\n"),
          after: slideSummary(mergedSlide),
        });
        for (let c = 0; c < extraSlides.length; c++) {
          changes.push({
            op: "add",
            block: 0,
            target: { type: "slide", number: newPrimaryIdx + 2 + c },
            after: slideSummary(extraSlides[c]),
          });
        }
        break;
      }

      case "add_slide": {
        const { afterRaw, atStart } = validateAnchorArgs(
          asOptionalString(rawOp.afterSlideId, "afterSlideId"),
          asOptionalBoolean(rawOp.atStart, "atStart"),
        );
        const ref = asOptionalString(rawOp.ref, "ref");
        const title = validateTitleText(asOptionalString(rawOp.title, "title")) ?? "";
        const body = validateBodyText(asOptionalString(rawOp.body, "body")) ?? "";
        const notes = validateNotes(asOptionalString(rawOp.notes, "notes"));
        const layout = asOptionalLayout(rawOp.layout);
        const hidden = asOptionalBoolean(rawOp.hidden, "hidden");
        const transition = asOptionalTransition(rawOp.transition);
        const section = validateSectionText(asOptionalString(rawOp.section, "section"));

        let insertAt: number;
        if (afterRaw !== null) {
          const afterId = resolveSlideId(afterRaw, deck, refs, "afterSlideId");
          insertAt = findSlideIndexOrThrow(deck, afterId) + 1;
        } else if (atStart) {
          insertAt = 0;
        } else {
          insertAt = deck.slides.length;
        }

        const created = buildSlidesFromContent(
          { title, body, notes, layout, section, hidden, transition },
          deck.theme,
        );
        if (deck.slides.length + created.length > MAX_SLIDES) {
          throw new SlidesEditError(`Slide deck exceeds the maximum of ${MAX_SLIDES} slides.`);
        }
        registerRef(refs, knownSlideIds, ref, created[0].id);
        for (const extra of created.slice(1)) knownSlideIds.add(extra.id);

        const nextSlides = [...deck.slides];
        nextSlides.splice(insertAt, 0, ...created);
        deck = { ...deck, slides: nextSlides };

        created.forEach((slide, offset) => {
          addFocus(slide.id);
          changes.push({
            op: "add",
            block: 0,
            target: { type: "slide", number: insertAt + offset + 1 },
            after: slideSummary(slide),
          });
        });
        break;
      }

      case "delete_slides": {
        const targetIds = parseSlideIdList(rawOp.slideIds, deck, refs, "slideIds", 1);
        for (const id of targetIds) exemptSlide(id, { entireSlide: true });
        const targets = targetIds.map((id) => {
          const idx = findSlideIndexOrThrow(deck, id);
          return { id, idx, slide: deck.slides[idx] };
        });
        for (const target of targets) {
          addFocus(target.id);
          changes.push({
            op: "delete",
            block: 0,
            target: { type: "slide", number: target.idx + 1 },
            before: slideSummary(target.slide),
          });
        }
        deck = deleteSlides(deck, new Set(targetIds));
        break;
      }

      case "reorder_slides": {
        const targetIds = parseSlideIdList(rawOp.slideIds, deck, refs, "slideIds", 1);
        const { afterRaw, atStart } = validateAnchorArgs(
          asOptionalString(rawOp.afterSlideId, "afterSlideId"),
          asOptionalBoolean(rawOp.atStart, "atStart"),
        );

        for (const id of targetIds) findSlideIndexOrThrow(deck, id);
        const beforeOrder = deck.slides.map((s, i) => `${i + 1}. ${slideTitleOf(s) || s.id}`).join("\n");

        const isFullPermutation = targetIds.length === deck.slides.length && afterRaw === null;
        if (isFullPermutation) {
          // 全体並び替え：元の行（章）所属を記憶し、並び替え後の連続区間の先頭だけに章見出しを付け直す。
          const originalRows = slideRows(deck.slides);
          const hasExplicitFirstSection = deck.slides[0]?.section !== undefined;
          const originRowOf = new Map<string, { rowIdx: number; title: string }>();
          originalRows.forEach((row, rowIdx) => {
            row.slides.forEach((slide) => originRowOf.set(slide.id, { rowIdx, title: row.title }));
          });
          const byId = new Map(deck.slides.map((s) => [s.id, s]));
          const reordered: Slide[] = [];
          let prevRowIdx: number | null = null;
          for (let i = 0; i < targetIds.length; i++) {
            const slide = stripSection(byId.get(targetIds[i])!);
            const origin = originRowOf.get(slide.id)!;
            if (i === 0) {
              if (origin.title || (origin.rowIdx === 0 && hasExplicitFirstSection) || origin.rowIdx > 0) {
                reordered.push({ ...slide, section: origin.title });
              } else {
                reordered.push(slide);
              }
            } else if (origin.rowIdx !== prevRowIdx) {
              reordered.push({ ...slide, section: origin.title });
            } else {
              reordered.push(slide);
            }
            prevRowIdx = origin.rowIdx;
          }
          deck = { ...deck, slides: reordered };
        } else {
          // 部分移動：エディターの moveSlides と同じ行（章）維持規則を使い、章の先頭スライドだけを移しても後続スライドの章名を残す。
          const targetSet = new Set(targetIds);
          const byId = new Map(deck.slides.map((s) => [s.id, s]));
          const moving = targetIds.map((id) => stripSection(byId.get(id)!));
          const rows = slideRows(deck.slides).map((row) => ({
            title: row.title,
            slides: row.slides.filter((s) => !targetSet.has(s.id)),
          }));

          if (afterRaw !== null) {
            const afterId = resolveSlideId(afterRaw, deck, refs, "afterSlideId");
            if (targetSet.has(afterId)) {
              throw new SlidesEditError("afterSlideId cannot be one of the slides being moved.");
            }
            const anchorRow = rows.find((row) => row.slides.some((s) => s.id === afterId));
            if (!anchorRow) {
              throw new SlidesEditError(`Slide "${afterId}" was not found. Use stable slide IDs from read_note.`);
            }
            const anchorPos = anchorRow.slides.findIndex((s) => s.id === afterId);
            anchorRow.slides.splice(anchorPos + 1, 0, ...moving);
          } else if (atStart) {
            const firstRow = rows.find((row) => row.slides.length > 0) ?? rows[0];
            if (firstRow) firstRow.slides.unshift(...moving);
            else rows.push({ title: "", slides: moving });
          } else {
            const lastRow = [...rows].reverse().find((row) => row.slides.length > 0) ?? rows[0];
            if (lastRow) lastRow.slides.push(...moving);
            else rows.push({ title: "", slides: moving });
          }
          deck = { ...deck, slides: slidesFromRows(rows) };
        }

        for (const id of targetIds) addFocus(id);
        const afterOrder = deck.slides.map((s, i) => `${i + 1}. ${slideTitleOf(s) || s.id}`).join("\n");
        changes.push({
          op: "reorder",
          block: 0,
          before: beforeOrder,
          after: afterOrder,
        });
        break;
      }

      case "restyle_deck": {
        const rawThemeId = asOptionalString(rawOp.themeId, "themeId");
        const rawThemeMode = asOptionalString(rawOp.themeMode, "themeMode");
        const rawSlideLayouts = rawOp.slideLayouts;

        if (rawThemeId !== null && !isValidThemeId(rawThemeId)) {
          throw new SlidesEditError(`themeId must be one of ${SLIDE_THEME_IDS.join(", ")}.`);
        }
        if (rawThemeMode !== null && !isValidThemeMode(rawThemeMode)) {
          throw new SlidesEditError('themeMode must be "light" or "dark".');
        }
        if (rawSlideLayouts !== null && rawSlideLayouts !== undefined && !Array.isArray(rawSlideLayouts)) {
          throw new SlidesEditError("slideLayouts must be an array or null.");
        }

        const layoutUpdates: { slideId: string; layout: LayoutId }[] = [];
        const seenLayoutIds = new Set<string>();
        for (const entry of (rawSlideLayouts as unknown[] | null | undefined) ?? []) {
          if (!isObject(entry)) throw new SlidesEditError("slideLayouts entries must be objects.");
          const slideId = resolveSlideId(asOptionalString(entry.slideId, "slideLayouts[].slideId"), deck, refs, "slideLayouts[].slideId");
          const layout = asOptionalLayout(entry.layout, "slideLayouts[].layout");
          if (!layout) throw new SlidesEditError("slideLayouts[].layout must be a valid slide layout.");
          if (seenLayoutIds.has(slideId)) throw new SlidesEditError(`Duplicate slideId "${slideId}" in slideLayouts.`);
          seenLayoutIds.add(slideId);
          findSlideIndexOrThrow(deck, slideId);
          layoutUpdates.push({ slideId, layout });
        }

        if (rawThemeId === null && rawThemeMode === null && layoutUpdates.length === 0) {
          throw new SlidesEditError("restyle_deck requires themeId, themeMode, or slideLayouts.");
        }

        const beforeRestyle = JSON.parse(JSON.stringify(deck)) as Deck;
        const nextTheme: DeckTheme = {
          id: rawThemeId ?? deck.theme.id,
          mode: (rawThemeMode as ThemeMode | null) ?? deck.theme.mode,
        };
        const layoutMap = new Map(layoutUpdates.map((item) => [item.slideId, item.layout]));
        const nextSlides = deck.slides.map((slide) => {
          const targetLayout = layoutMap.get(slide.id);
          return targetLayout ? applyLayout(slide, targetLayout) : slide;
        });
        const restyledDeck: Deck = { ...deck, theme: nextTheme, slides: nextSlides };

        // ハード不変条件：一括スタイル変更では本文・書式・リンク・数式・表・ノート・画像・図形・スライド構成を一切変えない。
        assertDeckTextPreserved(beforeRestyle, restyledDeck);

        const beforeParts = [`Theme: ${beforeRestyle.theme.id} (${beforeRestyle.theme.mode})`];
        const afterParts = [`Theme: ${restyledDeck.theme.id} (${restyledDeck.theme.mode})`];
        const themeChanged = beforeRestyle.theme.id !== restyledDeck.theme.id || beforeRestyle.theme.mode !== restyledDeck.theme.mode;
        const changedLayoutIds: string[] = [];
        for (const { slideId, layout } of layoutUpdates) {
          const idx = beforeRestyle.slides.findIndex((s) => s.id === slideId);
          if (idx >= 0 && beforeRestyle.slides[idx].layout !== layout) {
            beforeParts.push(`Slide ${idx + 1}: ${beforeRestyle.slides[idx].layout}`);
            afterParts.push(`Slide ${idx + 1}: ${layout}`);
            changedLayoutIds.push(slideId);
          }
        }
        for (const slideId of changedLayoutIds) addFocus(slideId);
        if (changedLayoutIds.length === 0) {
          for (const { slideId } of layoutUpdates) addFocus(slideId);
        }
        if (themeChanged || focusIds.length === 0) {
          for (const slide of restyledDeck.slides.slice(0, 3)) {
            if (focusIds.length >= 4) break;
            addFocus(slide.id);
          }
        }

        deck = restyledDeck;
        changes.push({
          op: "update",
          block: 0,
          before: beforeParts.join("\n"),
          after: afterParts.join("\n"),
        });
        break;
      }

      default:
        throw new SlidesEditError(`Unsupported slides operation: ${rawOp.op}`);
    }
  }

  if (deck.slides.length === 0) {
    throw new SlidesEditError("A slide deck must keep at least one slide.");
  }

  const { deck: normalizedDeck, data } = finalizeDeck(deck);
  if (allOpsAreRestyle) {
    // 全体の最終検証結果についても、生データからの切り詰めや変質が無いことを再確認する（複数回の段組変更による降格も含む）。
    assertRawStoredDeckNotLossyForRestyle(rawData, initialDeck);
    assertDeckTextPreserved(initialDeck, normalizedDeck, { allowPlaceholderToDemotedStyleChange: true });
  } else if (hasRestyleOp) {
    // 複合操作でも、書き換えていない既存フィールド・要素が生データ正規化で黙って切り詰められていないか確かめる。
    assertRawStoredDeckNotLossyForRestyle(rawData, initialDeck, rawExemptions);
  }
  const unchanged = JSON.stringify(initialDeck) === JSON.stringify(normalizedDeck);

  return {
    data,
    deck: normalizedDeck,
    changes,
    focusIds: focusIds.slice(0, 200),
    unchanged,
  };
}
