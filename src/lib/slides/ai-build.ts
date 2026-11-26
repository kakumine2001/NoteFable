import { prepareNoteMarkdown } from "@/lib/answer-export";
import { MAX_SLIDE_NOTES, MAX_SLIDES } from "@/lib/canvas-document";
import { markdownToBlocks } from "@/lib/note-markdown";
import { cleanText, oneLine } from "@/lib/slides/ai-wizard";
import { createSlide } from "@/lib/slides/layouts";
import { DECK_FORMAT, normalizeDeck, type Deck, type DeckTheme, type Slide } from "@/lib/slides/model";
import { blocksHaveVisibleContent, noteToDeckResult } from "@/lib/slides/note-to-deck";

// AI が書いた各スライド（題名・Markdown の本文・演説者ノート）から、保存する Deck を作る純粋な関数。
// 版式・文字の大きさ・続きのページは「ノートを放映」と同じ noteToDeckResult に任せる（モデルは座標を出さない）。

export type AiDeckSlide = { title: string; body: string; notes: string };
export type AiDeckInput = { title: string; slides: readonly AiDeckSlide[]; theme: DeckTheme; untitledLabel?: string };

type Block = ReturnType<typeof markdownToBlocks>[number];

// 画像・区切り線・目次はスライドに使わない（子は残す）。本文の「# 」は小見出しにする（枚の題名より大きくしない）。
function bodyBlocks(blocks: Block[]): Block[] {
  return blocks.flatMap((block) => {
    const children = bodyBlocks(block.children);
    if (block.type === "image" || block.type === "divider" || block.type === "tableOfContents") return children;
    const props = block.type === "heading" && block.props.level === 1 ? { ...block.props, level: 3 } : block.props;
    return [{ ...block, props, children }];
  });
}

function clipNotes(notes: string) {
  const text = cleanText(notes).trim().slice(0, MAX_SLIDE_NOTES);
  // サロゲートペアの途中で切れた前半は落とす。
  return (text.charCodeAt(text.length - 1) & 0xfc00) === 0xd800 ? text.slice(0, -1) : text;
}

// 1 枚分（長ければ「(2)」の続きが付く）。枚ごとに変換し、章の区切り（section）は付けない。演説者ノートは最初の 1 枚に置く。
function chunk(slide: AiDeckSlide, theme: DeckTheme, untitledLabel: string | undefined) {
  const title = oneLine(slide.title);
  const parsedHeading = title ? markdownToBlocks(prepareNoteMarkdown(`## ${title}`, { dropImages: true })).slice(0, 1) : [];
  // 題名が記号（例: "▸"）だけで markdownToBlocks に見出し文字が落ちる場合もそのまま題名として保つ。
  const heading: Block[] = title
    ? (blocksHaveVisibleContent(parsedHeading) ? parsedHeading : [{ id: "", type: "heading", props: { level: 2 }, content: [{ type: "text", text: title, styles: {} }], children: [] }])
    : [];
  const blocks = [...heading, ...bodyBlocks(markdownToBlocks(prepareNoteMarkdown(cleanText(slide.body), { dropImages: true })))];
  if (!blocksHaveVisibleContent(blocks)) return { slides: [] as Slide[], truncatedSlides: 0 };
  const { deck, truncatedSlides } = noteToDeckResult({ title: "", blocks, theme, untitledLabel });
  const slides = deck.slides.map((entry) => {
    const { section: _section, ...rest } = entry;
    void _section;
    return rest as Slide;
  });
  const notes = clipNotes(slide.notes);
  if (notes && slides.length) slides[0] = { ...slides[0], notes };
  return { slides, truncatedSlides };
}

export function buildAiDeck({ title, slides, theme, untitledLabel }: AiDeckInput): { deck: Deck; truncatedSlides: number } {
  const cover = createSlide("title", { title: oneLine(title) || untitledLabel || "Untitled" });
  // 表紙の空の副題は残さない。
  cover.elements = cover.elements.filter((element) => element.role !== "subtitle");
  const chunks = slides.map((slide) => chunk(slide, theme, untitledLabel));
  const all = [cover, ...chunks.flatMap((entry) => entry.slides)];
  const deck = normalizeDeck({ format: DECK_FORMAT, theme, slides: all.slice(0, MAX_SLIDES) });
  const truncatedSlides = all.length - deck.slides.length + chunks.reduce((sum, entry) => sum + entry.truncatedSlides, 0);
  // 保存の検証は undefined の値を受け付けないので、JSON にできる形にそろえて返す。
  return { deck: JSON.parse(JSON.stringify(deck)) as Deck, truncatedSlides };
}
