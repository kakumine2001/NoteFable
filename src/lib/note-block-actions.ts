import type { Block } from "@blocknote/core";

export const NOTE_TEXT_BLOCKS = [
  { key: "paragraph", type: "paragraph", title: "Text", aliases: ["text", "文本", "段落", "テキスト"], digit: "0" },
  { key: "heading", type: "heading", level: 1, title: "Heading 1", aliases: ["标题1", "見出し1"], digit: "1" },
  { key: "heading_2", type: "heading", level: 2, title: "Heading 2", aliases: ["标题2", "見出し2"], digit: "2" },
  { key: "heading_3", type: "heading", level: 3, title: "Heading 3", aliases: ["标题3", "見出し3"], digit: "3" },
  { key: "check_list", type: "checkListItem", title: "To-do list", aliases: ["todo", "to do", "待办", "チェック"], digit: "4" },
  { key: "bullet_list", type: "bulletListItem", title: "Bulleted list", aliases: ["bullet", "无序列表", "箇条書き"], digit: "5" },
  { key: "numbered_list", type: "numberedListItem", title: "Numbered list", aliases: ["number", "有序列表", "番号"], digit: "6" },
  { key: "code_block", type: "codeBlock", title: "Code", aliases: ["代码", "コード"], digit: "8" },
  { key: "quote", type: "quote", title: "Quote", aliases: ["引用"], digit: undefined },
] as const;

export type NoteBlockTarget = typeof NOTE_TEXT_BLOCKS[number];

// 子ブロックまで新しい ID を付け、元の文書と参照を共有しない。
export function copyNoteBlocks(blocks: Block[]): Block[] {
  return blocks.map((block) => ({ ...structuredClone(block), id: crypto.randomUUID(), children: copyNoteBlocks(block.children) }));
}

export function selectedRootBlocks(blocks: Block[]): Block[] {
  const childIds = new Set<string>();
  function visit(block: Block) { for (const child of block.children) { childIds.add(child.id); visit(child); } }
  blocks.forEach(visit);
  return blocks.filter((block) => !childIds.has(block.id));
}

// コードへの変換では表示文字を残し、保存できないリンクや装飾を外す。
export function codeBlockText(block: Block): string {
  if (!Array.isArray(block.content)) return "";
  return block.content.map((entry) => entry.type === "text" ? entry.text : entry.type === "link" ? entry.content.map((text) => text.text).join("") : "").join("");
}
