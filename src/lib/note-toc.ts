import { inlineText, walkBlocks } from "@/lib/note-text";

export type TocHeading = {
  id: string;
  level: 1 | 2 | 3;
  text: string;
};

/**
 * ノート内の見出しブロック（H1〜H3）を出現順に抽出する。
 * トグルや段組み（columns）内の見出しも含め、空の見出しは目次に出さない。
 */
export function extractTocHeadings(blocks: unknown): TocHeading[] {
  const headings: TocHeading[] = [];
  for (const block of walkBlocks(blocks)) {
    if (block.type !== "heading") continue;
    const id = typeof block.id === "string" ? block.id : "";
    if (!id) continue;
    const props = block.props && typeof block.props === "object" ? (block.props as { level?: unknown }) : null;
    const level = props?.level;
    if (level !== 1 && level !== 2 && level !== 3) continue;
    const text = inlineText(block.content).trim();
    if (!text) continue;
    headings.push({ id, level, text });
  }
  return headings;
}

export function sameTocHeadings(a: TocHeading[], b: TocHeading[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].level !== b[i].level || a[i].text !== b[i].text) return false;
  }
  return true;
}
