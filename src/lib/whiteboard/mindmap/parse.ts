import type { MindmapTreeNode } from "@/lib/whiteboard/mindmap/model";

// Mermaid の mindmap 記法を木にする。Mermaid の図をそのまま変換すると思考マップは 1 枚の画像になる（編集できない）ので、
// 思考マップだけはここで木にして、自前の配置（layout.ts）で図形と線にする。
// 記法：先頭の行が mindmap、続く行の字下げの深さで親子が決まる。節は「文字」か「ID と形の括弧で囲んだ文字」
// （root((中心)) / a[四角] / b(丸角) / c))爆発(( / d)雲( / e{{六角}}）。:::クラス・::icon(…)・%% のコメントは読み飛ばす。

export class MindmapParseError extends Error {}

// 形の括弧。長いものから順に試す（(( を ( より先に）。
const SHAPES: readonly (readonly [string, string])[] = [["((", "))"], ["))", "(("], ["{{", "}}"], ["(-", "-)"], ["[", "]"], ["(", ")"], [")", "("]];

const ENTITIES: Record<string, string> = { quot: "\"", amp: "&", lt: "<", gt: ">", apos: "'", nbsp: " ", semi: ";", num: "#" };

function decodeEntities(text: string) {
  // Mermaid の #quot; / #35; と HTML の &quot; / &#35; のどちらも。
  return text
    .replace(/[#&]#?x([0-9a-f]{1,6});/gi, (match, hex: string) => codePoint(parseInt(hex, 16)) ?? match)
    .replace(/[#&]#?(\d{1,7});/g, (match, decimal: string) => codePoint(Number(decimal)) ?? match)
    .replace(/[#&]([a-z]{2,6});/gi, (match, name: string) => ENTITIES[name.toLowerCase()] ?? match);
}

function codePoint(value: number) {
  return Number.isInteger(value) && value > 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff) ? String.fromCodePoint(value) : null;
}

// 1 行から節の文字を取り出す。
export function mindmapNodeText(raw: string): string {
  let text = raw.trim().replace(/\s*:::[\w\s-]*$/, "").trim();
  for (const [open, close] of SHAPES) {
    const start = text.indexOf(open);
    if (start < 0 || !text.endsWith(close) || start + open.length > text.length - close.length) continue;
    // 括弧の前は空白や括弧を含まない ID だけ（「f(x) の意味」のような文字を形と取り違えない）。
    if (!/^[^\s()[\]{}]*$/.test(text.slice(0, start))) continue;
    text = text.slice(start + open.length, text.length - close.length).trim();
    break;
  }
  if (text.length >= 2 && text.startsWith("\"") && text.endsWith("\"")) text = text.slice(1, -1).trim();
  if (text.length >= 2 && text.startsWith("`") && text.endsWith("`")) text = text.slice(1, -1).trim();
  text = decodeEntities(text.replace(/<br\s*\/?>/gi, "\n"));
  // 文字の飾り（**太字** / __太字__）は白板では表せないので外す。
  text = text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/__(.+?)__/g, "$1");
  return text.split("\n").map((line) => line.trim()).filter(Boolean).join("\n");
}

const indentOf = (line: string) => {
  let width = 0;
  for (const char of line) {
    if (char === " ") width += 1;
    else if (char === "\t") width += 4;
    else break;
  }
  return width;
};

// 先頭が mindmap の記法か（前置きのフロントマターと %%{init}%% は飛ばす）。
export function isMindmapSource(source: string) {
  return firstLines(source).header === "mindmap";
}

function firstLines(source: string) {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  let index = 0;
  // フロントマター（--- で囲んだ設定）。
  if (lines[0]?.trim() === "---") {
    index = 1;
    while (index < lines.length && lines[index].trim() !== "---") index++;
    index++;
  }
  for (; index < lines.length; index++) {
    const trimmed = lines[index].trim();
    if (!trimmed || trimmed.startsWith("%%")) continue;
    return { header: trimmed.split(/\s+/)[0], rest: lines.slice(index + 1) };
  }
  return { header: "", rest: [] as string[] };
}

// 木を返す。節が 1 つも無い・mindmap の記法でないときは MindmapParseError。
// 根より浅い（同じ深さの）節が後に続くときは、Mermaid と違って誤りにせず、最初の根の子として扱う。
export function parseMindmap(source: string): MindmapTreeNode {
  const { header, rest } = firstLines(source);
  if (header !== "mindmap") throw new MindmapParseError("The diagram must start with \"mindmap\".");
  let root: MindmapTreeNode | null = null;
  let rootIndent = 0;
  const stack: { indent: number; node: MindmapTreeNode }[] = [];
  for (const line of rest) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("%%") || trimmed.startsWith("::icon(")) continue;
    const text = mindmapNodeText(trimmed);
    if (!text) continue;
    const indent = indentOf(line);
    const node: MindmapTreeNode = { text, children: [] };
    if (!root) {
      root = node;
      rootIndent = indent;
      stack.push({ indent, node });
      continue;
    }
    // 根と同じか浅い節は根の子にする。
    const level = Math.max(indent, rootIndent + 1);
    while (stack.length > 1 && stack[stack.length - 1].indent >= level) stack.pop();
    stack[stack.length - 1].node.children.push(node);
    stack.push({ indent: level, node });
  }
  if (!root) throw new MindmapParseError("The mindmap has no nodes.");
  return root;
}
