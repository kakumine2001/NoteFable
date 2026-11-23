import { noteFileUrlName, parseNoteFileUrl } from "@/lib/note-file-keys";
import { shareFileUrl } from "@/lib/note-share";
import { normalizeDeck, type Deck } from "@/lib/slides/model";
import { richDocLatex } from "@/lib/slides/rich-text";

// 公開の放映ページ（/s/:token）に出すスライド。隠した枚・演説者ノート・AI の画像の説明（プロンプト）は出さない。
export function publicDeck(data: unknown): Deck {
  const deck = normalizeDeck(data);
  return {
    ...deck,
    slides: deck.slides.filter((slide) => !slide.hidden).map((slide) => {
      const { notes: _notes, ...rest } = slide;
      void _notes;
      return {
        ...rest,
        elements: slide.elements.map((element) => {
          if (element.type !== "image" || !element.generated) return element;
          const { generated: _generated, ...image } = element;
          void _generated;
          return image;
        }),
      };
    }),
  };
}

// 公開の放映ページで見せてよいファイル（見せる枚が参照している画像）の保存先。
export function publicDeckFilePaths(data: unknown): Set<string> {
  const paths = new Set<string>();
  for (const slide of publicDeck(data).slides) for (const element of slide.elements) {
    if (element.type !== "image" && element.type !== "whiteboard") continue;
    const parsed = parseNoteFileUrl(element.src);
    if (parsed && parsed !== "empty") paths.add(parsed.path);
  }
  return paths;
}

// 画像の URL を、公開ページのファイルの経路（/s/:token/file）に書き換える。
export function publicImageSrc(token: string, pageId: string) {
  return (src: string) => {
    const parsed = parseNoteFileUrl(src);
    return parsed && parsed !== "empty" ? shareFileUrl(token, pageId, parsed.path, noteFileUrlName(src) ?? "") : "";
  };
}

// 本体の中の数式の鍵（サーバーで先に描く）。
export function deckMathKeys(deck: Deck): string[] {
  const keys = new Set<string>();
  for (const slide of deck.slides) for (const element of slide.elements) {
    if (element.type === "text" || element.type === "shape") richDocLatex(element.doc, keys);
  }
  return [...keys];
}
