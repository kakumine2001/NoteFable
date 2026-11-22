import { isEmojiIcon } from "@/lib/emoji-icon";
import { isNoteImageUrl, noteFileUrlName } from "@/lib/note-file-keys";
import { mentionFromHref, mentionHref, mentionText, type MentionProps } from "@/lib/note-mention";
// BlockNote のブロック JSON と Markdown の相互変換。チャットのツールがページを読む（JSON → Markdown）、
// 編集案を作る（Markdown → JSON）ために使う。対応するのは note-document.ts が検証する範囲のブロックだけ。

export type NoteBlock = {
  id?: unknown;
  type?: unknown;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: unknown;
};

type InlineNode =
  | { type: "text"; text: string; styles: Record<string, boolean> }
  | { type: "link"; href: string; content: InlineNode[] }
  | { type: "mention"; props: MentionProps };
type Styles = Record<string, boolean>;

type Inline = { type?: unknown; text?: unknown; styles?: unknown; content?: unknown; href?: unknown; props?: unknown };

export const DEFAULT_CALLOUT_EMOJI = "💡";

// ---- ブロック → Markdown ----

// 本文中の記号を、読み戻した時に装飾にならないよう \ で退避する。パーサーの UNESCAPE と対にする。
function escapeText(text: string) {
  return text.replace(/[\\`*[\]]/g, "\\$&").replace(/~~/g, "\\~\\~");
}

// 行頭がブロック記号に見える段落は、記号を退避して段落のまま戻るようにする。
function escapeBlockStart(text: string) {
  if (/^\d+[.)](\s|$)/.test(text)) return text.replace(/^(\d+)([.)])/, "$1\\$2");
  return /^(#{1,6}(\s|$)|[-+](\s|$)|>|\||▸(\s|$)|`{3}|(-{3,}|_{3,})$)/.test(text) ? `\\${text}` : text;
}

// ---- 表 ----

export const TABLE_SEPARATOR = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

// Markdown から作る表のセル数の上限。行ごとに列数へ空のセルを足すので、短い入力（列の多い 1 行と大量の短い行）が
// 巨大な表に膨らまないようにする。1 MiB のノートに入るのは数千セルまでなので、実際の表はこれより小さい。
export const MAX_PARSED_TABLE_CELLS = 20_000;

// 表の 1 行をセルに分ける。\| とコードの中の | では区切らない。
// コードは同じ長さのバッククォート列で閉じる（`` a`b `` も 1 つのコード）。コードの外の \` はコードを開かない。
export function splitTableRow(line: string) {
  const cells: string[] = [];
  let cell = "";
  // 開いているコードのバッククォートの数。0 はコードの外。
  let fence = 0;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === "\\" && line[index + 1] === "|") {
      cell += "|";
      index++;
    } else if (char === "\\" && !fence && index + 1 < line.length) {
      // 退避された記号はそのまま残し、後のインライン解析に任せる。
      cell += char + line[++index];
    } else if (char === "`") {
      let end = index;
      while (line[end + 1] === "`") end++;
      const run = end - index + 1;
      // 閉じる列がこの行に無いバッククォートは、コードを開かない（以降の | を飲み込まない）。
      if (!fence) fence = closesLater(line, end + 1, run) ? run : 0;
      else if (run === fence) fence = 0;
      cell += line.slice(index, end + 1);
      index = end;
    } else if (char === "|" && !fence) {
      cells.push(cell);
      cell = "";
    } else cell += char;
  }
  cells.push(cell);
  const text = line.trim();
  if (text.startsWith("|")) cells.shift();
  if (text.endsWith("|") && !text.endsWith("\\|")) cells.pop();
  return cells.map((value) => value.trim());
}

// from 以降に、ちょうど run 個並んだバッククォートの列があるか。
function closesLater(line: string, from: number, run: number) {
  for (let index = from; index < line.length; index++) {
    if (line[index] !== "`") continue;
    let end = index;
    while (line[end + 1] === "`") end++;
    if (end - index + 1 === run) return true;
    index = end;
  }
  return false;
}

// 表ブロックの content から、行ごとのセルの本文（インライン配列）を取り出す。結合セルはそのまま 1 セルとして並べる。
function tableRows(content: unknown): unknown[][] {
  const rows = (content as { rows?: unknown } | null)?.rows;
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    const cells = (row as { cells?: unknown } | null)?.cells;
    return Array.isArray(cells) ? cells.map((cell) => Array.isArray(cell) ? cell : (cell as { content?: unknown } | null)?.content) : [];
  });
}

// GFM の表の 1 行。セルの中の改行は空白に、| は \| にする。
function tableRowMarkdown(cells: unknown[], columns: number) {
  const texts = Array.from({ length: columns }, (_, index) => inlineToMarkdown(cells[index]).replace(/\n/g, " ").replace(/\|/g, "\\|").trim());
  return `| ${texts.join(" | ")} |`;
}

// バッククォートを含むコードは、中の最長の列より長い囲みにする。両端が ` なら空白を 1 つずつ足す。
function inlineCode(body: string) {
  const fence = "`".repeat(Math.max(1, ...[...body.matchAll(/`+/g)].map((run) => run[0].length + 1)));
  const pad = body.startsWith("`") || body.endsWith("`") ? " " : "";
  return `${fence}${pad}${body}${pad}${fence}`;
}

function inlineToMarkdown(content: unknown, plain = false): string {
  if (!Array.isArray(content)) return "";
  return (content as Inline[]).map((entry) => {
    if (entry?.type === "link" && typeof entry.href === "string") {
      const text = inlineToMarkdown(entry.content, plain);
      return plain ? text : `[${text}](${entry.href.replace(/\s/g, encodeURIComponent).replace(/\)/g, "%29")})`;
    }
    if (entry?.type === "mention" && entry.props && typeof entry.props === "object") {
      // ページは [@タイトル](page:ID)、日付は [@YYYY-MM-DD](date:YYYY-MM-DD)。parseInline が読み戻す。
      const props = entry.props as Record<string, unknown>;
      const text = mentionText(props);
      return plain ? text : `[${escapeText(text)}](${mentionHref(props)})`;
    }
    if (entry?.type !== "text" || typeof entry.text !== "string") return "";
    if (plain) return entry.text;
    if (!entry.text.trim()) return entry.text;
    const styles = (entry.styles ?? {}) as Record<string, unknown>;
    // 前後の空白は記号の外に出す（「**a **」は強調として読み戻せない）。
    const [, lead, body, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(entry.text)!;
    let text = styles.code ? inlineCode(body) : escapeText(body);
    if (styles.bold && styles.italic) text = `***${text}***`;
    else if (styles.bold) text = `**${text}**`;
    else if (styles.italic) text = `*${text}*`;
    if (styles.strike) text = `~~${text}~~`;
    return lead + text + trail;
  }).join("");
}

// 保存済みの BlockNote JSON を、モデルが読みやすい Markdown にする。不明なブロックは本文だけ残す。
// counter を渡すと、全ブロックを深さ優先の順に 1 から番号付けして `[n] ` を行頭に付ける（空ブロックも 1 行出す）。
// 編集ツールはこの番号でブロックを指す。
export function blocksToMarkdown(blocks: unknown, depth = 0, counter?: { n: number }): string {
  if (!Array.isArray(blocks) || depth > 8) return "";
  const indent = "  ".repeat(depth);
  const lines: string[] = [];
  let previousType: unknown;
  for (const block of blocks as NoteBlock[]) {
    if (!block || typeof block !== "object") continue;
    const props = block.props ?? {};
    const label = counter ? `[${++counter.n}] ` : "";
    if (block.type === "codeBlock") {
      const code = inlineToMarkdown(block.content, true);
      const language = typeof props.language === "string" ? props.language : "";
      // 本文に ``` が含まれても閉じられないよう、中のバッククォート列より長い囲みにする。
      const fence = "`".repeat(Math.max(3, ...[...code.matchAll(/`+/g)].map((run) => run[0].length + 1)));
      lines.push(`${indent}${label}${fence}${language}`, ...code.split("\n").map((line) => indent + line), `${indent}${fence}`);
    } else if (block.type === "divider") {
      lines.push(`${indent}${label}---`);
    } else if (block.type === "table") {
      // 表は GFM の表として書く（1 行目を見出し行にする。行は番号を持たず、表全体が 1 ブロック）。
      const rows = tableRows(block.content);
      const columns = rows.reduce((max, row) => Math.max(max, row.length), 1);
      if (rows.length) {
        // 表が続く時は空行で区切る（詰めて書くと、読み戻した時に 1 つの表になる）。番号付きの時は [n] が区切りになる。
        if (!counter && previousType === "table") lines.push("");
        lines.push(`${indent}${label}${tableRowMarkdown(rows[0], columns)}`, `${indent}| ${Array.from({ length: columns }, () => "---").join(" | ")} |`,
          ...rows.slice(1).map((row) => indent + tableRowMarkdown(row, columns)));
      } else if (counter) lines.push(`${indent}${label}`);
    } else if (block.type === "image" || block.type === "file") {
      // アップロードされた画像・ファイルは中身を読めないので、名前と説明だけを書いた目印にする（編集では置換・削除できる。その場合は提案の画面で警告する）。
      const name = typeof props.name === "string" && props.name ? props.name : "untitled";
      const caption = typeof props.caption === "string" && props.caption ? ` — ${props.caption}` : "";
      lines.push(`${indent}${label}[${block.type === "image" ? "Image" : "File"}: ${name}${caption}]`);
    } else {
      const text = inlineToMarkdown(block.content);
      const start = Number(props.start);
      // 折りたたみ（トグル）は ▸、コールアウトは「> [!絵文字]」で表す。
      const prefix =
        block.type === "heading" ? `${"#".repeat(Math.min(Math.max(Number(props.level) || 1, 1), 3))} ${props.isToggleable === true ? "▸ " : /^▸(\s|$)/.test(text) ? "\\" : ""}` :
        block.type === "toggleListItem" ? "▸ " :
        block.type === "callout" ? `> [!${isEmojiIcon(props.emoji) ? props.emoji : DEFAULT_CALLOUT_EMOJI}] ` :
        block.type === "bulletListItem" ? "- " :
        block.type === "numberedListItem" ? `${Number.isInteger(start) && start > 0 ? start : 1}. ` :
        block.type === "checkListItem" ? (props.checked ? "- [x] " : "- [ ] ") :
        block.type === "quote" ? "> " : "";
      if (counter || text.trim() || prefix) lines.push(`${indent}${label}${prefix}${prefix ? text : escapeBlockStart(text)}`);
    }
    const children = blocksToMarkdown(block.children, depth + 1, counter);
    if (children) lines.push(children);
    previousType = block.type;
  }
  return lines.join("\n");
}

// 深さ優先（行頭の [n] 番号と同じ順）でブロックを平らにする。
export function flattenBlocks(blocks: unknown, depth = 0, out: NoteBlock[] = []): NoteBlock[] {
  if (!Array.isArray(blocks) || depth > 8) return out;
  for (const block of blocks as NoteBlock[]) {
    if (!block || typeof block !== "object") continue;
    out.push(block);
    flattenBlocks(block.children, depth + 1, out);
  }
  return out;
}

// ---- Markdown → ブロック ----

function safeHref(href: string) {
  try {
    return ["http:", "https:", "mailto:", "tel:"].includes(new URL(href).protocol);
  } catch {
    return false;
  }
}

// 「from 以降で最初の記号」を、走査位置が単調に進む前提で使い回す。閉じ記号が無い入力で毎回末尾まで探し直さない。
class Finder {
  private cache = new Map<string, { from: number; pos: number }>();
  constructor(private src: string) {}

  private lone?: number[];
  private runs?: { pos: number; len: number }[];
  private runIndex = new Map<number, number>();

  // 単独の * （前後が * でない）の位置。前から順に一度だけ数える。
  loneStar(from: number) {
    if (!this.lone) {
      this.lone = [];
      for (let j = 0; j < this.src.length; j++) {
        if (this.src[j] === "\\") { j++; continue; }
        if (this.src[j] !== "*") continue;
        let end = j;
        while (this.src[end + 1] === "*") end++;
        if (end === j) this.lone.push(j);
        j = end;
      }
    }
    let low = 0;
    let high = this.lone.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (this.lone[mid] < from) low = mid + 1;
      else high = mid;
    }
    return low < this.lone.length ? this.lone[low] : -1;
  }

  // from 以降で、ちょうど len 個並んだバッククォートの列の位置。
  backtickRun(len: number, from: number) {
    if (!this.runs) this.runs = [...this.src.matchAll(/`+/g)].map((run) => ({ pos: run.index!, len: run[0].length }));
    let index = this.runIndex.get(len) ?? 0;
    while (index < this.runs.length && (this.runs[index].pos < from || this.runs[index].len !== len)) index++;
    this.runIndex.set(len, index);
    return index < this.runs.length ? this.runs[index].pos : -1;
  }

  find(mark: string, from: number, escaped = true) {
    const key = `${escaped ? "e" : "r"}${mark}`;
    const hit = this.cache.get(key);
    if (hit && hit.from <= from && (hit.pos === -1 || hit.pos >= from)) return hit.pos;
    let pos = -1;
    if (!escaped) pos = this.src.indexOf(mark, from);
    else {
      for (let j = from; j < this.src.length; j++) {
        if (this.src[j] === "\\") { j++; continue; }
        if (this.src.startsWith(mark, j)) { pos = j; break; }
      }
    }
    this.cache.set(key, { from, pos });
    return pos;
  }
}

const WRAPPERS: { mark: string; styles: Styles }[] = [
  { mark: "***", styles: { bold: true, italic: true } },
  { mark: "**", styles: { bold: true } },
  { mark: "~~", styles: { strike: true } },
  { mark: "*", styles: { italic: true } },
];
// | は入れない: 段落の行頭の \| は markdownToBlocks が、表のセルの \| は splitTableRow が戻す（本文中の \| は書かれたまま残す）。
// $ は、回答の中で数式と紛れないよう \$ と書かれる金額の記号。ノートでは文字の $ に戻す。
const UNESCAPE = /[\\`*~[\]()#>.+_$▸-]/;
const MAX_INLINE_DEPTH = 6;

// メンションの表示文字（[ ] の中）から \ の退避を外す。
function unescapeLabel(text: string) {
  return text.replace(/\\(.)/g, "$1");
}

// **太字** *斜体* ***両方*** ~~取り消し~~ `コード` [リンク](URL) だけを解釈する。それ以外は文字のまま残す。
function parseInline(src: string, styles: Styles = {}, allowLinks = true, depth = 0): InlineNode[] {
  const out: InlineNode[] = [];
  const finder = new Finder(src);
  let buffer = "";
  const flush = () => {
    if (buffer) out.push({ type: "text", text: buffer, styles: { ...styles } });
    buffer = "";
  };
  let i = 0;
  scan: while (i < src.length) {
    const char = src[i];
    if (char === "\\" && i + 1 < src.length && UNESCAPE.test(src[i + 1])) {
      buffer += src[i + 1];
      i += 2;
      continue;
    }
    if (char === "`") {
      // 同じ長さのバッククォート列で閉じる（`` a`b `` のようにバッククォートを含められる）。
      let open = i;
      while (src[open] === "`") open++;
      const len = open - i;
      const close = finder.backtickRun(len, open);
      if (close > open) {
        let inner = src.slice(open, close);
        if (inner.length > 2 && inner.startsWith(" ") && inner.endsWith(" ") && inner.trim()) inner = inner.slice(1, -1);
        flush();
        out.push({ type: "text", text: inner, styles: { ...styles, code: true } });
        i = close + len;
        continue;
      }
      buffer += src.slice(i, open);
      i = open;
      continue;
    }
    if (allowLinks && char === "[") {
      const close = finder.find("]", i + 1);
      const paren = close > i + 1 && src[close + 1] === "(" ? finder.find(")", close + 2) : -1;
      const href = paren > close ? src.slice(close + 2, paren) : "";
      const mention = href ? mentionFromHref(href, unescapeLabel(src.slice(i + 1, close))) : null;
      if (mention) {
        flush();
        out.push(mention);
        i = paren + 1;
        continue;
      }
      if (href && !/\s/.test(href) && safeHref(href)) {
        flush();
        out.push({ type: "link", href, content: parseInline(src.slice(i + 1, close), styles, false, depth + 1) });
        i = paren + 1;
        continue;
      }
    }
    if (depth < MAX_INLINE_DEPTH) {
      for (const { mark, styles: added } of WRAPPERS) {
        if (!src.startsWith(mark, i)) continue;
        const start = i + mark.length;
        const end = mark === "*" ? finder.loneStar(start) : finder.find(mark, start);
        const inner = end > start ? src.slice(start, end) : "";
        // 前後が空白の「2 * 3 * 4」のような箇所は強調にしない。
        if (!inner || inner !== inner.trim()) continue;
        flush();
        out.push(...parseInline(inner, { ...styles, ...added }, allowLinks, depth + 1));
        i = end + mark.length;
        continue scan;
      }
    }
    buffer += char;
    i++;
  }
  flush();
  return out;
}

type NewBlock = { id: string; type: string; props: Record<string, unknown>; content?: unknown; children: NewBlock[] };

// 行頭の空白の幅。タブは 2 桁として入れ子の深さだけに使い、コードの中身は変えない。
function indentWidth(line: string) {
  let width = 0;
  for (const char of line) {
    if (char === " ") width += 1;
    else if (char === "\t") width += 2;
    else break;
  }
  return width;
}

function stripIndent(line: string, width: number) {
  let used = 0;
  let index = 0;
  while (index < line.length && used < width && (line[index] === " " || line[index] === "\t")) used += line[index++] === "\t" ? 2 : 1;
  return line.slice(index);
}

const FENCE = /^(`{3,})([\w+#.-]*)\s*$/;

// 1 行 1 ブロック。行頭の記号で種類を決め、半角 2 スペース（またはタブ）のインデントで入れ子にする。
// 対応: # ～ ###、- / 1. / - [ ]、>、``` コード、---、▸ トグル（# ▸ はトグル見出し）、> [!絵文字] コールアウト、GFM の表。
// 連続する通常の行はそれぞれ別の段落になる。
export function markdownToBlocks(markdown: string): NewBlock[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const root: NewBlock[] = [];
  const parents: { indent: number; block: NewBlock }[] = [];

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line.trim()) continue;
    const indent = indentWidth(line);
    const text = line.trim();
    while (parents.length && parents[parents.length - 1].indent >= indent) parents.pop();
    const siblings = parents.length ? parents[parents.length - 1].block.children : root;
    const add = (type: string, props: Record<string, unknown>, content?: unknown) => {
      const block: NewBlock = { id: crypto.randomUUID(), type, props, ...(content ? { content } : {}), children: [] };
      siblings.push(block);
      parents.push({ indent, block });
      return block;
    };

    const fence = FENCE.exec(text);
    if (fence) {
      const close = new RegExp(`^\`{${fence[1].length},}\\s*$`);
      const code: string[] = [];
      while (++index < lines.length && !close.test(lines[index].trim())) code.push(stripIndent(lines[index], indent));
      const body = code.join("\n");
      add("codeBlock", fence[2] ? { language: fence[2].slice(0, 80) } : {}, body ? [{ type: "text", text: body, styles: {} }] : []);
      continue;
    }
    // 表: | で始まる行の次が区切り行（| --- | --- |）のとき。大きさの上限はノート全体の 1 MiB だけ。
    if (text.startsWith("|") && index + 1 < lines.length && lines[index + 1].includes("|") && TABLE_SEPARATOR.test(lines[index + 1])) {
      const rows = [splitTableRow(text)];
      let end = index + 1;
      while (end + 1 < lines.length && lines[end + 1].trim().startsWith("|")) rows.push(splitTableRow(lines[++end]));
      const columns = rows.reduce((max, row) => Math.max(max, row.length), 1);
      // 埋めた後のセル数が多すぎるものは表にせず、下の通常の行として読む。
      if (rows.length * columns <= MAX_PARSED_TABLE_CELLS) {
        index = end;
        add("table", { textColor: "default" }, {
          type: "tableContent", columnWidths: Array.from({ length: columns }, () => null), headerRows: 1,
          rows: rows.map((row) => ({ cells: Array.from({ length: columns }, (_, column) => ({
            type: "tableCell", props: { backgroundColor: "default", textColor: "default", textAlignment: "left", colspan: 1, rowspan: 1 },
            content: parseInline(row[column] ?? ""),
          })) })),
        });
        // 表は子を持てない。
        parents.pop();
        continue;
      }
    }
    let match: RegExpExecArray | null;
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(text)) {
      add("divider", {});
    } else if ((match = /^(#{1,6})(?:\s+(.*))?$/.exec(text))) {
      const toggle = /^▸(?:\s+(.*))?$/.exec(match[2] ?? "");
      add("heading", { level: Math.min(match[1].length, 3), ...(toggle ? { isToggleable: true } : {}) }, parseInline(toggle ? toggle[1] ?? "" : match[2] ?? ""));
    } else if ((match = /^▸(?:\s+(.*))?$/.exec(text))) {
      add("toggleListItem", {}, parseInline(match[1] ?? ""));
    } else if ((match = /^>\s?\[!([^\]\s]{1,64})\](?:\s+(.*))?$/.exec(text)) && isEmojiIcon(match[1])) {
      add("callout", { emoji: match[1] }, parseInline(match[2] ?? ""));
    } else if ((match = /^[-*+]\s+\[([ xX])\](?:\s+(.*))?$/.exec(text))) {
      add("checkListItem", { checked: match[1] !== " " }, parseInline(match[2] ?? ""));
    } else if ((match = /^[-*+](?:\s+(.*))?$/.exec(text))) {
      add("bulletListItem", {}, parseInline(match[1] ?? ""));
    } else if ((match = /^(\d+)[.)](?:\s+(.*))?$/.exec(text))) {
      // 1 以外から始まる番号は、リストの先頭の項目にだけ開始番号として残す。
      const number = Number(match[1]);
      const startsList = siblings[siblings.length - 1]?.type !== "numberedListItem";
      add("numberedListItem", startsList && number > 1 && Number.isSafeInteger(number) ? { start: number } : {}, parseInline(match[2] ?? ""));
    } else if ((match = /^>\s?(.*)$/.exec(text))) {
      add("quote", {}, parseInline(match[1]));
    } else if ((match = /^!\[([^\]\n]*)\]\((\/api\/pages\/files\?[^\s)]*)\)$/.exec(text)) && isNoteImageUrl(match[2])) {
      // 自分のアップロード画像だけを画像ブロックにする（外部 URL は通常の段落のまま）。保存時に所有者を確かめる。
      const caption = match[1].replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 500);
      add("image", { url: match[2], name: noteFileUrlName(match[2]), caption, showPreview: true });
    } else {
      // 行頭の \| は「表ではない | で始まる段落」の退避（escapeBlockStart）なので、\ だけ外す。
      add("paragraph", {}, parseInline(text.startsWith("\\|") ? text.slice(1) : text));
    }
  }
  return root;
}
