import { isSelectionId, MAX_SELECTION_IDS } from "@/lib/page-ai/types";
import { layoutDefinition } from "@/lib/slides/layouts";
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

export type SlidesContextTranslate = (key: string, vars?: Record<string, string | number>) => string;

export type SlidesContextOptions = {
  // 明示的に指定しない限り、枚全体を選んだとき（elementIds が空）だけ演説者ノートを添える。
  // 個別の要素だけを選んだときは、その要素の文脈だけに絞る。
  includeNotes?: boolean;
  // 画面の引用チップにも出すため、UI 翻訳関数を渡すと「スライド」「セクション」「レイアウト名」「発表者ノート」を現在の言語で組み立てる。
  t?: SlidesContextTranslate;
};

// 選んでいる枚・要素を、AI と引用チップに渡す読みやすい文字にする（枚の番号・章・文字・必要なときだけノート）。
export function slidesContextText(
  deck: Deck,
  selection: Pick<SlidesSelectionDetail, "slideIds" | "elementIds">,
  options?: SlidesContextOptions,
): string {
  const translate = options?.t;
  const rows = slideRows(deck.slides);
  const sectionOf = new Map<string, string>();
  rows.forEach((row, index) => row.slides.forEach((slide) => sectionOf.set(
    slide.id,
    row.title || (translate ? translate("Section {number}", { number: index + 1 }) : `Section ${index + 1}`),
  )));
  const includeNotes = options?.includeNotes ?? selection.elementIds.length === 0;
  const lines: string[] = [];
  deck.slides.forEach((slide, index) => {
    if (!selection.slideIds.includes(slide.id)) return;
    const elements = selection.elementIds.length ? slide.elements.filter((element) => selection.elementIds.includes(element.id)) : slide.elements;
    const texts = elements
      .map((element) => (element.type === "text" || element.type === "shape" ? richDocText(element.doc)
        : element.type === "table" ? element.rows.map((row) => row.cells.map((cell) => cell.text).join(" | ")).join("\n")
        : element.type === "image" ? `[${translate ? translate("Image") : "Image"}: ${element.alt || (translate ? translate("Image") : "image")}]`
        : element.type === "whiteboard" ? `[${translate ? translate("Whiteboard frame") : "Whiteboard frame"}: ${element.frameName || (translate ? translate("Whiteboard") : "whiteboard")}]`
        : ""))
      .filter((text) => text.trim());
    const slideLabel = translate ? translate("Slide {number}", { number: index + 1 }) : `Slide ${index + 1}`;
    const layoutLabel = translate ? translate(layoutDefinition(slide.layout).name) : slide.layout;
    const hiddenSuffix = slide.hidden ? ` [${translate ? translate("Hidden in presentation") : "hidden"}]` : "";
    lines.push(`${slideLabel} (${layoutLabel}, ${sectionOf.get(slide.id)})${hiddenSuffix}:`, ...texts.map((text) => `- ${text.replace(/\n/g, " / ")}`));
    if (includeNotes && slide.notes?.trim()) {
      const notesLabel = translate ? translate("Speaker notes") : "Notes";
      lines.push(`  ${notesLabel}: ${slide.notes.trim()}`);
    }
  });
  return lines.join("\n");
}

// read_note と揃う ID 一覧（要素を選んでいればその要素 ID、枚全体ならそのスライド ID）。サーバーの上限・形式に合わせる。
export function slidesSelectionIds(deck: Deck, selection: Pick<SlidesSelectionDetail, "slideIds" | "elementIds">): string[] {
  const selectedSlides = deck.slides.filter((slide) => selection.slideIds.includes(slide.id));
  const raw = selection.elementIds.length
    ? selectedSlides.flatMap((slide) => slide.elements.filter((element) => selection.elementIds.includes(element.id)).map((element) => element.id))
    : selectedSlides.map((slide) => slide.id);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of raw) {
    if (isSelectionId(id) && !seen.has(id)) {
      seen.add(id);
      out.push(id);
      if (out.length >= MAX_SELECTION_IDS) break;
    }
  }
  return out;
}
