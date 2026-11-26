import { MAX_SLIDES } from "@/lib/canvas-document";
import { isEmojiIcon } from "@/lib/emoji-icon";
import { mentionText } from "@/lib/note-mention";
import { validColumnWidth, COLUMN, COLUMN_LIST } from "@/lib/note-columns";
import {
  DEFAULT_TEXT_STYLE, DEFAULT_THEME, newId, normalizeDeck, safeImageSrc, SLIDE_WIDTH,
  type ColorRef, type Deck, type DeckTheme, type ImageElement, type LineElement, type ShapeElement, type Slide, type SlideElement, type TableElement, type TextElement,
  type TextStyle,
} from "@/lib/slides/model";
import { createSlide } from "@/lib/slides/layouts";
import { MAX_MATH_LATEX, safeHref, type RichBlock, type RichDoc, type RichInline, type RichListItem, type RichMark, type RichParagraph } from "@/lib/slides/rich-text";

// ノート（BlockNote のブロック JSON）を一時的なスライド（Deck）へ変換する純粋な関数（prisma・DOM を使わない）。
// 分割規則:
//   1. 最上位に divider（区切り線）があれば divider ごとに 1 セクション（空の塊は飛ばす）。
//   2. divider が無ければ最上位の H1 見出しごとに分割。ノート題名を表紙に使い、先頭が H1 でも空のスライドを作らない。
//   3. どちらも無ければ表紙 + 本文スライド。
// 各セクションが 1920 × 1080 の安全領域に収まらないときは、見出しに (2), (3)… を付けて自動で続ページを作る。

export type NoteToDeckLabels = {
  untitled?: string;
  file?: string;
  image?: string;
};

export type NoteToDeckInput = {
  title: string;
  blocks: unknown;
  theme?: DeckTheme;
  /** 空・無題ノートで仮の表紙を作るときに使う表示名（既定 "Untitled"）。 */
  untitledLabel?: string;
  /** 添付や無題のラベルを現在の UI 言語に合わせるための文言。 */
  labels?: NoteToDeckLabels;
};

export type NoteToDeckResult = {
  deck: Deck;
  totalSlides: number;
  truncatedSlides: number;
};

type ResolvedLabels = {
  untitled: string;
  file: string;
  image: string;
};

type RawBlock = {
  id?: unknown;
  type?: unknown;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: unknown;
};

type RawInline = {
  type?: unknown;
  text?: unknown;
  styles?: Record<string, unknown>;
  href?: unknown;
  content?: unknown;
  props?: Record<string, unknown>;
};

const MARGIN_X = 120;
const CONTENT_W = SLIDE_WIDTH - MARGIN_X * 2; // 1680
const TITLE_Y = 72;
const TITLE_H = 136;
const BODY_TOP_WITH_TITLE = 232;
const BODY_TOP_NO_TITLE = 96;
const BODY_BOTTOM = 1004;

const BODY_FONT_SIZE = 36;
const BODY_LINE_HEIGHT = 1.38;
const CODE_FONT_SIZE = 28;
const CODE_LINE_HEIGHT = 1.42;
const CALLOUT_FONT_SIZE = 34;
const QUOTE_FONT_SIZE = 36;
const COLUMN_GUTTER = 48;
const MAX_TABLE_COLS = 20;
const MAX_TABLE_ROWS = 50;
const MAX_LIST_DEPTH = 5;
const DEFAULT_CALLOUT_EMOJI = "💡";

// BlockNote の文字色名をスライドで安全な ColorRef に写す。
const NOTE_TEXT_COLORS: Record<string, ColorRef> = {
  gray: "muted",
  blue: "accent",
  red: "#dc2626",
  orange: "#ea580c",
  yellow: "#ca8a04",
  green: "#16a34a",
  purple: "#9333ea",
  pink: "#db2777",
  brown: "#92400e",
};

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const MAX_CHUNK_CHARS = 12_000;
const MAX_EXPANDED_TABLE_COLS = 200;
const MAX_EXPANDED_TABLE_ROWS = 2_000;

function cleanRawStr(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\u0000/g, "").replace(LONE_SURROGATE, "\uFFFD");
}

function cleanStr(value: unknown, max = 20_000): string {
  const cleaned = cleanRawStr(value);
  if (cleaned.length <= max) return cleaned;
  const end = (cleaned.charCodeAt(max - 1) & 0xfc00) === 0xd800 ? max - 1 : max;
  return cleaned.slice(0, end);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asBlocks(value: unknown): RawBlock[] {
  return Array.isArray(value) ? value.filter((item): item is RawBlock => isObject(item)) : [];
}

function propsOf(block: RawBlock): Record<string, unknown> {
  return isObject(block.props) ? block.props : {};
}

function childrenOf(block: RawBlock): RawBlock[] {
  return asBlocks(block.children);
}

// 全角（CJK・かな・ハングル・絵文字）を 1.0、半角文字を 0.56 として 1 行の文字幅を概算する。
function visualWidthUnits(text: string): number {
  let units = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (
      (code >= 0x1100 && code <= 0x11ff)
      || (code >= 0x2e80 && code <= 0x9fff)
      || (code >= 0xac00 && code <= 0xd7af)
      || (code >= 0xf900 && code <= 0xfaff)
      || (code >= 0xfe10 && code <= 0xfe6f)
      || (code >= 0xff00 && code <= 0xff60)
      || (code >= 0xffe0 && code <= 0xffe6)
      || code >= 0x1f000
    ) {
      units += 1.02;
    } else {
      units += 0.56;
    }
  }
  return units;
}

function estimateWrappedLines(text: string, fontSize: number, boxWidth: number, mono = false): number {
  const usable = Math.max(120, boxWidth - 32);
  const lines = text.split("\n");
  let total = 0;
  for (const line of lines) {
    if (!line.length) { total += 1; continue; }
    const units = mono ? line.length * 0.64 : visualWidthUnits(line);
    const widthPx = units * fontSize;
    total += Math.max(1, Math.ceil(widthPx / usable));
  }
  return Math.max(1, total);
}

function inlinePlain(content: unknown): string {
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const raw of content) {
    if (!isObject(raw)) continue;
    const node = raw as RawInline;
    if (node.type === "text" && typeof node.text === "string") parts.push(cleanRawStr(node.text));
    else if (node.type === "link") parts.push(inlinePlain(node.content));
    else if (node.type === "mathInline") {
      const latex = cleanStr(isObject(node.props) ? node.props.latex : "", MAX_MATH_LATEX).trim();
      if (latex) parts.push(`$${latex}$`);
    } else if (node.type === "mention" && isObject(node.props)) {
      const text = cleanStr(mentionText(node.props), 220).trim();
      if (text && text !== "@") parts.push(text);
    }
  }
  return parts.join("");
}

function mergeMarks(base: RichMark[], added: RichMark[]): RichMark[] | undefined {
  const map = new Map<string, RichMark>();
  for (const mark of base) map.set(mark.type, mark);
  for (const mark of added) map.set(mark.type, mark);
  return map.size ? [...map.values()] : undefined;
}

function pushTextWithBreaks(out: RichInline[], rawText: string, marks: RichMark[] | undefined) {
  const text = cleanRawStr(rawText);
  if (!text) return;
  const parts = text.split(/\r?\n/);
  parts.forEach((part, index) => {
    if (index > 0) out.push({ type: "hard_break" });
    if (part) out.push(marks?.length ? { type: "text", text: part, marks } : { type: "text", text: part });
  });
}

function stylesToMarks(styles: Record<string, unknown> | undefined): RichMark[] {
  if (!styles) return [];
  const marks: RichMark[] = [];
  if (styles.bold === true) marks.push({ type: "strong" });
  if (styles.italic === true) marks.push({ type: "em" });
  if (styles.underline === true) marks.push({ type: "underline" });
  if (styles.strike === true) marks.push({ type: "strike" });
  if (styles.code === true) marks.push({ type: "code" });
  if (typeof styles.textColor === "string" && Object.hasOwn(NOTE_TEXT_COLORS, styles.textColor)) {
    marks.push({ type: "color", attrs: { color: NOTE_TEXT_COLORS[styles.textColor] } });
  }
  return marks;
}

function inlineToRich(content: unknown, inheritedMarks: RichMark[] = []): RichInline[] {
  if (!Array.isArray(content)) return [];
  const out: RichInline[] = [];
  for (const raw of content) {
    if (!isObject(raw)) continue;
    const node = raw as RawInline;
    if (node.type === "text" && typeof node.text === "string") {
      const marks = mergeMarks(inheritedMarks, stylesToMarks(isObject(node.styles) ? node.styles : undefined));
      pushTextWithBreaks(out, node.text, marks);
    } else if (node.type === "link") {
      const href = safeHref(node.href);
      const nextMarks = href ? (mergeMarks(inheritedMarks, [{ type: "link", attrs: { href } }]) ?? inheritedMarks) : inheritedMarks;
      out.push(...inlineToRich(node.content, nextMarks));
    } else if (node.type === "mathInline") {
      const latex = cleanStr(isObject(node.props) ? node.props.latex : "", MAX_MATH_LATEX).trim();
      if (latex) out.push({ type: "math_inline", attrs: { latex } });
    } else if (node.type === "mention" && isObject(node.props)) {
      const text = cleanStr(mentionText(node.props), 220).trim();
      if (text && text !== "@") {
        const marks = mergeMarks(inheritedMarks, [{ type: "color", attrs: { color: "accent" } }]);
        out.push(marks ? { type: "text", text, marks } : { type: "text", text });
      }
    }
  }
  return out;
}

function richInlinePlain(nodes: RichInline[]): string {
  return nodes.map((node) => (node.type === "text" ? node.text : node.type === "hard_break" ? "\n" : node.attrs.latex)).join("");
}

function richInlineHasContent(nodes: RichInline[]): boolean {
  return nodes.some((node) => (node.type === "text" ? node.text.trim().length > 0 : node.type === "math_inline" ? node.attrs.latex.trim().length > 0 : false));
}

function alignOf(props: Record<string, unknown>): string | null {
  const align = props.textAlignment;
  return align === "left" || align === "center" || align === "right" || align === "justify" ? align : null;
}

function paragraphNode(content: RichInline[], align: string | null = null): RichParagraph {
  return content.length ? { type: "paragraph", attrs: { align }, content } : { type: "paragraph", attrs: { align } };
}

function blockHasVisibleContent(block: RawBlock): boolean {
  const props = propsOf(block);
  const children = childrenOf(block);
  if (block.type === "divider") return false;
  if (block.type === "tableOfContents") return children.some(blockHasVisibleContent);
  if (block.type === COLUMN_LIST || block.type === COLUMN) return children.some(blockHasVisibleContent);
  if (block.type === "mathBlock") return cleanStr(props.latex, MAX_MATH_LATEX).trim().length > 0 || children.some(blockHasVisibleContent);
  if (block.type === "image") return Boolean(safeImageSrc(props.url)) || children.some(blockHasVisibleContent);
  if (block.type === "file") {
    const hasMeta = Boolean(cleanStr(props.name, 200).trim() || cleanStr(props.caption, 500).trim() || safeImageSrc(props.url));
    return hasMeta || children.some(blockHasVisibleContent);
  }
  if (block.type === "table") {
    const content = isObject(block.content) ? block.content : null;
    const rows = content && Array.isArray(content.rows) ? content.rows : [];
    return rows.length > 0;
  }
  if (block.type === "codeBlock") {
    return inlinePlain(block.content).trim().length > 0 || children.some(blockHasVisibleContent);
  }
  return inlinePlain(block.content).trim().length > 0 || children.some(blockHasVisibleContent);
}

export function blocksHaveVisibleContent(blocks: RawBlock[]): boolean {
  return blocks.some(blockHasVisibleContent);
}

// ---- フロー項目（1 ページに収まる単位で測り、あふれると続ページへ送る） ----

type FlowItem =
  | { kind: "richBlock"; block: RichBlock; height: number }
  | { kind: "bulletItem"; item: RichListItem; height: number }
  | { kind: "orderedItem"; item: RichListItem; order: number; explicitStart: boolean; height: number }
  | { kind: "callout"; doc: RichDoc; height: number }
  | { kind: "quote"; doc: RichDoc; height: number }
  | { kind: "table"; rows: { cells: { text: string }[] }[]; cols: number[]; header: boolean; fontSize: number; height: number }
  | { kind: "image"; src: string; alt: string; caption: string; height: number }
  | { kind: "columns"; columns: { widthRatio: number; items: FlowItem[] }[]; height: number }
  | { kind: "rule"; height: number };

function estimateRichBlockHeight(block: RichBlock, boxWidth: number, fontSize = BODY_FONT_SIZE, depth = 0): number {
  const innerWidth = Math.max(200, boxWidth - depth * 44);
  if (block.type === "paragraph") {
    const nodes = block.content ?? [];
    let effectiveSize = fontSize;
    for (const node of nodes) {
      if (node.type === "text") {
        for (const mark of node.marks ?? []) {
          if (mark.type === "size" && mark.attrs.size > effectiveSize) effectiveSize = mark.attrs.size;
        }
      }
    }
    const text = richInlinePlain(nodes);
    const hasMath = nodes.some((node) => node.type === "math_inline");
    const lines = estimateWrappedLines(text || " ", effectiveSize, innerWidth);
    return Math.ceil(lines * effectiveSize * BODY_LINE_HEIGHT + (hasMath ? 18 : 14));
  }
  if (block.type === "code_block") {
    const code = block.content?.[0]?.text ?? "";
    const hasLang = Boolean(block.attrs?.language);
    const lines = estimateWrappedLines(code || " ", CODE_FONT_SIZE, innerWidth - 40, true);
    return Math.ceil(lines * CODE_FONT_SIZE * CODE_LINE_HEIGHT + (hasLang ? 72 : 48));
  }
  if (block.type === "math_block") {
    const latexLines = Math.max(1, (block.attrs.latex || "").split("\n").length);
    return Math.ceil(Math.max(108, latexLines * 58 + 44));
  }
  let total = 8;
  for (const item of block.content) {
    for (const child of item.content) total += estimateRichBlockHeight(child, boxWidth, fontSize, depth + 1);
  }
  return total;
}

function estimateListItemHeight(item: RichListItem, boxWidth: number, depth = 1): number {
  let h = 6;
  for (const block of item.content) h += estimateRichBlockHeight(block, boxWidth, BODY_FONT_SIZE, depth);
  return h;
}

function charVisualUnits(ch: string): number {
  const code = ch.codePointAt(0) ?? 0;
  if (
    (code >= 0x1100 && code <= 0x11ff)
    || (code >= 0x2e80 && code <= 0x9fff)
    || (code >= 0xac00 && code <= 0xd7af)
    || (code >= 0xf900 && code <= 0xfaff)
    || (code >= 0xfe10 && code <= 0xfe6f)
    || (code >= 0xff00 && code <= 0xff60)
    || (code >= 0xffe0 && code <= 0xffe6)
    || code >= 0x1f000
  ) {
    return 1.02;
  }
  return 0.56;
}

// 1 枚の安全高さを超える段落を、書式（太字・リンク・色等）と行内数式を保ったまま行数・文字幅の境界で分割する。
function splitRichParagraphByHeight(
  nodes: RichInline[],
  align: string | null,
  boxWidth: number,
  maxHeight: number,
  fontSize = BODY_FONT_SIZE,
  lineHeight = BODY_LINE_HEIGHT,
): RichParagraph[] {
  const usablePx = Math.max(120, boxWidth - 32);
  const maxLines = Math.max(1, Math.floor((maxHeight - 18) / (fontSize * lineHeight)));
  const out: RichParagraph[] = [];

  let chunk: RichInline[] = [];
  let chunkLines = 1;
  let chunkChars = 0;
  let linePx = 0;

  const flushChunk = () => {
    while (chunk.length && chunk[chunk.length - 1].type === "hard_break") chunk.pop();
    while (chunk.length && chunk[0].type === "hard_break") chunk.shift();
    if (richInlineHasContent(chunk)) out.push(paragraphNode(chunk, align));
    chunk = [];
    chunkLines = 1;
    chunkChars = 0;
    linePx = 0;
  };

  for (const node of nodes) {
    if (node.type === "hard_break") {
      if (chunkLines >= maxLines) {
        flushChunk();
      } else {
        chunk.push({ type: "hard_break" });
        chunkLines += 1;
        linePx = 0;
      }
      continue;
    }

    if (node.type === "math_inline") {
      const mathPx = Math.max(2, visualWidthUnits(node.attrs.latex)) * fontSize;
      if (linePx > 0 && linePx + mathPx > usablePx) {
        if (chunkLines >= maxLines) {
          flushChunk();
        } else {
          chunkLines += 1;
          linePx = 0;
        }
      }
      chunk.push(node);
      linePx += mathPx;
      chunkChars += node.attrs.latex.length + 2;
      continue;
    }

    // テキストノード：コードポイント単位で進め（サロゲートペアを割らない）、marks を保持しながら分割する。
    const marks = node.marks;
    let buf = "";
    const flushBuf = () => {
      if (!buf) return;
      chunk.push(marks?.length ? { type: "text", text: buf, marks } : { type: "text", text: buf });
      buf = "";
    };

    for (const ch of node.text) {
      const chPx = charVisualUnits(ch) * fontSize;
      const wouldExceedChars = chunkChars + buf.length >= MAX_CHUNK_CHARS;
      const wouldWrap = linePx > 0 && linePx + chPx > usablePx;

      if (wouldExceedChars || (wouldWrap && chunkLines >= maxLines)) {
        // できれば現在のバッファ末尾の空白・句読点で自然に切る。
        let carry = "";
        if (buf.length > 8) {
          const splitIdx = Math.max(buf.lastIndexOf(" "), buf.lastIndexOf("。"), buf.lastIndexOf("、"), buf.lastIndexOf(". "), buf.lastIndexOf(", "));
          if (splitIdx > buf.length * 0.45 && splitIdx < buf.length - 1) {
            carry = buf.slice(splitIdx + 1);
            buf = buf.slice(0, splitIdx + 1);
          }
        }
        flushBuf();
        flushChunk();
        buf = carry + ch;
        linePx = visualWidthUnits(buf) * fontSize;
        chunkChars = buf.length;
        continue;
      }

      if (wouldWrap) {
        chunkLines += 1;
        linePx = chPx;
      } else {
        linePx += chPx;
      }
      buf += ch;
      chunkChars += 1;
    }
    flushBuf();
  }

  flushChunk();
  return out.length ? out : [paragraphNode(nodes, align)];
}

// 非常に長い 1 行のコードを行幅・文字数上限で分割する（20,000 文字超でも末尾を落とさない）。
function splitSingleCodeLine(line: string, maxCharsPerLine: number): string[] {
  if (line.length <= maxCharsPerLine) return [line];
  const parts: string[] = [];
  let buf = "";
  for (const ch of line) {
    if (buf.length >= maxCharsPerLine) {
      parts.push(buf);
      buf = "";
    }
    buf += ch;
  }
  if (buf) parts.push(buf);
  return parts;
}

// 入れ子の子ブロックを RichBlock[] へ変換する（リスト項目やトグル・コールアウトの中身用）。
function childrenToRichBlocks(children: RawBlock[], depth: number, labels: ResolvedLabels): RichBlock[] {
  const out: RichBlock[] = [];
  let i = 0;
  while (i < children.length) {
    const child = children[i];
    if (child.type === COLUMN_LIST || child.type === COLUMN) {
      out.push(...childrenToRichBlocks(childrenOf(child), depth, labels));
      i++;
      continue;
    }
    if (child.type === "bulletListItem" && depth < MAX_LIST_DEPTH) {
      const items: RichListItem[] = [];
      while (i < children.length && children[i].type === "bulletListItem") {
        items.push(blockToListItem(children[i], depth + 1, labels));
        i++;
      }
      out.push({ type: "bullet_list", content: items });
      continue;
    }
    if (child.type === "numberedListItem" && depth < MAX_LIST_DEPTH) {
      const startProp = propsOf(child).start;
      const order = typeof startProp === "number" && Number.isInteger(startProp) && startProp > 0 ? startProp : 1;
      const items: RichListItem[] = [];
      let first = true;
      while (i < children.length && children[i].type === "numberedListItem") {
        const nextStart = propsOf(children[i]).start;
        if (!first && typeof nextStart === "number" && Number.isInteger(nextStart) && nextStart > 0) break;
        items.push(blockToListItem(children[i], depth + 1, labels));
        first = false;
        i++;
      }
      out.push({ type: "ordered_list", attrs: { order }, content: items });
      continue;
    }
    const props = propsOf(child);
    if (child.type === "mathBlock") {
      const latex = cleanStr(props.latex, MAX_MATH_LATEX).trim();
      if (latex) out.push({ type: "math_block", attrs: { latex } });
    } else if (child.type === "codeBlock") {
      const code = cleanRawStr(inlinePlain(child.content));
      const lang = cleanStr(props.language, 40).trim();
      const hasLang = lang && !/^(text|plain|plaintext)$/i.test(lang);
      if (code.trim()) {
        for (let offset = 0; offset < code.length; offset += MAX_CHUNK_CHARS) {
          const piece = code.slice(offset, offset + MAX_CHUNK_CHARS);
          out.push({ type: "code_block", ...(hasLang ? { attrs: { language: lang } } : {}), content: [{ type: "text", text: piece }] });
        }
      }
    } else if (child.type === "file") {
      const label = fileLabel(props, labels);
      if (label) out.push(paragraphNode([{ type: "text", text: label, marks: [{ type: "color", attrs: { color: "muted" } }] }]));
    } else if (child.type === "image") {
      const alt = cleanStr(props.caption || props.name || labels.image, 200).trim() || labels.image;
      if (safeImageSrc(props.url)) out.push(paragraphNode([{ type: "text", text: `[${labels.image}: ${alt}]`, marks: [{ type: "color", attrs: { color: "muted" } }] }]));
    } else if (child.type === "table") {
      const grid = extractTableGrid(child);
      if (grid) {
        for (const row of grid.rows) {
          const line = row.join("  |  ").trim();
          if (line) out.push(paragraphNode([{ type: "text", text: cleanStr(line) }]));
        }
      }
    } else if (child.type !== "divider" && child.type !== "tableOfContents") {
      const prefix = blockPrefix(child);
      const inline = inlineToRich(child.content);
      const full: RichInline[] = child.type === "quote"
        ? [{ type: "text", text: "“" }, ...inline, { type: "text", text: "”" }]
        : (prefix ? [{ type: "text", text: prefix }, ...inline] : inline);
      if (richInlineHasContent(inline)) out.push(paragraphNode(full, alignOf(props)));
    }
    const nested = childrenOf(child);
    if (nested.length) out.push(...childrenToRichBlocks(nested, Math.min(depth + 1, MAX_LIST_DEPTH), labels));
    i++;
  }
  return out;
}

function blockPrefix(block: RawBlock): string {
  const props = propsOf(block);
  if (block.type === "checkListItem") return props.checked === true ? "☑ " : "☐ ";
  if (block.type === "toggleListItem") return "▸ ";
  if (block.type === "callout") {
    const emoji = isEmojiIcon(props.emoji) ? (props.emoji as string) : DEFAULT_CALLOUT_EMOJI;
    return `${emoji} `;
  }
  return "";
}

function blockToListItem(block: RawBlock, depth: number, labels: ResolvedLabels): RichListItem {
  const inline = inlineToRich(block.content);
  const content: RichBlock[] = [paragraphNode(inline, alignOf(propsOf(block)))];
  const nested = childrenOf(block);
  if (nested.length) content.push(...childrenToRichBlocks(nested, depth, labels));
  return { type: "list_item", content };
}

function fileLabel(props: Record<string, unknown>, labels: ResolvedLabels): string {
  const name = cleanStr(props.name, 200).trim() || labels.file;
  const caption = cleanStr(props.caption, 500).trim();
  if (!name && !caption) return "";
  return caption ? `[${labels.file}: ${name} — ${caption}]` : `[${labels.file}: ${name}]`;
}

type TableBand = {
  rows: { cells: { text: string }[] }[];
  cols: number[];
  header: boolean;
};

// colspan / rowspan を考慮して 2 次元格子へ展開する（結合セルの後の列ズレを防ぐ）。
function extractTableGrid(block: RawBlock): { rows: string[][]; rawWidths: (number | null)[]; headerRows: number } | null {
  const content = isObject(block.content) ? block.content : null;
  if (!content || content.type !== "tableContent" || !Array.isArray(content.rows) || !content.rows.length) return null;

  const grid: string[][] = [];
  const occupied: boolean[][] = [];
  let maxCols = 0;
  let r = 0;

  for (const rawRow of content.rows as unknown[]) {
    if (r >= MAX_EXPANDED_TABLE_ROWS) break;
    if (!isObject(rawRow) || !Array.isArray(rawRow.cells)) continue;
    if (!grid[r]) grid[r] = [];
    if (!occupied[r]) occupied[r] = [];
    let c = 0;

    for (const rawCell of rawRow.cells) {
      while (occupied[r][c] && c < MAX_EXPANDED_TABLE_COLS) c++;
      if (c >= MAX_EXPANDED_TABLE_COLS) break;

      let cellText = "";
      let colspan = 1;
      let rowspan = 1;
      if (Array.isArray(rawCell)) {
        cellText = cleanStr(inlinePlain(rawCell), 2000).trim();
      } else if (isObject(rawCell)) {
        cellText = cleanStr(inlinePlain(rawCell.content), 2000).trim();
        const cellProps = isObject(rawCell.props) ? rawCell.props : null;
        if (cellProps) {
          const cs = Number(cellProps.colspan);
          const rs = Number(cellProps.rowspan);
          if (Number.isInteger(cs) && cs >= 1) colspan = Math.min(cs, MAX_EXPANDED_TABLE_COLS - c);
          if (Number.isInteger(rs) && rs >= 1) rowspan = Math.min(rs, MAX_EXPANDED_TABLE_ROWS - r);
        }
      }

      for (let dr = 0; dr < rowspan; dr++) {
        const rr = r + dr;
        if (!grid[rr]) grid[rr] = [];
        if (!occupied[rr]) occupied[rr] = [];
        for (let dc = 0; dc < colspan; dc++) {
          const cc = c + dc;
          if (cc >= MAX_EXPANDED_TABLE_COLS) break;
          occupied[rr][cc] = true;
          if (dr === 0 && dc === 0) grid[rr][cc] = cellText;
          else if (grid[rr][cc] === undefined) grid[rr][cc] = "";
        }
      }
      maxCols = Math.max(maxCols, c + colspan);
      c += colspan;
    }
    r++;
  }

  if (!grid.length || maxCols === 0) return null;
  const normalizedRows = grid.map((row) => Array.from({ length: maxCols }, (_, idx) => row[idx] ?? ""));
  const rawWidthsSource = Array.isArray(content.columnWidths) ? content.columnWidths : [];
  const rawWidths = Array.from({ length: maxCols }, (_, idx) => {
    const w = rawWidthsSource[idx];
    return typeof w === "number" && Number.isFinite(w) && w > 0 ? w : null;
  });
  const headerRows = typeof content.headerRows === "number" ? content.headerRows : 0;
  return { rows: normalizedRows, rawWidths, headerRows };
}

// 20 列を超える幅広の表は横方向の帯（最大 20 列ずつ）に分割し、どの列も欠落させない。
function extractTableBands(block: RawBlock): TableBand[] {
  const grid = extractTableGrid(block);
  if (!grid) return [];
  const totalCols = grid.rows[0].length;
  const bands: TableBand[] = [];

  for (let startCol = 0; startCol < totalCols; startCol += MAX_TABLE_COLS) {
    const endCol = Math.min(totalCols, startCol + MAX_TABLE_COLS);
    const colCount = endCol - startCol;
    const bandWidths = grid.rawWidths.slice(startCol, endCol);
    let cols: number[];
    if (bandWidths.some((w) => w !== null)) {
      const positive = bandWidths.filter((w): w is number => w !== null);
      const avg = positive.reduce((sum, w) => sum + w, 0) / positive.length;
      cols = bandWidths.map((w) => Math.min(20, Math.max(0.25, Math.round(((w ?? avg) / avg) * 100) / 100)));
    } else {
      cols = Array.from({ length: colCount }, () => 1);
    }
    const rows = grid.rows.map((row) => ({
      cells: row.slice(startCol, endCol).map((text) => ({ text })),
    }));
    bands.push({ rows, cols, header: grid.headerRows > 0 });
  }
  return bands;
}

function estimateTableRowHeight(row: { cells: { text: string }[] }, cols: number[], boxWidth: number, fontSize: number): number {
  const totalRatio = cols.reduce((sum, c) => sum + c, 0) || 1;
  let maxLines = 1;
  row.cells.forEach((cell, index) => {
    const colW = Math.max(80, (boxWidth * (cols[index] ?? 1)) / totalRatio - 28);
    const lines = estimateWrappedLines(cell.text || " ", fontSize, colW);
    if (lines > maxLines) maxLines = lines;
  });
  return Math.ceil(maxLines * fontSize * 1.32 + 24);
}

// ブロック列をフロー項目列へ変換する。長すぎるコード・表・段落はこの段階で 1 枚に収まる塊へ分割する。
function blocksToFlowItems(blocks: RawBlock[], boxWidth: number, maxItemHeight: number, labels: ResolvedLabels): FlowItem[] {
  const out: FlowItem[] = [];
  let runningOrder = 1;

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const props = propsOf(block);
    const children = childrenOf(block);

    if (block.type !== "numberedListItem") runningOrder = 1;

    switch (block.type) {
      case "heading": {
        const level = props.level === 1 || props.level === 2 || props.level === 3 ? props.level : 2;
        const size = level === 1 ? 56 : level === 2 ? 48 : 42;
        const marks: RichMark[] = [{ type: "strong" }, { type: "color", attrs: { color: "heading" } }, { type: "size", attrs: { size } }];
        const inline = inlineToRich(block.content, marks);
        if (richInlineHasContent(inline)) {
          const node = paragraphNode(inline, alignOf(props));
          const est = estimateRichBlockHeight(node, boxWidth);
          if (est <= maxItemHeight && richInlinePlain(inline).length <= MAX_CHUNK_CHARS) {
            out.push({ kind: "richBlock", block: node, height: est + 14 });
          } else {
            for (const p of splitRichParagraphByHeight(inline, alignOf(props), boxWidth, maxItemHeight, size, BODY_LINE_HEIGHT)) {
              out.push({ kind: "richBlock", block: p, height: Math.min(maxItemHeight, estimateRichBlockHeight(p, boxWidth)) + 14 });
            }
          }
        }
        if (children.length) out.push(...blocksToFlowItems(children, boxWidth, maxItemHeight, labels));
        break;
      }

      case "paragraph": {
        const inline = inlineToRich(block.content);
        if (richInlineHasContent(inline)) {
          const node = paragraphNode(inline, alignOf(props));
          const est = estimateRichBlockHeight(node, boxWidth);
          if (est <= maxItemHeight && richInlinePlain(inline).length <= MAX_CHUNK_CHARS) {
            out.push({ kind: "richBlock", block: node, height: est });
          } else {
            // 1 段落がスライド 1 枚より長い場合は書式・行内数式を保ったまま行数・文字幅の境界で分割する。
            for (const p of splitRichParagraphByHeight(inline, alignOf(props), boxWidth, maxItemHeight)) {
              out.push({ kind: "richBlock", block: p, height: Math.min(maxItemHeight, estimateRichBlockHeight(p, boxWidth)) });
            }
          }
        }
        if (children.length) out.push(...blocksToFlowItems(children, boxWidth, maxItemHeight, labels));
        break;
      }

      case "bulletListItem": {
        const item = blockToListItem(block, 1, labels);
        const est = estimateListItemHeight(item, boxWidth);
        const headInline = inlineToRich(block.content);
        if (est <= maxItemHeight && richInlinePlain(headInline).length <= MAX_CHUNK_CHARS) {
          out.push({ kind: "bulletItem", item, height: est });
        } else {
          // 巨大な箇条書きは先頭本文を書式・数式付きで行分割し、子ブロックも通常フローへ引き継ぐ。
          const headParts = splitRichParagraphByHeight(headInline, alignOf(props), boxWidth - 44, maxItemHeight);
          headParts.forEach((p, idx) => {
            if (idx === 0) {
              const headOnly: RichListItem = { type: "list_item", content: [p] };
              out.push({ kind: "bulletItem", item: headOnly, height: Math.min(maxItemHeight, estimateListItemHeight(headOnly, boxWidth)) });
            } else {
              out.push({ kind: "richBlock", block: p, height: Math.min(maxItemHeight, estimateRichBlockHeight(p, boxWidth)) });
            }
          });
          if (children.length) out.push(...blocksToFlowItems(children, boxWidth, maxItemHeight, labels));
        }
        break;
      }

      case "numberedListItem": {
        const startProp = props.start;
        const explicitStart = typeof startProp === "number" && Number.isInteger(startProp) && startProp > 0;
        const order = explicitStart ? (startProp as number) : runningOrder;
        runningOrder = order + 1;
        const item = blockToListItem(block, 1, labels);
        const est = estimateListItemHeight(item, boxWidth);
        const headInline = inlineToRich(block.content);
        if (est <= maxItemHeight && richInlinePlain(headInline).length <= MAX_CHUNK_CHARS) {
          out.push({ kind: "orderedItem", item, order, explicitStart, height: est });
        } else {
          const headParts = splitRichParagraphByHeight(headInline, alignOf(props), boxWidth - 44, maxItemHeight);
          headParts.forEach((p, idx) => {
            if (idx === 0) {
              const headOnly: RichListItem = { type: "list_item", content: [p] };
              out.push({ kind: "orderedItem", item: headOnly, order, explicitStart, height: Math.min(maxItemHeight, estimateListItemHeight(headOnly, boxWidth)) });
            } else {
              out.push({ kind: "richBlock", block: p, height: Math.min(maxItemHeight, estimateRichBlockHeight(p, boxWidth)) });
            }
          });
          if (children.length) out.push(...blocksToFlowItems(children, boxWidth, maxItemHeight, labels));
        }
        break;
      }

      case "checkListItem": {
        const prefix = props.checked === true ? "☑ " : "☐ ";
        const inline = inlineToRich(block.content);
        const full: RichInline[] = [{ type: "text", text: prefix }, ...inline];
        if (richInlineHasContent(inline)) {
          const p = paragraphNode(full, alignOf(props));
          const est = estimateRichBlockHeight(p, boxWidth);
          if (est <= maxItemHeight && richInlinePlain(full).length <= MAX_CHUNK_CHARS) {
            out.push({ kind: "richBlock", block: p, height: est });
          } else {
            for (const part of splitRichParagraphByHeight(full, alignOf(props), boxWidth, maxItemHeight)) {
              out.push({ kind: "richBlock", block: part, height: Math.min(maxItemHeight, estimateRichBlockHeight(part, boxWidth)) });
            }
          }
        }
        if (children.length) {
          const nested = childrenToRichBlocks(children, 1, labels);
          if (nested.length) {
            const list: RichBlock = { type: "bullet_list", content: [{ type: "list_item", content: nested[0].type === "paragraph" ? nested : [paragraphNode([]), ...nested] }] };
            const est = estimateRichBlockHeight(list, boxWidth);
            if (est <= maxItemHeight) out.push({ kind: "richBlock", block: list, height: est });
            else out.push(...blocksToFlowItems(children, boxWidth, maxItemHeight, labels));
          }
        }
        break;
      }

      case "toggleListItem": {
        const inline = inlineToRich(block.content, [{ type: "strong" }]);
        if (richInlineHasContent(inline)) {
          const full: RichInline[] = [{ type: "text", text: "▸ ", marks: [{ type: "color", attrs: { color: "accent" } }] }, ...inline];
          const p = paragraphNode(full, alignOf(props));
          const est = estimateRichBlockHeight(p, boxWidth);
          if (est <= maxItemHeight && richInlinePlain(full).length <= MAX_CHUNK_CHARS) {
            out.push({ kind: "richBlock", block: p, height: est });
          } else {
            for (const part of splitRichParagraphByHeight(full, alignOf(props), boxWidth, maxItemHeight)) {
              out.push({ kind: "richBlock", block: part, height: Math.min(maxItemHeight, estimateRichBlockHeight(part, boxWidth)) });
            }
          }
        }
        if (children.length) out.push(...blocksToFlowItems(children, boxWidth, maxItemHeight, labels));
        break;
      }

      case "quote": {
        const content: RichBlock[] = [];
        const inline = inlineToRich(block.content);
        if (richInlineHasContent(inline)) content.push(paragraphNode(inline, alignOf(props)));
        if (children.length) content.push(...childrenToRichBlocks(children, 1, labels));
        if (content.length) {
          const doc: RichDoc = { type: "doc", content };
          const h = content.reduce((sum, b) => sum + estimateRichBlockHeight(b, boxWidth - 44, QUOTE_FONT_SIZE), 0) + 28;
          if (h <= maxItemHeight && richInlinePlain(inline).length <= MAX_CHUNK_CHARS) {
            out.push({ kind: "quote", doc, height: Math.max(76, h) });
          } else {
            // 長い引用は先頭本文を書式・数式付きで行分割し、子ブロック（数式・リスト・コード等）も通常のフローへそのまま引き継ぐ。
            if (richInlineHasContent(inline)) {
              const quoteBudget = Math.max(96, maxItemHeight - 28);
              for (const part of splitRichParagraphByHeight(inline, alignOf(props), boxWidth - 44, quoteBudget, QUOTE_FONT_SIZE, BODY_LINE_HEIGHT)) {
                const pDoc: RichDoc = { type: "doc", content: [part] };
                const ph = estimateRichBlockHeight(part, boxWidth - 44, QUOTE_FONT_SIZE) + 28;
                out.push({ kind: "quote", doc: pDoc, height: Math.min(maxItemHeight, Math.max(76, ph)) });
              }
            }
            if (children.length) out.push(...blocksToFlowItems(children, boxWidth, maxItemHeight, labels));
          }
        }
        break;
      }

      case "callout": {
        const emoji = isEmojiIcon(props.emoji) ? (props.emoji as string) : DEFAULT_CALLOUT_EMOJI;
        const inline = inlineToRich(block.content);
        const content: RichBlock[] = [];
        const lead: RichInline[] = [{ type: "text", text: `${emoji} ` }, ...inline];
        if (richInlineHasContent(inline) || !children.length) content.push(paragraphNode(lead, alignOf(props)));
        if (children.length) content.push(...childrenToRichBlocks(children, 1, labels));
        if (content.length) {
          const doc: RichDoc = { type: "doc", content };
          const textH = content.reduce((sum, b) => sum + estimateRichBlockHeight(b, boxWidth - 72, CALLOUT_FONT_SIZE), 0);
          const h = Math.max(96, textH + 44);
          if (h <= maxItemHeight && richInlinePlain(lead).length <= MAX_CHUNK_CHARS) {
            out.push({ kind: "callout", doc, height: h });
          } else {
            // コールアウト自体が 1 枚を超える場合は先頭テキストを分割し、子要素は通常フローへ引き継ぐ。
            if (richInlineHasContent(inline) || !children.length) {
              const calloutBudget = Math.max(96, maxItemHeight - 44);
              for (const part of splitRichParagraphByHeight(lead, alignOf(props), boxWidth - 72, calloutBudget, CALLOUT_FONT_SIZE, BODY_LINE_HEIGHT)) {
                const headDoc: RichDoc = { type: "doc", content: [part] };
                const headH = Math.min(maxItemHeight, Math.max(96, estimateRichBlockHeight(part, boxWidth - 72, CALLOUT_FONT_SIZE) + 44));
                out.push({ kind: "callout", doc: headDoc, height: headH });
              }
            }
            if (children.length) out.push(...blocksToFlowItems(children, boxWidth, maxItemHeight, labels));
          }
        }
        break;
      }

      case "mathBlock": {
        const latex = cleanStr(props.latex, MAX_MATH_LATEX).trim();
        if (latex) {
          const node: RichBlock = { type: "math_block", attrs: { latex } };
          out.push({ kind: "richBlock", block: node, height: Math.min(maxItemHeight, estimateRichBlockHeight(node, boxWidth)) });
        }
        if (children.length) out.push(...blocksToFlowItems(children, boxWidth, maxItemHeight, labels));
        break;
      }

      case "codeBlock": {
        const code = cleanRawStr(inlinePlain(block.content));
        const rawLang = cleanStr(props.language, 40).trim();
        const language = rawLang && !/^(text|plain|plaintext)$/i.test(rawLang) ? rawLang : undefined;
        if (code.trim()) {
          const rawLines = code.split(/\r?\n/);
          const lineH = CODE_FONT_SIZE * CODE_LINE_HEIGHT;
          const overhead = language ? 72 : 48;
          const maxVisualLines = Math.max(3, Math.floor((maxItemHeight - overhead) / lineH));
          const charsPerVisualLine = Math.max(24, Math.floor((boxWidth - 56) / (CODE_FONT_SIZE * 0.64)));
          const maxSingleLineChars = Math.min(MAX_CHUNK_CHARS, charsPerVisualLine * maxVisualLines);

          let chunk: string[] = [];
          let chunkVisualLines = 0;
          let chunkChars = 0;
          const flushCode = () => {
            if (!chunk.length) return;
            const text = chunk.join("\n");
            const node: RichBlock = { type: "code_block", ...(language ? { attrs: { language } } : {}), content: [{ type: "text", text }] };
            out.push({ kind: "richBlock", block: node, height: Math.min(maxItemHeight, estimateRichBlockHeight(node, boxWidth)) });
            chunk = [];
            chunkVisualLines = 0;
            chunkChars = 0;
          };
          for (const rawLine of rawLines) {
            const subLines = splitSingleCodeLine(rawLine, maxSingleLineChars);
            for (const line of subLines) {
              const wrapped = estimateWrappedLines(line || " ", CODE_FONT_SIZE, boxWidth - 56, true);
              if (chunk.length && (chunkVisualLines + wrapped > maxVisualLines || chunkChars + line.length + 1 > MAX_CHUNK_CHARS)) {
                flushCode();
              }
              chunk.push(line);
              chunkVisualLines += wrapped;
              chunkChars += line.length + 1;
            }
          }
          flushCode();
        }
        if (children.length) out.push(...blocksToFlowItems(children, boxWidth, maxItemHeight, labels));
        break;
      }

      case "table": {
        const bands = extractTableBands(block);
        for (const extracted of bands) {
          const colCount = extracted.cols.length;
          const fontSize = colCount >= 7 ? 20 : colCount >= 5 ? 24 : 28;
          const headerRow = extracted.header ? extracted.rows[0] : null;
          const bodyRows = extracted.header ? extracted.rows.slice(1) : extracted.rows;
          const headerH = headerRow ? estimateTableRowHeight(headerRow, extracted.cols, boxWidth, fontSize) : 0;

          if (!bodyRows.length && headerRow) {
            out.push({ kind: "table", rows: [headerRow], cols: extracted.cols, header: extracted.header, fontSize, height: Math.min(maxItemHeight, Math.max(80, headerH)) });
            continue;
          }
          let batch: { cells: { text: string }[] }[] = headerRow ? [headerRow] : [];
          let batchH = headerH;
          const flushTable = () => {
            if (!batch.length) return;
            out.push({
              kind: "table",
              rows: batch,
              cols: extracted.cols,
              header: extracted.header,
              fontSize,
              height: Math.min(maxItemHeight, Math.max(84, batchH)),
            });
            batch = headerRow ? [headerRow] : [];
            batchH = headerH;
          };
          for (const row of bodyRows) {
            const rowH = estimateTableRowHeight(row, extracted.cols, boxWidth, fontSize);
            const minRows = headerRow ? 1 : 0;
            if (batch.length > minRows && (batchH + rowH > maxItemHeight || batch.length >= MAX_TABLE_ROWS)) {
              flushTable();
            }
            batch.push(row);
            batchH += rowH;
          }
          if (batch.length > (headerRow ? 1 : 0) || !bodyRows.length) flushTable();
        }
        break;
      }

      case "image": {
        const src = safeImageSrc(props.url);
        if (src) {
          const caption = cleanStr(props.caption, 500).trim();
          const alt = caption || cleanStr(props.name, 200).trim();
          const imgH = Math.min(maxItemHeight, caption ? 500 : 460);
          out.push({ kind: "image", src, alt, caption, height: imgH });
        }
        if (children.length) out.push(...blocksToFlowItems(children, boxWidth, maxItemHeight, labels));
        break;
      }

      case "file": {
        const label = fileLabel(props, labels);
        if (label) {
          const p = paragraphNode([{ type: "text", text: label, marks: [{ type: "color", attrs: { color: "muted" } }] }]);
          out.push({ kind: "richBlock", block: p, height: estimateRichBlockHeight(p, boxWidth) });
        }
        if (children.length) out.push(...blocksToFlowItems(children, boxWidth, maxItemHeight, labels));
        break;
      }

      case COLUMN_LIST: {
        const cols = children.filter((child) => child.type === COLUMN && blocksHaveVisibleContent(childrenOf(child)));
        if (cols.length >= 2 && cols.length <= 3) {
          const ratios = cols.map((col) => {
            const w = propsOf(col).width;
            return validColumnWidth(w) ? Math.min(4, Math.max(0.4, w)) : 1;
          });
          const totalRatio = ratios.reduce((sum, r) => sum + r, 0);
          const totalGutter = COLUMN_GUTTER * (cols.length - 1);
          const converted = cols.map((col, idx) => {
            const colW = Math.max(260, ((boxWidth - totalGutter) * ratios[idx]) / totalRatio);
            const items = blocksToFlowItems(childrenOf(col), colW, maxItemHeight, labels);
            const h = items.reduce((sum, item) => sum + item.height, 0) + Math.max(0, items.length - 1) * 16;
            return { widthRatio: ratios[idx], items, height: h };
          });
          const maxColH = Math.max(...converted.map((c) => c.height));
          if (maxColH <= maxItemHeight) {
            out.push({ kind: "columns", columns: converted.map(({ widthRatio, items }) => ({ widthRatio, items })), height: Math.max(120, maxColH) });
            break;
          }
        }
        // 4 段以上または 1 枚を超える段組みは左から順に平らに流して続ページで収める。
        for (const col of cols) out.push(...blocksToFlowItems(childrenOf(col), boxWidth, maxItemHeight, labels));
        break;
      }

      case COLUMN: {
        out.push(...blocksToFlowItems(children, boxWidth, maxItemHeight, labels));
        break;
      }

      case "divider": {
        out.push({ kind: "rule", height: 28 });
        break;
      }

      case "tableOfContents": {
        if (children.length) out.push(...blocksToFlowItems(children, boxWidth, maxItemHeight, labels));
        break;
      }

      default: {
        const inline = inlineToRich(block.content);
        if (richInlineHasContent(inline)) {
          const p = paragraphNode(inline, alignOf(props));
          out.push({ kind: "richBlock", block: p, height: estimateRichBlockHeight(p, boxWidth) });
        }
        if (children.length) out.push(...blocksToFlowItems(children, boxWidth, maxItemHeight, labels));
        break;
      }
    }
  }
  return out;
}

// 連続する文字・リスト・数式・コード項目を 1 つの TextElement（RichDoc）へまとめる。
function mergeRichItems(items: FlowItem[]): RichBlock[] {
  const blocks: RichBlock[] = [];
  for (const item of items) {
    if (item.kind === "richBlock") {
      blocks.push(item.block);
    } else if (item.kind === "bulletItem") {
      const prev = blocks[blocks.length - 1];
      if (prev && prev.type === "bullet_list") prev.content.push(item.item);
      else blocks.push({ type: "bullet_list", content: [item.item] });
    } else if (item.kind === "orderedItem") {
      const prev = blocks[blocks.length - 1];
      if (prev && prev.type === "ordered_list" && !item.explicitStart) prev.content.push(item.item);
      else blocks.push({ type: "ordered_list", attrs: { order: item.order }, content: [item.item] });
    }
  }
  return blocks;
}

function isRichFlowItem(item: FlowItem): boolean {
  return item.kind === "richBlock" || item.kind === "bulletItem" || item.kind === "orderedItem";
}

function makeTextElement(
  x: number, y: number, w: number, h: number, doc: RichDoc,
  stylePatch: Partial<TextStyle> = {}, role?: TextElement["role"],
): TextElement {
  return {
    id: newId(),
    type: "text",
    x: Math.round(x),
    y: Math.round(y),
    w: Math.round(w),
    h: Math.round(Math.max(40, h)),
    rotation: 0,
    ...(role ? { role } : {}),
    doc,
    style: { ...DEFAULT_TEXT_STYLE, size: BODY_FONT_SIZE, lineHeight: BODY_LINE_HEIGHT, ...stylePatch },
    fill: null,
    autoHeight: false,
  };
}

// フロー項目群を領域 (x, y, w, availH) に縦積み配置して SlideElement[] にする。
function layoutFlowItems(items: FlowItem[], x: number, startY: number, w: number, maxBottom: number, bodyRole?: TextElement["role"]): SlideElement[] {
  const elements: SlideElement[] = [];
  let y = startY;
  const gap = 18;
  let i = 0;

  while (i < items.length) {
    const remaining = Math.max(48, maxBottom - y);
    if (isRichFlowItem(items[i])) {
      const run: FlowItem[] = [];
      let runH = 0;
      while (i < items.length && isRichFlowItem(items[i])) {
        run.push(items[i]);
        runH += items[i].height;
        i++;
      }
      const blocks = mergeRichItems(run);
      const isOnlyElement = elements.length === 0 && i === items.length;
      const boxH = Math.min(remaining, Math.max(56, isOnlyElement ? Math.max(runH, remaining) : runH + 12));
      elements.push(makeTextElement(x, y, w, boxH, { type: "doc", content: blocks }, {}, isOnlyElement ? bodyRole : undefined));
      y += Math.min(remaining, runH + 12) + gap;
      continue;
    }

    const item = items[i++];
    if (item.kind === "callout") {
      const h = Math.min(remaining, Math.max(88, item.height));
      const shape: ShapeElement = {
        id: newId(),
        type: "shape",
        x: Math.round(x),
        y: Math.round(y),
        w: Math.round(w),
        h: Math.round(h),
        rotation: 0,
        shape: "roundRect",
        fill: "surface",
        stroke: "line",
        strokeWidth: 2,
        dash: "solid",
        doc: item.doc,
        style: { ...DEFAULT_TEXT_STYLE, size: CALLOUT_FONT_SIZE, lineHeight: 1.38, align: "left", valign: "middle", color: "text" },
      };
      elements.push(shape);
      y += h + gap;
    } else if (item.kind === "quote") {
      const h = Math.min(remaining, Math.max(72, item.height));
      const bar: ShapeElement = {
        id: newId(),
        type: "shape",
        x: Math.round(x),
        y: Math.round(y + 6),
        w: 8,
        h: Math.round(Math.max(40, h - 12)),
        rotation: 0,
        shape: "rect",
        fill: "accent",
        stroke: null,
        strokeWidth: 0,
        dash: "solid",
        doc: { type: "doc", content: [paragraphNode([])] },
        style: { ...DEFAULT_TEXT_STYLE },
      };
      const textEl = makeTextElement(x + 28, y, Math.max(120, w - 28), h, item.doc, {
        size: QUOTE_FONT_SIZE, italic: true, color: "muted", valign: "middle",
      });
      elements.push(bar, textEl);
      y += h + gap;
    } else if (item.kind === "table") {
      const h = Math.min(remaining, Math.max(84, item.height));
      const tableEl: TableElement = {
        id: newId(),
        type: "table",
        x: Math.round(x),
        y: Math.round(y),
        w: Math.round(w),
        h: Math.round(h),
        rotation: 0,
        rows: item.rows,
        cols: item.cols,
        header: item.header,
        style: { size: item.fontSize, color: "text", border: "line", headerFill: "surface", font: "body" },
      };
      elements.push(tableEl);
      y += h + gap;
    } else if (item.kind === "image") {
      const captionH = item.caption ? 54 : 0;
      const imgH = Math.min(remaining - captionH, Math.max(160, item.height - captionH));
      const imageEl: ImageElement = {
        id: newId(),
        type: "image",
        x: Math.round(x),
        y: Math.round(y),
        w: Math.round(w),
        h: Math.round(Math.max(120, imgH)),
        rotation: 0,
        src: item.src,
        alt: item.alt,
        fit: "contain",
        radius: 12,
      };
      elements.push(imageEl);
      y += Math.max(120, imgH);
      if (item.caption) {
        const capH = Math.min(Math.max(40, maxBottom - y), captionH);
        elements.push(makeTextElement(x, y + 6, w, capH, { type: "doc", content: [paragraphNode([{ type: "text", text: item.caption }], "center")] }, {
          size: 26, color: "muted", align: "center", valign: "top",
        }));
        y += capH + 6;
      }
      y += gap;
    } else if (item.kind === "columns") {
      const colCount = item.columns.length;
      const totalRatio = item.columns.reduce((sum, c) => sum + c.widthRatio, 0) || 1;
      const totalGutter = COLUMN_GUTTER * (colCount - 1);
      const blockH = Math.min(remaining, Math.max(120, item.height));
      const assignTwoColRoles = colCount === 2 && elements.length === 0 && i === items.length;
      let colX = x;
      item.columns.forEach((col, index) => {
        const colW = ((w - totalGutter) * col.widthRatio) / totalRatio;
        const role = assignTwoColRoles ? (index === 0 ? "body" : "body2") : undefined;
        elements.push(...layoutFlowItems(col.items, colX, y, colW, y + blockH, role));
        colX += colW + COLUMN_GUTTER;
      });
      y += blockH + gap;
    } else if (item.kind === "rule") {
      const line: LineElement = {
        id: newId(),
        type: "line",
        x: Math.round(x),
        y: Math.round(y + 12),
        w: Math.round(w),
        h: 0,
        rotation: 0,
        stroke: "line",
        strokeWidth: 2,
        dash: "solid",
        start: "none",
        end: "none",
        flipH: false,
        flipV: false,
      };
      elements.push(line);
      y += 28;
    }
  }
  return elements;
}

type SectionSpec = {
  heading: string | null;
  headingInline: RichInline[] | null;
  body: RawBlock[];
  sectionLabel?: string;
};

type HeadingLayout = {
  fontSize: number;
  titleH: number;
  bodyTop: number;
  valign: "top" | "bottom";
};

// 長い見出し（例：90 文字の CJK）が固定 136px 枠から上にはみ出して切れないよう、
// フォントサイズとタイトル枠の高さを動的に調整し、本文開始位置も連動させる。
function computeHeadingLayout(text: string, boxWidth = CONTENT_W): HeadingLayout {
  const sample = `${text} (99)`;
  const sizes = [72, 58, 48, 40, 34];
  for (const size of sizes) {
    const lines = estimateWrappedLines(sample, size, boxWidth);
    const neededH = Math.ceil(lines * size * 1.16) + 12;
    if (neededH <= TITLE_H) {
      return { fontSize: size, titleH: TITLE_H, bodyTop: BODY_TOP_WITH_TITLE, valign: lines <= 1 ? "bottom" : "top" };
    }
  }
  const fallbackSize = 34;
  const lines = estimateWrappedLines(sample, fallbackSize, boxWidth);
  const titleH = Math.min(340, Math.max(TITLE_H, Math.ceil(lines * fallbackSize * 1.16) + 16));
  const bodyTop = TITLE_Y + titleH + 20;
  return { fontSize: fallbackSize, titleH, bodyTop, valign: "top" };
}

function makeHeadingElement(title: string, inline: RichInline[] | null, pageNum: number, layout: HeadingLayout, boxWidth = CONTENT_W): TextElement {
  const suffix = pageNum > 1 ? ` (${pageNum})` : "";
  const nodes: RichInline[] = inline
    ? (suffix ? [...inline, { type: "text", text: suffix }] : inline)
    : [{ type: "text", text: `${title}${suffix}` }];
  return makeTextElement(
    MARGIN_X, TITLE_Y, boxWidth, layout.titleH,
    { type: "doc", content: [paragraphNode(nodes)] },
    { font: "heading", size: layout.fontSize, color: "heading", bold: true, lineHeight: 1.12, valign: layout.valign },
    "title",
  );
}

// 短い段落だけ（表紙のサブタイトルに使えるか）。リンク・太字・行内数式などの書式を落とさずそのまま保持する。
function extractShortSubtitle(blocks: RawBlock[]): RichBlock[] | null {
  const visible = blocks.filter(blockHasVisibleContent);
  if (!visible.length || visible.length > 2) return null;
  if (!visible.every((b) => b.type === "paragraph" && !childrenOf(b).length)) return null;
  const plain = visible.map((b) => inlinePlain(b.content).trim()).filter(Boolean).join("\n");
  if (!plain.length || plain.length > 180) return null;
  const richBlocks: RichBlock[] = [];
  for (const b of visible) {
    const inline = inlineToRich(b.content);
    if (richInlineHasContent(inline)) richBlocks.push(paragraphNode(inline, alignOf(propsOf(b)) ?? "center"));
  }
  return richBlocks.length ? richBlocks : null;
}

function makeTitleSlide(title: string, subtitle?: RichBlock[]): Slide {
  const slide = createSlide("title", { title });
  if (subtitle?.length) {
    const subEl = slide.elements.find((el): el is TextElement => el.type === "text" && el.role === "subtitle");
    if (subEl) subEl.doc = { type: "doc", content: subtitle };
  } else {
    // サブタイトルが空のときは空の置き場所を残さずすっきり見せる（編集で後から足せる）。
    slide.elements = slide.elements.filter((el) => el.role !== "subtitle");
  }
  return slide;
}

function sectionToSlides(section: SectionSpec, labels: ResolvedLabels): Slide[] {
  const visibleBody = section.body.filter(blockHasVisibleContent);

  // 本文なし + 見出しあり → 章（section）スライド。
  if (!visibleBody.length) {
    if (!section.heading) return [];
    const slide = createSlide("section", { title: section.heading });
    slide.elements = slide.elements.filter((el) => el.role !== "subtitle");
    if (section.sectionLabel !== undefined) slide.section = section.sectionLabel;
    return [slide];
  }

  // 見出しなし + 単一の短い引用（+ 任意の出典 1 段落）→ 引用（quote）レイアウト。
  if (!section.heading && visibleBody.length <= 2 && visibleBody[0].type === "quote" && !childrenOf(visibleBody[0]).length) {
    const second = visibleBody[1];
    if (!second || (second.type === "paragraph" && !childrenOf(second).length && inlinePlain(second.content).trim().length <= 100)) {
      const quoteText = inlinePlain(visibleBody[0].content).trim();
      if (quoteText.length > 0 && quoteText.length <= 260) {
        const attribution = second ? inlinePlain(second.content).trim() : "";
        const slide = createSlide("quote", { quote: quoteText, ...(attribution ? { attribution } : {}) });
        if (!attribution) slide.elements = slide.elements.filter((el) => el.role !== "attribution");
        if (section.sectionLabel !== undefined) slide.section = section.sectionLabel;
        return [slide];
      }
    }
  }

  const headingLayout = section.heading ? computeHeadingLayout(section.heading, CONTENT_W) : null;

  // 画像 1 枚 + テキスト少量 → 図と文（または中央に大きな画像）。
  const validImages = visibleBody.filter((b) => b.type === "image" && Boolean(safeImageSrc(propsOf(b).url)));
  if (validImages.length === 1 && !visibleBody.some((b) => b.type === "table" || b.type === COLUMN_LIST || b.type === "codeBlock")) {
    const imgBlock = validImages[0];
    const imgProps = propsOf(imgBlock);
    const src = safeImageSrc(imgProps.url);
    const caption = cleanStr(imgProps.caption, 500).trim();
    const alt = caption || cleanStr(imgProps.name, 200).trim();
    const others = visibleBody.filter((b) => b !== imgBlock);
    if (!others.length && !childrenOf(imgBlock).length) {
      const elements: SlideElement[] = [];
      if (section.heading && headingLayout) elements.push(makeHeadingElement(section.heading, section.headingInline, 1, headingLayout));
      const topY = headingLayout ? headingLayout.bodyTop : 84;
      const capH = caption ? 56 : 0;
      const imgH = Math.max(240, BODY_BOTTOM - topY - capH);
      elements.push({
        id: newId(), type: "image", x: MARGIN_X, y: topY, w: CONTENT_W, h: imgH, rotation: 0, role: "image",
        src, alt, fit: "contain", radius: 12,
      });
      if (caption) {
        elements.push(makeTextElement(MARGIN_X, topY + imgH + 8, CONTENT_W, capH - 8, { type: "doc", content: [paragraphNode([{ type: "text", text: caption }], "center")] }, {
          size: 26, color: "muted", align: "center", valign: "top",
        }, "caption"));
      }
      const slide: Slide = { id: newId(), layout: section.heading ? "blank" : "fullImage", elements };
      if (section.sectionLabel !== undefined) slide.section = section.sectionLabel;
      return [slide];
    }
    if (!childrenOf(imgBlock).length) {
      const leftW = 820;
      const leftHeadingLayout = section.heading ? computeHeadingLayout(section.heading, leftW) : null;
      const leftTop = leftHeadingLayout ? leftHeadingLayout.bodyTop : 112;
      const leftAvail = Math.max(360, BODY_BOTTOM - leftTop);
      const leftItems = blocksToFlowItems(others, leftW, leftAvail, labels);
      const leftH = leftItems.reduce((sum, item) => sum + item.height, 0) + Math.max(0, leftItems.length - 1) * 18;
      if (leftItems.length && leftH <= leftAvail) {
        const elements: SlideElement[] = [];
        if (section.heading && leftHeadingLayout) {
          elements.push(makeHeadingElement(section.heading, section.headingInline, 1, leftHeadingLayout, leftW));
        }
        elements.push(...layoutFlowItems(leftItems, MARGIN_X, leftTop, leftW, BODY_BOTTOM, "body"));
        const imgX = MARGIN_X + leftW + 60;
        const imgW = SLIDE_WIDTH - MARGIN_X - imgX;
        const capH = caption ? 56 : 0;
        const imgY = 104;
        const imgH = BODY_BOTTOM - imgY - capH;
        elements.push({
          id: newId(), type: "image", x: imgX, y: imgY, w: imgW, h: imgH, rotation: 0, role: "image",
          src, alt, fit: "contain", radius: 12,
        });
        if (caption) {
          elements.push(makeTextElement(imgX, imgY + imgH + 8, imgW, capH - 8, { type: "doc", content: [paragraphNode([{ type: "text", text: caption }], "center")] }, {
            size: 24, color: "muted", align: "center", valign: "top",
          }, "caption"));
        }
        const slide: Slide = { id: newId(), layout: "imageText", elements };
        if (section.sectionLabel !== undefined) slide.section = section.sectionLabel;
        return [slide];
      }
    }
  }

  const bodyTop = headingLayout ? headingLayout.bodyTop : BODY_TOP_NO_TITLE;
  const availH = Math.max(360, BODY_BOTTOM - bodyTop);
  const items = blocksToFlowItems(visibleBody, CONTENT_W, availH, labels);
  if (!items.length) {
    if (!section.heading) return [];
    const slide = createSlide("section", { title: section.heading });
    slide.elements = slide.elements.filter((el) => el.role !== "subtitle");
    if (section.sectionLabel !== undefined) slide.section = section.sectionLabel;
    return [slide];
  }

  // 安全高さ（availH）に収まる単位で複数枚へ自動分割する。
  const pages: FlowItem[][] = [];
  let current: FlowItem[] = [];
  let usedH = 0;
  for (const item of items) {
    const gap = current.length ? (isRichFlowItem(item) && isRichFlowItem(current[current.length - 1]) ? 4 : 18) : 0;
    if (current.length && usedH + gap + item.height > availH) {
      pages.push(current);
      current = [item];
      usedH = item.height;
    } else {
      current.push(item);
      usedH += gap + item.height;
    }
  }
  if (current.length) pages.push(current);

  return pages.map((pageItems, pageIndex) => {
    const elements: SlideElement[] = [];
    if (section.heading && headingLayout) elements.push(makeHeadingElement(section.heading, section.headingInline, pageIndex + 1, headingLayout));
    const singleTwoCol = pageItems.length === 1 && pageItems[0].kind === "columns" && pageItems[0].columns.length === 2;
    const allRich = pageItems.every(isRichFlowItem);
    const bodyElements = layoutFlowItems(pageItems, MARGIN_X, bodyTop, CONTENT_W, BODY_BOTTOM, allRich ? "body" : undefined);
    elements.push(...bodyElements);
    const layout = singleTwoCol ? "twoColumn" : (section.heading && allRich ? "bullets" : "blank");
    const slide: Slide = { id: newId(), layout, elements };
    if (pageIndex === 0 && section.sectionLabel !== undefined) slide.section = section.sectionLabel;
    return slide;
  });
}

function splitLeadingHeading(blocks: RawBlock[]): { heading: string | null; headingInline: RichInline[] | null; rest: RawBlock[] } {
  const firstVisibleIdx = blocks.findIndex(blockHasVisibleContent);
  if (firstVisibleIdx < 0) return { heading: null, headingInline: null, rest: [] };
  const first = blocks[firstVisibleIdx];
  if (first.type === "heading") {
    const text = inlinePlain(first.content).trim();
    if (text) {
      const inline = inlineToRich(first.content);
      const rest = [...childrenOf(first), ...blocks.slice(firstVisibleIdx + 1)];
      return { heading: text, headingInline: inline.length ? inline : null, rest };
    }
  }
  return { heading: null, headingInline: null, rest: blocks.slice(firstVisibleIdx) };
}

function sameTitle(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function noteToDeckResult({ title, blocks, theme, untitledLabel, labels }: NoteToDeckInput): NoteToDeckResult {
  const resolvedLabels: ResolvedLabels = {
    untitled: cleanStr(labels?.untitled ?? untitledLabel, 200).trim() || "Untitled",
    file: cleanStr(labels?.file, 60).trim() || "File",
    image: cleanStr(labels?.image, 60).trim() || "Image",
  };
  const cleanTitle = cleanStr(title, 200).trim();
  const hasTitle = cleanTitle.length > 0 && cleanTitle !== "Untitled";
  const fallbackTitle = hasTitle ? cleanTitle : resolvedLabels.untitled;
  const topBlocks = asBlocks(blocks);
  const deckTheme: DeckTheme = theme ?? DEFAULT_THEME;

  const slides: Slide[] = [];
  const hasDivider = topBlocks.some((block) => block.type === "divider");

  if (hasDivider) {
    // 規則 1: divider で分割（連続・先頭・末尾の空チャンクは飛ばす）。
    const chunks: RawBlock[][] = [];
    let current: RawBlock[] = [];
    for (const block of topBlocks) {
      if (block.type === "divider") {
        if (blocksHaveVisibleContent(current)) chunks.push(current);
        current = [];
      } else {
        current.push(block);
      }
    }
    if (blocksHaveVisibleContent(current)) chunks.push(current);

    if (!chunks.length) {
      slides.push(makeTitleSlide(fallbackTitle));
    } else {
      chunks.forEach((chunk, index) => {
        const { heading, headingInline, rest } = splitLeadingHeading(chunk);
        if (index === 0 && hasTitle) {
          if (heading && sameTitle(heading, cleanTitle)) {
            const sub = extractShortSubtitle(rest);
            if (!blocksHaveVisibleContent(rest) || sub) {
              slides.push(makeTitleSlide(heading, sub ?? undefined));
              return;
            }
            slides.push(...sectionToSlides({ heading, headingInline, body: rest }, resolvedLabels));
            return;
          }
          if (heading) {
            slides.push(makeTitleSlide(cleanTitle));
            slides.push(...sectionToSlides({ heading, headingInline, body: rest, sectionLabel: heading }, resolvedLabels));
            return;
          }
          const sub = extractShortSubtitle(rest);
          if (sub) {
            slides.push(makeTitleSlide(cleanTitle, sub));
            return;
          }
          slides.push(...sectionToSlides({ heading: cleanTitle, headingInline: null, body: rest }, resolvedLabels));
          return;
        }
        slides.push(...sectionToSlides({ heading, headingInline, body: rest, sectionLabel: index > 0 && heading ? heading : undefined }, resolvedLabels));
      });
    }
  } else {
    // 規則 2: divider が無ければ最上位の H1 見出しで分割。
    const hasH1 = topBlocks.some((block) => block.type === "heading" && Number(propsOf(block).level ?? 1) === 1 && inlinePlain(block.content).trim().length > 0);
    if (hasH1) {
      const intro: RawBlock[] = [];
      const h1Sections: { heading: string; headingInline: RichInline[] | null; body: RawBlock[] }[] = [];
      let currentSection: { heading: string; headingInline: RichInline[] | null; body: RawBlock[] } | null = null;
      for (const block of topBlocks) {
        const isH1 = block.type === "heading" && Number(propsOf(block).level ?? 1) === 1 && inlinePlain(block.content).trim().length > 0;
        if (isH1) {
          const text = inlinePlain(block.content).trim();
          const inline = inlineToRich(block.content);
          currentSection = { heading: text, headingInline: inline.length ? inline : null, body: [...childrenOf(block)] };
          h1Sections.push(currentSection);
        } else if (currentSection) {
          currentSection.body.push(block);
        } else {
          intro.push(block);
        }
      }

      const hasIntro = blocksHaveVisibleContent(intro);
      if (hasIntro) {
        if (hasTitle) {
          const sub = extractShortSubtitle(intro);
          if (sub) slides.push(makeTitleSlide(cleanTitle, sub));
          else slides.push(...sectionToSlides({ heading: cleanTitle, headingInline: null, body: intro }, resolvedLabels));
        } else {
          const { heading, headingInline, rest } = splitLeadingHeading(intro);
          slides.push(...sectionToSlides({ heading, headingInline, body: rest }, resolvedLabels));
        }
        h1Sections.forEach((sec) => {
          slides.push(...sectionToSlides({ heading: sec.heading, headingInline: sec.headingInline, body: sec.body, sectionLabel: sec.heading }, resolvedLabels));
        });
      } else {
        // 先頭がすでに H1 のとき：空のスライドを挟まない。
        const first = h1Sections[0];
        if (hasTitle && !sameTitle(first.heading, cleanTitle)) {
          slides.push(makeTitleSlide(cleanTitle));
          h1Sections.forEach((sec) => {
            slides.push(...sectionToSlides({ heading: sec.heading, headingInline: sec.headingInline, body: sec.body, sectionLabel: sec.heading }, resolvedLabels));
          });
        } else {
          const firstSub = extractShortSubtitle(first.body);
          if (!blocksHaveVisibleContent(first.body) || firstSub) {
            slides.push(makeTitleSlide(first.heading, firstSub ?? undefined));
          } else {
            slides.push(...sectionToSlides({ heading: first.heading, headingInline: first.headingInline, body: first.body }, resolvedLabels));
          }
          h1Sections.slice(1).forEach((sec) => {
            slides.push(...sectionToSlides({ heading: sec.heading, headingInline: sec.headingInline, body: sec.body, sectionLabel: sec.heading }, resolvedLabels));
          });
        }
      }
    } else {
      // 規則 3: divider も H1 も無いノート。表紙 + 本文スライド。
      if (!blocksHaveVisibleContent(topBlocks)) {
        slides.push(makeTitleSlide(fallbackTitle));
      } else if (hasTitle) {
        const sub = extractShortSubtitle(topBlocks);
        if (sub) {
          slides.push(makeTitleSlide(cleanTitle, sub));
        } else {
          slides.push(makeTitleSlide(cleanTitle));
          const { heading, headingInline, rest } = splitLeadingHeading(topBlocks);
          slides.push(...sectionToSlides({ heading, headingInline, body: rest }, resolvedLabels));
        }
      } else {
        const { heading, headingInline, rest } = splitLeadingHeading(topBlocks);
        slides.push(...sectionToSlides({ heading, headingInline, body: rest }, resolvedLabels));
      }
    }
  }

  const allSlides = slides.length ? slides : [makeTitleSlide(fallbackTitle)];
  const totalSlides = allSlides.length;
  const bounded = allSlides.slice(0, MAX_SLIDES);
  const deck = normalizeDeck({ format: 1, theme: deckTheme, slides: bounded });
  return { deck, totalSlides, truncatedSlides: Math.max(0, totalSlides - deck.slides.length) };
}

export function noteToDeck(input: NoteToDeckInput): Deck {
  return noteToDeckResult(input).deck;
}
