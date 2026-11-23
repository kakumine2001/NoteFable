// スライドの文字枠・図形の中の書式つき文字（ProseMirror の JSON）。編集は src/components/slides/text-editor.tsx、
// 表示は src/components/slides/slide-render.tsx。このファイルは JSON の形と検証だけを持つ（ProseMirror を読み込まない。サーバーでも使う）。
//
// ブロック: paragraph（attrs.align）、bullet_list / ordered_list（attrs.order）→ list_item（先頭は paragraph）、code_block（文字だけ）、math_block（attrs.latex）
// 行内:     text（marks）、hard_break、math_inline（attrs.latex）
// 書式:     strong、em、underline、strike、code、link（attrs.href：http / https / mailto / tel）、color（attrs.color：主題の色名か #rrggbb）、size（attrs.size：論理 px）

export type RichMark =
  | { type: "strong" | "em" | "underline" | "strike" | "code" }
  | { type: "link"; attrs: { href: string } }
  | { type: "color"; attrs: { color: string } }
  | { type: "size"; attrs: { size: number } };
export type RichInline =
  | { type: "text"; text: string; marks?: RichMark[] }
  | { type: "hard_break" }
  | { type: "math_inline"; attrs: { latex: string } };
export type RichParagraph = { type: "paragraph"; attrs?: { align: string | null }; content?: RichInline[] };
export type RichListItem = { type: "list_item"; content: RichBlock[] };
export type RichBlock =
  | RichParagraph
  | { type: "bullet_list"; content: RichListItem[] }
  | { type: "ordered_list"; attrs?: { order: number }; content: RichListItem[] }
  | { type: "code_block"; content?: { type: "text"; text: string }[] }
  | { type: "math_block"; attrs: { latex: string } };
export type RichDoc = { type: "doc"; content: RichBlock[] };

export const MAX_MATH_LATEX = 10_000;
const MAX_TEXT = 20_000;
const MAX_DEPTH = 6;
const ALIGNS = ["left", "center", "right", "justify"];
const SIMPLE_MARKS = ["strong", "em", "underline", "strike", "code"];
const COLOR = /^#[0-9a-f]{6}$/i;
const COLOR_NAMES = ["background", "surface", "text", "muted", "heading", "accent", "accent2", "accent3", "line"];

const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

// リンク先は http / https / mailto / tel だけ（javascript: などは落とす）。
export function safeHref(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const href = value.trim();
  if (!href || href.length > 2000) return null;
  if (/^(https?:\/\/|mailto:|tel:)/i.test(href)) return href;
  return null;
}

function normalizeMarks(value: unknown): RichMark[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const marks: RichMark[] = [];
  const seen = new Set<string>();
  for (const mark of value) {
    if (!object(mark) || typeof mark.type !== "string" || seen.has(mark.type)) continue;
    const attrs = object(mark.attrs) ? mark.attrs : {};
    if (SIMPLE_MARKS.includes(mark.type)) marks.push({ type: mark.type as "strong" });
    else if (mark.type === "link") { const href = safeHref(attrs.href); if (href) marks.push({ type: "link", attrs: { href } }); else continue; }
    else if (mark.type === "color") { if (typeof attrs.color === "string" && (COLOR.test(attrs.color) || COLOR_NAMES.includes(attrs.color))) marks.push({ type: "color", attrs: { color: attrs.color } }); else continue; }
    else if (mark.type === "size") { if (typeof attrs.size === "number" && Number.isFinite(attrs.size)) marks.push({ type: "size", attrs: { size: Math.min(800, Math.max(4, attrs.size)) } }); else continue; }
    else continue;
    seen.add(mark.type);
  }
  return marks.length ? marks : undefined;
}

const cleanText = (value: string) => value.replace(/\u0000/g, "").slice(0, MAX_TEXT);
const latexOf = (attrs: unknown) => (object(attrs) && typeof attrs.latex === "string" ? cleanText(attrs.latex).slice(0, MAX_MATH_LATEX) : "");

function normalizeInline(value: unknown, out: RichInline[]) {
  if (!Array.isArray(value)) return;
  for (const node of value) {
    if (!object(node)) continue;
    if (node.type === "text" && typeof node.text === "string" && cleanText(node.text)) {
      // 空の文字のノードは ProseMirror が読めない（NUL だけの文字は消すと空になる）。
      const marks = normalizeMarks(node.marks);
      out.push(marks ? { type: "text", text: cleanText(node.text), marks } : { type: "text", text: cleanText(node.text) });
    } else if (node.type === "hard_break") out.push({ type: "hard_break" });
    else if (node.type === "math_inline") out.push({ type: "math_inline", attrs: { latex: latexOf(node.attrs) } });
  }
}

function paragraph(content: RichInline[], align: string | null = null): RichParagraph {
  return content.length ? { type: "paragraph", attrs: { align }, content } : { type: "paragraph", attrs: { align } };
}

function normalizeBlocks(value: unknown, depth: number): RichBlock[] {
  const blocks: RichBlock[] = [];
  if (!Array.isArray(value)) return blocks;
  for (const node of value) {
    if (!object(node)) continue;
    if (node.type === "paragraph") {
      const content: RichInline[] = [];
      normalizeInline(node.content, content);
      const align = object(node.attrs) && typeof node.attrs.align === "string" && ALIGNS.includes(node.attrs.align) ? node.attrs.align : null;
      blocks.push(paragraph(content, align));
    } else if ((node.type === "bullet_list" || node.type === "ordered_list") && depth < MAX_DEPTH) {
      const items: RichListItem[] = [];
      for (const item of Array.isArray(node.content) ? node.content : []) {
        if (!object(item) || item.type !== "list_item") continue;
        const content = normalizeBlocks(item.content, depth + 1);
        // 項目の先頭は段落（ProseMirror の list_item: paragraph block*）。
        if (!content.length || content[0].type !== "paragraph") content.unshift(paragraph([]));
        items.push({ type: "list_item", content });
      }
      if (!items.length) continue;
      if (node.type === "bullet_list") blocks.push({ type: "bullet_list", content: items });
      else {
        const order = object(node.attrs) && typeof node.attrs.order === "number" && Number.isSafeInteger(node.attrs.order) ? Math.min(9999, Math.max(0, node.attrs.order)) : 1;
        blocks.push({ type: "ordered_list", attrs: { order }, content: items });
      }
    } else if (node.type === "code_block") {
      const text = cleanText((Array.isArray(node.content) ? node.content : []).map((child) => (object(child) && typeof child.text === "string" ? child.text : "")).join(""));
      blocks.push(text ? { type: "code_block", content: [{ type: "text", text }] } : { type: "code_block" });
    } else if (node.type === "math_block") {
      blocks.push({ type: "math_block", attrs: { latex: latexOf(node.attrs) } });
    } else if (Array.isArray(node.content)) {
      // 知らない入れ物の中の文字は段落として残す。
      blocks.push(...normalizeBlocks(node.content, depth + 1));
    }
  }
  return blocks;
}

// 保存された JSON を、編集・表示で使える形にする（知らないノード・書式は落とす）。空なら空の段落 1 つ。
export function normalizeRichDoc(value: unknown): RichDoc {
  const content = object(value) && value.type === "doc" ? normalizeBlocks(value.content, 0) : [];
  return { type: "doc", content: content.length ? content : [paragraph([])] };
}

// 改行ごとに段落にした文書。
export function richDocFromText(text: string, align: string | null = null): RichDoc {
  const lines = text.split(/\r?\n/);
  return { type: "doc", content: lines.map((line) => paragraph(line ? [{ type: "text", text: line }] : [], align)) };
}

// 箇条書き 1 つの文書（行ごとに 1 項目）。
export function richBulletsFromText(text: string): RichDoc {
  const lines = text.split(/\r?\n/);
  return { type: "doc", content: [{ type: "bullet_list", content: lines.map((line) => ({ type: "list_item", content: [paragraph(line ? [{ type: "text", text: line }] : [])] })) }] };
}

function inlineText(content: RichInline[] | undefined) {
  return (content ?? []).map((node) => (node.type === "text" ? node.text : node.type === "hard_break" ? "\n" : `$${node.attrs.latex}$`)).join("");
}

// プレーンテキスト（段落・項目ごとに改行）。数式は $…$ で表す。
export function richDocText(doc: RichDoc): string {
  const lines: string[] = [];
  const walk = (blocks: RichBlock[]) => {
    for (const block of blocks) {
      if (block.type === "paragraph") lines.push(inlineText(block.content));
      else if (block.type === "code_block") lines.push(block.content?.[0]?.text ?? "");
      else if (block.type === "math_block") lines.push(`$$${block.attrs.latex}$$`);
      else for (const item of block.content) walk(item.content);
    }
  };
  walk(doc.content);
  return lines.join("\n");
}

export function isRichDocEmpty(doc: RichDoc): boolean {
  return richDocText(doc).trim() === "";
}

// 数式の描画結果を引くときの鍵（行内とブロックで描き方が違う）。
export const mathKey = (latex: string, display: boolean) => `${display ? "d" : "i"}:${latex}`;

// 文書の中の数式の鍵（公開ページでサーバーが先に描いておく）。
export function richDocLatex(doc: RichDoc, out: Set<string> = new Set()): Set<string> {
  const walk = (blocks: RichBlock[]) => {
    for (const block of blocks) {
      if (block.type === "paragraph") for (const node of block.content ?? []) { if (node.type === "math_inline" && node.attrs.latex.trim()) out.add(mathKey(node.attrs.latex, false)); }
      else if (block.type === "math_block") { if (block.attrs.latex.trim()) out.add(mathKey(block.attrs.latex, true)); }
      else if (block.type === "bullet_list" || block.type === "ordered_list") for (const item of block.content) walk(item.content);
    }
  };
  walk(doc.content);
  return out;
}
