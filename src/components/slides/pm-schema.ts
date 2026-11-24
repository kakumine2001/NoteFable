import { Schema, type DOMOutputSpec, type Mark, type Node as PMNode } from "@tiptap/pm/model";
import { isColorRef } from "@/lib/slides/model";
import { safeHref } from "@/lib/slides/rich-text";

// スライドの文字枠の ProseMirror のスキーマ。JSON の形は src/lib/slides/rich-text.ts と同じ（normalizeRichDoc を通った JSON をそのまま読める）。
// 色は主題の色名なら CSS 変数（スライドの面が --slide-color-<名前> を持つ）、#rrggbb ならそのまま。

export function colorCss(value: unknown): string | null {
  if (!isColorRef(value)) return null;
  return value.startsWith("#") ? value : `var(--slide-color-${value})`;
}

export const slideSchema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      group: "block", content: "inline*", attrs: { align: { default: null } },
      parseDOM: [{ tag: "p", getAttrs: (dom) => {
        const align = (dom as HTMLElement).style.textAlign;
        return { align: ["left", "center", "right", "justify"].includes(align) ? align : null };
      } }],
      toDOM: (node): DOMOutputSpec => ["p", node.attrs.align ? { style: `text-align:${node.attrs.align}` } : {}, 0],
    },
    bullet_list: { group: "block", content: "list_item+", parseDOM: [{ tag: "ul" }], toDOM: (): DOMOutputSpec => ["ul", 0] },
    ordered_list: {
      group: "block", content: "list_item+", attrs: { order: { default: 1 } },
      parseDOM: [{ tag: "ol", getAttrs: (dom) => {
        const start = Number((dom as HTMLElement).getAttribute("start"));
        return { order: Number.isSafeInteger(start) && start >= 0 ? start : 1 };
      } }],
      toDOM: (node): DOMOutputSpec => ["ol", node.attrs.order === 1 ? {} : { start: node.attrs.order }, 0],
    },
    list_item: { content: "paragraph block*", defining: true, parseDOM: [{ tag: "li" }], toDOM: (): DOMOutputSpec => ["li", 0] },
    code_block: {
      group: "block", content: "text*", marks: "", code: true, defining: true, attrs: { language: { default: null } },
      parseDOM: [{ tag: "pre", preserveWhitespace: "full", getAttrs: (dom) => ({ language: (dom as HTMLElement).getAttribute("data-language") || null }) }],
      toDOM: (node): DOMOutputSpec => ["pre", { class: "slide-code-block", dir: "ltr", ...(node.attrs.language ? { "data-language": node.attrs.language } : {}) }, ["code", 0]],
    },
    math_block: {
      group: "block", atom: true, attrs: { latex: { default: "" } },
      parseDOM: [{ tag: "div[data-math-block]", getAttrs: (dom) => ({ latex: (dom as HTMLElement).getAttribute("data-latex") ?? "" }) }],
      toDOM: (node): DOMOutputSpec => ["div", { "data-math-block": "", "data-latex": node.attrs.latex }],
    },
    text: { group: "inline" },
    hard_break: { inline: true, group: "inline", selectable: false, parseDOM: [{ tag: "br" }], toDOM: (): DOMOutputSpec => ["br"] },
    math_inline: {
      inline: true, group: "inline", atom: true, attrs: { latex: { default: "" } },
      parseDOM: [{ tag: "span[data-math-inline]", getAttrs: (dom) => ({ latex: (dom as HTMLElement).getAttribute("data-latex") ?? "" }) }],
      toDOM: (node): DOMOutputSpec => ["span", { "data-math-inline": "", "data-latex": node.attrs.latex }],
    },
  },
  marks: {
    strong: {
      parseDOM: [{ tag: "strong" }, { tag: "b", getAttrs: (dom) => (dom as HTMLElement).style.fontWeight !== "normal" && null }, { style: "font-weight", getAttrs: (value) => /^(bold(er)?|[6-9]\d{2})$/.test(value as string) && null }],
      toDOM: (): DOMOutputSpec => ["strong", 0],
    },
    em: { parseDOM: [{ tag: "i" }, { tag: "em" }, { style: "font-style=italic" }], toDOM: (): DOMOutputSpec => ["em", 0] },
    underline: { parseDOM: [{ tag: "u" }, { style: "text-decoration=underline" }], toDOM: (): DOMOutputSpec => ["u", 0] },
    strike: { parseDOM: [{ tag: "s" }, { tag: "del" }, { tag: "strike" }, { style: "text-decoration=line-through" }], toDOM: (): DOMOutputSpec => ["s", 0] },
    code: { parseDOM: [{ tag: "code" }], toDOM: (): DOMOutputSpec => ["code", { class: "slide-code" }, 0] },
    link: {
      attrs: { href: {} }, inclusive: false,
      parseDOM: [{ tag: "a[href]", getAttrs: (dom) => {
        const href = safeHref((dom as HTMLElement).getAttribute("href"));
        return href ? { href } : false;
      } }],
      toDOM: (mark: Mark): DOMOutputSpec => ["a", { href: mark.attrs.href, class: "slide-link", rel: "noopener noreferrer nofollow" }, 0],
    },
    color: {
      attrs: { color: {} },
      toDOM: (mark: Mark): DOMOutputSpec => ["span", { style: `color:${colorCss(mark.attrs.color) ?? "inherit"}` }, 0],
    },
    size: {
      attrs: { size: {} },
      toDOM: (mark: Mark): DOMOutputSpec => ["span", { style: `font-size:${Number(mark.attrs.size) || 40}px` }, 0],
    },
  },
});

export type SlideNode = PMNode;
