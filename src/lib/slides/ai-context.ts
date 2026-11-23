import { slideRows, type Deck } from "@/lib/slides/model";
import { richDocText } from "@/lib/slides/rich-text";

// スライドの AI（#150）のための接続点。エディターは選んでいる枚・要素を window のイベントで知らせ、
// AI の面板（#158 の共通の面板）はそれを読んで文脈にする。エディターへの操作（検索の一致へ移る・放映・書き出し）も同じくイベントで渡す。
export const SLIDES_EVENTS = {
  // detail: SlidesSelectionDetail。選んでいる枚・要素が変わるたびに出す。
  selection: "notefable:slides-selection",
  // detail: 枚の ID。検索の一致（blockId）からその枚を開く（search-reveal.ts）。
  reveal: "notefable:reveal-canvas-item",
  // detail: { action: "present" | "end" | "next" | "previous" | "goto" | "export", format?, index? }。アプリの「…」メニュー・戻るボタンから。
  command: "notefable:slides-command",
} as const;

export type SlidesSelectionDetail = { pageId: string; slideIds: string[]; elementIds: string[] };

// 選んでいる枚・要素を、AI に渡す読みやすい文字にする（枚の番号・章・文字・ノート）。
export function slidesContextText(deck: Deck, selection: Pick<SlidesSelectionDetail, "slideIds" | "elementIds">): string {
  const rows = slideRows(deck.slides);
  const sectionOf = new Map<string, string>();
  rows.forEach((row, index) => row.slides.forEach((slide) => sectionOf.set(slide.id, row.title || `Section ${index + 1}`)));
  const lines: string[] = [];
  deck.slides.forEach((slide, index) => {
    if (!selection.slideIds.includes(slide.id)) return;
    const elements = selection.elementIds.length ? slide.elements.filter((element) => selection.elementIds.includes(element.id)) : slide.elements;
    const texts = elements.map((element) => (element.type === "text" || element.type === "shape" ? richDocText(element.doc)
      : element.type === "table" ? element.rows.map((row) => row.cells.map((cell) => cell.text).join(" | ")).join("\n")
      : element.type === "image" ? `[Image: ${element.alt || "image"}]` : "")).filter((text) => text.trim());
    lines.push(`Slide ${index + 1} (${slide.layout}, ${sectionOf.get(slide.id)})${slide.hidden ? " [hidden]" : ""}:`, ...texts.map((text) => `- ${text.replace(/\n/g, " / ")}`));
    if (slide.notes) lines.push(`  Notes: ${slide.notes}`);
  });
  return lines.join("\n");
}
