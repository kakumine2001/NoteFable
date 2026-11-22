import { msg } from "@/lib/i18n/translate";

export const NOTE_TEXT_BLOCKS = [
  { key: "paragraph", type: "paragraph", title: msg("Text"), aliases: ["text", "文本", "段落", "テキスト"], digit: "0" },
  { key: "heading", type: "heading", level: 1, title: msg("Heading 1"), aliases: ["标题1", "見出し1"], digit: "1" },
  { key: "heading_2", type: "heading", level: 2, title: msg("Heading 2"), aliases: ["标题2", "見出し2"], digit: "2" },
  { key: "heading_3", type: "heading", level: 3, title: msg("Heading 3"), aliases: ["标题3", "見出し3"], digit: "3" },
  { key: "check_list", type: "checkListItem", title: msg("To-do list"), aliases: ["todo", "to do", "待办", "チェック"], digit: "4" },
  { key: "bullet_list", type: "bulletListItem", title: msg("Bulleted list"), aliases: ["bullet", "无序列表", "箇条書き"], digit: "5" },
  { key: "numbered_list", type: "numberedListItem", title: msg("Numbered list"), aliases: ["number", "有序列表", "番号"], digit: "6" },
  { key: "toggle_list", type: "toggleListItem", title: msg("Toggle list"), aliases: ["toggle", "折叠", "トグル"], digit: "7" },
  { key: "code_block", type: "codeBlock", title: msg("Code"), aliases: ["代码", "コード"], digit: "8" },
  { key: "quote", type: "quote", title: msg("Quote"), aliases: ["引用"], digit: undefined },
  { key: "callout", type: "callout", title: msg("Callout"), aliases: ["callout", "标注", "提示", "コールアウト"], digit: undefined },
  { key: "toggle_heading", type: "heading", level: 1, toggle: true, title: msg("Toggle heading 1"), aliases: ["toggle h1", "折叠标题1", "トグル見出し1"], digit: undefined },
  { key: "toggle_heading_2", type: "heading", level: 2, toggle: true, title: msg("Toggle heading 2"), aliases: ["toggle h2", "折叠标题2", "トグル見出し2"], digit: undefined },
  { key: "toggle_heading_3", type: "heading", level: 3, toggle: true, title: msg("Toggle heading 3"), aliases: ["toggle h3", "折叠标题3", "トグル見出し3"], digit: undefined },
] as const;

export type NoteBlockTarget = typeof NOTE_TEXT_BLOCKS[number];

// 変換先に付ける props。見出しは通常とトグルを isToggleable で分ける。
export function targetProps(target: NoteBlockTarget): Record<string, unknown> {
  return target.type === "heading" ? { level: target.level, isToggleable: "toggle" in target } : {};
}

// ブロックがその変換先と同じ種類か（「Turn into」のチェック表示に使う）。
export function blockMatchesTarget(block: { type: string; props?: Record<string, unknown> }, target: NoteBlockTarget) {
  if (block.type !== target.type) return false;
  return target.type !== "heading" || (block.props?.level === target.level && (block.props?.isToggleable === true) === ("toggle" in target));
}

// エディターのスキーマ（コールアウトなどの独自ブロックを含む）に依らず使えるよう、必要な形だけを要求する。
type TreeBlock<T> = { id: string; children: T[] };

// 子ブロックまで新しい ID を付け、元の文書と参照を共有しない。
export function copyNoteBlocks<T extends TreeBlock<T>>(blocks: T[]): T[] {
  return blocks.map((block) => ({ ...structuredClone(block), id: crypto.randomUUID(), children: copyNoteBlocks(block.children) }));
}

export function selectedRootBlocks<T extends TreeBlock<T>>(blocks: T[]): T[] {
  const childIds = new Set<string>();
  function visit(block: T) { for (const child of block.children) { childIds.add(child.id); visit(child); } }
  blocks.forEach(visit);
  return blocks.filter((block) => !childIds.has(block.id));
}

// コードへの変換では表示文字を残し、保存できないリンクや装飾を外す。
export function codeBlockText(block: { content?: unknown }): string {
  if (!Array.isArray(block.content)) return "";
  type Inline = { type?: unknown; text?: unknown; content?: unknown; props?: { latex?: unknown } };
  const text = (entry: Inline): string => entry.type === "text" ? String(entry.text ?? "")
    // 行内の数式は TeX のソースを残す（コードブロックは数式を持てない）。
    : entry.type === "mathInline" ? String(entry.props?.latex ?? "")
      : entry.type === "link" && Array.isArray(entry.content) ? (entry.content as Inline[]).map(text).join("") : "";
  return (block.content as Inline[]).map(text).join("");
}
