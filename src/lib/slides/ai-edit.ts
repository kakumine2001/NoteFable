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
function sanitizeBodyBlocks(blocks: Block[]): Block[] {
  return blocks.flatMap((block) => {
    const children = sanitizeBodyBlocks(block.children);
    if (block.type === "image" || block.type === "divider" || block.type === "tableOfContents") return children;
    const props = block.type === "heading" && block.props.level === 1 ? { ...block.props, level: 3 } : block.props;
    return [{ ...block, props, children }];
  });
}

function headingBlockFor(title: string): Block[] {
  if (!title) return [];
  const parsed = markdownToBlocks(prepareNoteMarkdown(`## ${title}`, { dropImages: true })).slice(0, 1);
  if (blocksHaveVisibleContent(parsed)) return parsed;
  return [{ id: "", type: "heading", props: { level: 2 }, content: [{ type: "text", text: title, styles: {} }], children: [] }];
}

function isSimpleBodyBlocks(blocks: Block[], maxChars: number): string | null {
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

// 1 枚分のタイトル・Markdown 本文・版式から、安全領域に収まる 1 枚以上のスライドを作る。
function buildSlidesFromContent(
  input: {
    title: string;
    body: string;
    notes: string | null;
    layout: LayoutId | null;
    section?: string | null;
    hidden?: boolean | null;
    transition?: SlideTransition | null;
  },
  theme: DeckTheme,
): Slide[] {
  const title = input.title.trim();
  const body = input.body.trim();
  const bodyParsed = body ? sanitizeBodyBlocks(markdownToBlocks(prepareNoteMarkdown(body, { dropImages: true }))) : [];
  const hasVisibleBody = blocksHaveVisibleContent(bodyParsed);

  if (!title && !hasVisibleBody) {
    const empty = createSlide(input.layout ?? "blank");
    return [applyMetadata(empty, { notes: input.notes, hidden: input.hidden, transition: input.transition, section: input.section })];
  }

  // title / section / quote は単純な文字だけなら専用プレースホルダーに直接入れて自然な見た目を保つ。
  if (input.layout === "title") {
    const simpleSub = isSimpleBodyBlocks(bodyParsed, 320);
    if (simpleSub !== null) {
      const slide = createSlide("title", { ...(title ? { title } : {}), ...(simpleSub ? { subtitle: simpleSub } : {}) });
      if (!simpleSub) slide.elements = slide.elements.filter((el) => el.role !== "subtitle");
      return [applyMetadata(slide, { notes: input.notes, hidden: input.hidden, transition: input.transition, section: input.section })];
    }
  }
  if (input.layout === "section") {
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
      const quoteText = simpleBody || title;
      const attribution = simpleBody && title ? title : "";
      const slide = createSlide("quote", { quote: quoteText, ...(attribution ? { attribution } : {}) });
      if (!attribution) slide.elements = slide.elements.filter((el) => el.role !== "attribution");
      return [applyMetadata(slide, { notes: input.notes, hidden: input.hidden, transition: input.transition, section: input.section })];
    }
  }

  const blocks = [...headingBlockFor(title), ...bodyParsed];
  const { deck, truncatedSlides } = noteToDeckResult({ title: "", blocks, theme });
  if (truncatedSlides > 0) {
    throw new SlidesEditError(`Slide content exceeds the maximum of ${MAX_SLIDES} slides.`);
  }
  const built = deck.slides.map(stripSection);
  if (!built.length) {
    const fallback = createSlide(input.layout ?? "blank", title ? { title } : {});
    return [applyMetadata(fallback, { notes: input.notes, hidden: input.hidden, transition: input.transition, section: input.section })];
  }

  if (input.layout) {
    built[0] = input.layout === "twoColumn"
      ? splitBodyIntoTwoColumns(built[0])
      : built[0].layout === input.layout
        ? built[0]
        : applyLayout(built[0], input.layout);
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

function fitsInTextBox(doc: RichDoc, box: Pick<TextElement, "w" | "h" | "style">): boolean {
  const fontSize = Math.max(12, box.style.size || 40);
  const lineHeight = Math.max(1.0, box.style.lineHeight || 1.3);
  const innerWidth = Math.max(80, box.w - 32);
  const innerHeight = Math.max(32, box.h - 24);
  const unitsPerLine = Math.max(8, innerWidth / (fontSize * 0.56));
  const linePx = fontSize * lineHeight;

  const measureBlocks = (blocks: readonly RichBlock[], indentUnits: number): number => {
    let heightPx = 0;
    for (const block of blocks) {
      if (block.type === "paragraph") {
        const text = richDocText({ type: "doc", content: [block] });
        const lines = text.split("\n").reduce((sum, seg) => sum + Math.max(1, Math.ceil(visualWidthUnits(seg) / Math.max(6, unitsPerLine - indentUnits))), 0);
        heightPx += lines * linePx + fontSize * 0.25;
      } else if (block.type === "bullet_list" || block.type === "ordered_list") {
        for (const item of block.content) {
          heightPx += measureBlocks(item.content, indentUnits + 2.5);
        }
      } else if (block.type === "code_block") {
        const text = (block.content ?? []).map((n) => n.text).join("");
        const lines = text.split("\n").reduce((sum, seg) => sum + Math.max(1, Math.ceil(visualWidthUnits(seg) / Math.max(6, unitsPerLine - indentUnits - 2))), 0);
        heightPx += lines * linePx * 0.9 + fontSize * 0.6;
      } else if (block.type === "math_block") {
        heightPx += linePx * 1.8;
      }
    }
    return heightPx;
  };

  return measureBlocks(doc.content, 0) <= innerHeight * 1.05;
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

// RichDoc をリンク・太字・斜体・打ち消し線・コード・数式・リストを保った Markdown へ戻す（merge_slides の既定結合用）。
function serializeInlineToMarkdown(inlines: readonly RichInline[] | undefined): string {
  if (!inlines?.length) return "";
  return inlines
    .map((node) => {
      if (node.type === "hard_break") return "  \n";
      if (node.type === "math_inline") return `$${node.attrs.latex}$`;
      let out = node.text;
      const marks = node.marks ?? [];
      const hasCode = marks.some((m) => m.type === "code");
      if (hasCode) {
        const fence = out.includes("`") ? "``" : "`";
        out = `${fence}${out}${fence}`;
      } else {
        if (marks.some((m) => m.type === "strong")) out = `**${out}**`;
        if (marks.some((m) => m.type === "em")) out = `*${out}*`;
        if (marks.some((m) => m.type === "strike")) out = `~~${out}~~`;
      }
      const link = marks.find((m) => m.type === "link");
      if (link && link.type === "link") {
        out = `[${out}](${link.attrs.href})`;
      }
      return out;
    })
    .join("");
}

function serializeBlocksToMarkdown(blocks: readonly RichBlock[], indent = ""): string {
  const chunks: string[] = [];
  for (const block of blocks) {
    if (block.type === "paragraph") {
      const text = serializeInlineToMarkdown(block.content).trim();
      if (text) chunks.push(`${indent}${text}`);
    } else if (block.type === "bullet_list") {
      const lines: string[] = [];
      for (const item of block.content) {
        const [first, ...rest] = item.content;
        const head = first?.type === "paragraph" ? serializeInlineToMarkdown(first.content).trim() : "";
        lines.push(`${indent}- ${head}`);
        if (rest.length) {
          const nested = serializeBlocksToMarkdown(rest, `${indent}  `);
          if (nested) lines.push(nested);
        }
      }
      if (lines.length) chunks.push(lines.join("\n"));
    } else if (block.type === "ordered_list") {
      const start = block.attrs?.order ?? 1;
      const lines: string[] = [];
      block.content.forEach((item, idx) => {
        const [first, ...rest] = item.content;
        const head = first?.type === "paragraph" ? serializeInlineToMarkdown(first.content).trim() : "";
        lines.push(`${indent}${start + idx}. ${head}`);
        if (rest.length) {
          const nested = serializeBlocksToMarkdown(rest, `${indent}   `);
          if (nested) lines.push(nested);
        }
      });
      if (lines.length) chunks.push(lines.join("\n"));
    } else if (block.type === "code_block") {
      const lang = block.attrs?.language ?? "";
      const code = (block.content ?? []).map((n) => n.text).join("");
      chunks.push(`${indent}\`\`\`${lang}\n${code}\n${indent}\`\`\``);
    } else if (block.type === "math_block") {
      chunks.push(`${indent}$$\n${block.attrs.latex}\n${indent}$$`);
    }
  }
  return chunks.join("\n\n");
}

function richDocToMarkdown(doc: RichDoc): string {
  return serializeBlocksToMarkdown(doc.content);
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
  updates: { title: string | null; body: string | null },
  theme: DeckTheme,
): { primary: Slide; continuations: Slide[] } {
  const hasTitleUpdate = updates.title !== null;
  const hasBodyUpdate = updates.body !== null;
  if (!hasTitleUpdate && !hasBodyUpdate) return { primary: slide, continuations: [] };

  const elements = slide.elements.map((el) => ({ ...el }));
  const headingRole: "title" | "attribution" = slide.layout === "quote" ? "attribution" : "title";

  // 1. タイトルのみの更新：既存のタイトル枠（無ければ新規追加）だけを差し替える。
  if (hasTitleUpdate && !hasBodyUpdate) {
    const newTitle = updates.title!;
    const headingIdx = elements.findIndex((el) => el.type === "text" && el.role === headingRole);
    if (headingIdx >= 0) {
      const existing = elements[headingIdx] as TextElement;
      elements[headingIdx] = { ...existing, doc: richDocFromText(newTitle, existing.style.align) };
      return { primary: { ...slide, elements }, continuations: [] };
    }
    if (newTitle) {
      const addedHeading = createHeadingElement(slide.layout, headingRole, newTitle);
      if (addedHeading) elements.push(addedHeading);
    }
    return { primary: { ...slide, elements }, continuations: [] };
  }

  // 2. 本文（および任意でタイトル）の更新：単純なリッチテキストで、実際の配置枠に収まるなら
  //    既存の枠をその場で差し替えて座標・書式・装飾をすべて保つ。
  const simpleBody = singleBodyRichDoc(updates.body!, theme);
  const bodyRole = slide.layout === "title" || slide.layout === "section"
    ? "subtitle"
    : slide.layout === "quote"
      ? "quote"
      : slide.layout === "fullImage"
        ? "caption"
        : "body";
  const existingBody = elements.find((el): el is TextElement => el.type === "text" && el.role === bodyRole);
  const hasExtraBody2OrTables = elements.some(
    (el) => (el.type === "text" && el.role === "body2" && !isRichDocEmpty(el.doc)) || el.type === "table",
  );
  // 2 段組みで複数箇条書き・複数段落が来た場合は、左枠に詰め込まず 2 列へ分ける（空の body2 がある場合も含む）。
  const wantsTwoColumnSplit = slide.layout === "twoColumn" && simpleBody !== null && (
    simpleBody.content.length >= 2 ||
    (simpleBody.content.length === 1 &&
      (simpleBody.content[0].type === "bullet_list" || simpleBody.content[0].type === "ordered_list") &&
      simpleBody.content[0].content.length >= 2)
  );

  if (simpleBody && existingBody && !hasExtraBody2OrTables && !wantsTwoColumnSplit && fitsInTextBox(simpleBody, existingBody)) {
    const existingBodyId = existingBody.id;
    if (hasTitleUpdate) {
      const titleIdx = elements.findIndex((el) => el.type === "text" && el.role === headingRole);
      if (titleIdx >= 0) {
        const existingTitle = elements[titleIdx] as TextElement;
        elements[titleIdx] = { ...existingTitle, doc: richDocFromText(updates.title!, existingTitle.style.align) };
      } else if (updates.title) {
        const addedTitle = createHeadingElement(slide.layout, headingRole, updates.title);
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

  // 3. 表・複数要素・あふれ・2段組み振り分けを含む本文更新、または既存本文枠が無いスライド：
  //    画像・ホワイトボード枠・図形・線と、未変更の既存タイトル要素（ID・書式込み）を守りながら再レイアウトする。
  const preservedDecorations = slide.elements.filter(isNonBodyDecoration);
  const existingTitleEl = slide.elements.find((el): el is TextElement => el.type === "text" && el.role === headingRole);
  const keepExistingTitleVerbatim = !hasTitleUpdate && existingTitleEl !== undefined && !isRichDocEmpty(existingTitleEl.doc);
  const effectiveTitle = hasTitleUpdate ? updates.title! : (existingTitleEl ? oneLine(richDocText(existingTitleEl.doc)) : "");

  const rebuilt = buildSlidesFromContent(
    {
      title: effectiveTitle,
      body: updates.body!,
      notes: null,
      layout: slide.layout === "blank" ? null : slide.layout,
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
function canonicalPreservedElement(element: SlideElement): Record<string, unknown> {
  if (element.type === "text") {
    const {
      x: _x, y: _y, w: _w, h: _h, rotation: _rotation, role: _role,
      style, fill, autoHeight,
      ...rest
    } = element;
    void _x; void _y; void _w; void _h; void _rotation; void _role;
    // プレースホルダーだった文字枠は applyLayout が配置とプレースホルダー書式（style/fill/autoHeight）を更新する。
    // 自由に置いた文字枠は style/fill/autoHeight も含めて一切変えない。
    if (element.role) {
      return { ...rest, doc: normalizeRichDoc(element.doc) };
    }
    return { ...rest, doc: normalizeRichDoc(element.doc), style, fill, autoHeight };
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
export function assertDeckTextPreserved(before: Deck, after: Deck): void {
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
    for (const id of beforeIds) {
      if (stableStringify(b.elements[id]) !== stableStringify(a.elements[id])) {
        throw new SlidesEditError(`Restyle invariant violated: content changed on slide ${b.id} element ${id}.`);
      }
    }
  }
}

// normalizeDeck が保存済みデッキの section / notes / text を暗黙に切り詰めてしまわないか、restyle_deck 時に生データ側でも確かめる。
function assertRawStoredDeckNotLossyForRestyle(rawData: unknown, finalDeck: Deck): void {
  if (!isObject(rawData) || !Array.isArray(rawData.slides)) return;
  const rawSlides = rawData.slides;
  if (rawSlides.length !== finalDeck.slides.length) {
    throw new SlidesEditError("Restyle invariant violated: stored slide count does not match normalized deck.");
  }
  for (let i = 0; i < rawSlides.length; i++) {
    const rawSlide = rawSlides[i];
    const finalSlide = finalDeck.slides[i];
    if (!isObject(rawSlide)) continue;
    if (typeof rawSlide.id === "string" && rawSlide.id !== finalSlide.id) {
      throw new SlidesEditError(`Restyle invariant violated: stored slide ID changed on slide ${i + 1}.`);
    }
    if (typeof rawSlide.section === "string" && rawSlide.section !== (finalSlide.section ?? "")) {
      throw new SlidesEditError(`Restyle invariant violated: stored section would be truncated on slide ${finalSlide.id}.`);
    }
    if (typeof rawSlide.notes === "string" && rawSlide.notes !== (finalSlide.notes ?? "")) {
      throw new SlidesEditError(`Restyle invariant violated: stored speaker notes would be altered on slide ${finalSlide.id}.`);
    }
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

// 複数枚を統合するとき、AI が title / body を省略した場合に、text と table を書式・リンク・コード・数式付きで結合する。
// 図形（shape）・線（line）・画像・白板枠はそのまま要素として引き継ぐため、本文側へ重複展開しない。
function combineSlidesMarkdown(slides: Slide[]): { title: string; body: string } {
  const firstTitle = slideTitleOf(slides[0]);
  const bodyChunks: string[] = [];
  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];
    const titleEl = slide.elements.find((el) => el.type === "text" && el.role === "title");
    if (i > 0 && titleEl?.type === "text") {
      const heading = oneLine(richDocText(titleEl.doc));
      if (heading && heading !== firstTitle) bodyChunks.push(`### ${heading}`);
    }
    for (const el of slide.elements) {
      if (el === titleEl) continue;
      if (el.type === "text") {
        const md = richDocToMarkdown(el.doc).trim();
        if (md) bodyChunks.push(md);
      } else if (el.type === "table") {
        const rows = el.rows.map((row) => `| ${row.cells.map((c) => c.text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ")).join(" | ")} |`);
        if (rows.length) {
          const sep = `| ${el.rows[0].cells.map(() => "---").join(" | ")} |`;
          bodyChunks.push([rows[0], sep, ...rows.slice(1)].join("\n"));
        }
      }
    }
  }
  return { title: firstTitle, body: bodyChunks.join("\n\n") };
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
  const knownSlideIds = new Set<string>(initialDeck.slides.map((slide) => slide.id));
  let allOpsAreRestyle = rawOperations.length > 0;

  for (let opIndex = 0; opIndex < rawOperations.length; opIndex++) {
    const rawOp = rawOperations[opIndex];
    if (!isObject(rawOp) || typeof rawOp.op !== "string") {
      throw new SlidesEditError(`operations[${opIndex}] must be an object with an op string.`);
    }
    if (rawOp.op !== "restyle_deck") allOpsAreRestyle = false;

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

        if (title === null && body === null && notes === null && layout === null && hidden === null && transition === null && section === null) {
          throw new SlidesEditError("update_slide requires at least one field to update (title, body, notes, layout, hidden, transition, or section).");
        }

        const beforeSummary = slideSummary(beforeSlide);
        const { primary, continuations } = applyContentUpdateToSlide(beforeSlide, { title, body }, deck.theme);
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

        const nextDoc = singleBodyRichDoc(body, deck.theme);
        if (!nextDoc) {
          throw new SlidesEditError("update_element body must fit in a single text box without tables or multi-slide overflow. Shorten the text or use update_slide.");
        }

        const beforeText = richDocText(targetEl.doc).trim() || `(${targetEl.type})`;
        const afterText = richDocText(nextDoc).trim() || "(empty)";
        const updatedSlide: Slide = {
          ...beforeSlide,
          elements: beforeSlide.elements.map((el) => (el.id === elementId ? { ...targetEl, doc: nextDoc } : el)),
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

        const combined = combineSlidesMarkdown(orderedTargets.map((entry) => entry.slide));
        const mergedTitle = requestedTitle ?? combined.title;
        const mergedBody = requestedBody ?? combined.body;
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

        const rebuilt = buildSlidesFromContent(
          {
            title: mergedTitle,
            body: mergedBody,
            notes: mergedNotes,
            layout: requestedLayout ?? (primaryTarget.slide.layout === "blank" ? null : primaryTarget.slide.layout),
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

        const isFullPermutation = targetIds.length === deck.slides.length && afterRaw === null && !atStart;
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
        for (const { slideId, layout } of layoutUpdates) {
          const idx = beforeRestyle.slides.findIndex((s) => s.id === slideId);
          if (idx >= 0 && beforeRestyle.slides[idx].layout !== layout) {
            beforeParts.push(`Slide ${idx + 1}: ${beforeRestyle.slides[idx].layout}`);
            afterParts.push(`Slide ${idx + 1}: ${layout}`);
          }
          addFocus(slideId);
        }
        for (const slide of restyledDeck.slides.slice(0, 3)) addFocus(slide.id);

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
    // 全体の最終検証結果についても、生データからの切り詰めや変質が無いことを再確認する。
    assertRawStoredDeckNotLossyForRestyle(rawData, normalizedDeck);
    assertDeckTextPreserved(initialDeck, normalizedDeck);
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
