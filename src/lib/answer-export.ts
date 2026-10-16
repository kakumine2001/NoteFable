import { MAX_NOTE_BYTES, MAX_NOTE_TITLE } from "@/lib/note-document";
import { markdownToBlocks } from "@/lib/note-markdown";

// AI の回答（Markdown）を、コピー・ダウンロード・ノートへの保存で使える形にする。ブラウザにもサーバーにも依存しない純粋な変換だけを置く。

type NoteBlockNode = ReturnType<typeof markdownToBlocks>[number];
export type AnswerSource = {
  // 回答があった会話のタイトルと、そこへ戻るリンク。
  conversationTitle: string;
  conversationUrl: string;
  savedAt: Date;
};

const TITLE_CHARS = 80;
const FILE_NAME_CHARS = 80;
// ファイル名の長さの上限（UTF-8 のバイト数）。Android のファイルシステムは 255 バイトまでで、日本語は 1 文字 3 バイトになる。
const FILE_NAME_BYTES = 160;
// validateNoteContent の制限: ブロック数、入れ子の深さ（子を持てるのは 7 段目まで）、全体の大きさ。
const MAX_BLOCKS = 2000;
const LAST_NESTING_LEVEL = 7;
// 切り詰めた本文のあとに足す区切り線と出典の段落（2 ブロック）の分と、念のための余白。
const BYTE_MARGIN = 2048;

// ---- 文字列の切り詰め ----

function splitGraphemes(text: string): string[] {
  // 家族の絵文字や国旗の途中で切ると壊れて表示されるので、使える環境では書記素の単位で切る。
  if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
    return Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), (part) => part.segment);
  }
  return Array.from(text);
}

// 先頭から、fits を満たす間だけ 1 文字（書記素）ずつ取る。
function clip(text: string, fits: (candidate: string, count: number) => boolean) {
  let out = "";
  let count = 0;
  for (const grapheme of splitGraphemes(text)) {
    if (!fits(out + grapheme, count + 1)) return { text: out, cut: true };
    out += grapheme;
    count++;
  }
  return { text: out, cut: false };
}

// 空白をそろえ、maxChars 文字（かつノートの題名の上限 200 文字）に収める。切ったときは末尾に … を付ける。
function shorten(text: string, maxChars: number) {
  const clean = text.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  const whole = clip(clean, (candidate, count) => count <= maxChars && candidate.length <= MAX_NOTE_TITLE);
  if (!whole.cut) return whole.text;
  const head = clip(clean, (candidate, count) => count <= maxChars - 1 && candidate.length <= MAX_NOTE_TITLE - 1);
  return `${head.text.trimEnd()}…`;
}

// ---- タイトル ----

// 見出しや先頭行から、Markdown の記号を取り除いた表示用の文字列を作る。
function stripInline(text: string) {
  return text
    .replace(/^\s*(?:>\s*)+/, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, "")
    .replace(/^#{1,6}\s+/, "")
    .replace(LINK, (_match, _bang: string, label: string) => label)
    .replace(/<(https?:[^>\s]+)>/g, "$1")
    .replace(/`+([^`]*)`+/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/\*([^\s*](?:[^*]*[^\s*])?)\*/g, "$1")
    .replace(/(^|[\s(])_([^\s_](?:[^_]*[^\s_])?)_(?=$|[\s).,;:!?])/g, "$1$2")
    .replace(/\\([\\`*_{}[\]()#+\-.!~>|])/g, "$1")
    .replace(/^\|+|\|+$/g, "")
    .trim();
}

const FENCE_OPEN = /^(\s*)(`{3,}|~{3,})(.*)$/;

// 閉じる前の囲み（``` や ~~~）を表す。
type Fence = { marker: string; size: number };

function openFence(line: string): (Fence & { indent: string; info: string }) | null {
  const match = FENCE_OPEN.exec(line);
  if (!match) return null;
  const [, indent, fence, info] = match;
  // ``` の後ろに ` があるのは、同じ行で閉じるインラインのコード。
  if (fence[0] === "`" && info.includes("`")) return null;
  return { indent, marker: fence[0], size: fence.length, info };
}

function closesFence(line: string, fence: Fence) {
  const text = line.trim();
  return text.length >= fence.size && [...text].every((char) => char === fence.marker);
}

type Analysis = {
  heading: { text: string; line: number; leading: boolean } | null;
  firstLine: string;
};

// コードの外で最初に見つかる見出しと、最初の本文の行を探す。leading は、見出しより前に何も無いこと。
function analyze(lines: string[]): Analysis {
  let fence: Fence | null = null;
  let seenContent = false;
  let firstLine = "";
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (fence) {
      if (closesFence(line, fence)) fence = null;
      continue;
    }
    const opened = openFence(line);
    if (opened) {
      fence = opened;
      seenContent = true;
      continue;
    }
    const text = line.trim();
    if (!text) continue;
    const heading = /^#{1,6}\s+(.*?)(?:\s+#+)?$/.exec(text);
    if (heading) {
      const label = stripInline(heading[1]);
      if (label) return { heading: { text: label, line: index, leading: !seenContent }, firstLine };
      seenContent = true;
      continue;
    }
    seenContent = true;
    if (!firstLine) {
      const label = stripInline(text);
      // 区切り線や表の罫線のように、記号だけの行は題名にしない。
      if (!/^[\s\-_*=#>|:~`+.]*$/.test(label)) firstLine = label;
    }
  }
  return { heading: null, firstLine };
}

function pickTitle(found: Analysis, fallback: string) {
  const label = found.heading?.text || found.firstLine;
  if (label) return shorten(label, TITLE_CHARS);
  return shorten(fallback, MAX_NOTE_TITLE) || "Untitled";
}

function normalizeNewlines(markdown: string) {
  return markdown.replace(/\r\n?/g, "\n");
}

// 回答のタイトル。最初の見出し、無ければ最初の本文の行（Markdown の記号は除く）を約 80 文字までにする。
// どちらも無ければ fallback（会話のタイトル）を使う。空にはならず、200 文字を超えない。
export function answerTitle(content: string, fallback: string) {
  return pickTitle(analyze(normalizeNewlines(content).split("\n")), fallback);
}

// ---- 会話へのリンク・メッセージ ID ----

// DB のメッセージ ID（cuid）か。送信直後の画面だけにある仮の ID（UUID、ハイフンを含む）はリンクに使えない。
export function isStoredMessageId(id: string) {
  return /^[a-z0-9]{20,40}$/i.test(id);
}

// 保存したノートやダウンロードしたファイルから会話へ戻るリンク。メッセージが DB に保存済みのときだけ、そのメッセージまで指す。
export function answerConversationUrl(origin: string, sessionId: string, messageId?: string | null) {
  const params = new URLSearchParams({ chat: sessionId });
  if (messageId && isStoredMessageId(messageId)) params.set("message", messageId);
  return `${origin}/?${params}`;
}

// ---- ファイル名 ----

const RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

// 回答のタイトルから .md のファイル名を作る。Windows と Android で使えない文字、パス区切り、予約名を避け、長さを抑える（日本語は残す）。
export function answerFileName(title: string) {
  let base = title
    .replace(/[\u0000-\u001f\u007f\\/:*?"<>|‎‏‪-‮⁦-⁩]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+/, "");
  base = clip(base, (candidate, count) => count <= FILE_NAME_CHARS && new TextEncoder().encode(candidate).byteLength <= FILE_NAME_BYTES).text;
  // Windows は末尾のドットと空白を落とすので、最初から付けない。
  base = base.replace(/[.\s]+$/, "");
  // 回答の題名が既に .md で終わるときに ".md.md" にしない。
  base = base.replace(/\.md$/i, "").replace(/[.\s]+$/, "");
  if (!base) base = "answer";
  if (RESERVED_NAME.test(base.split(".")[0])) base = `_${base}`;
  return `${base}.md`;
}

// ---- ダウンロード用の Markdown ----

function formatDate(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function isHttpUrl(value: string) {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function conversationLabel(title: string) {
  return shorten(title, 120) || "Untitled";
}

function escapeLabel(text: string) {
  return text.replace(/[\\`*_[\]~<>&]/g, "\\$&");
}

// 回答をそのまま保存した .md の中身。末尾に、どの会話から保存したかを 1 行だけ付ける（front matter は使わない）。
export function answerToMarkdownFile(markdown: string, { conversationTitle, conversationUrl, savedAt }: AnswerSource) {
  const label = escapeLabel(conversationLabel(conversationTitle));
  const where = isHttpUrl(conversationUrl) ? `[${label}](${conversationUrl})` : label;
  return `${normalizeNewlines(markdown).trimEnd()}\n\n---\n\nSaved from the conversation "${where}" on ${formatDate(savedAt)}.\n`;
}

// ---- ノートへの保存 ----

// [テキスト](URL) と ![代替文](URL)。URL は <…>（空白を含められる）、または丸括弧が釣り合った文字列で、"タイトル" が付いてもよい。
const LINK = /(!?)\[([^\]]*)\]\(\s*(<[^>\n]*>|(?:[^\s()]|\((?:[^\s()]|\([^\s()]*\))*\))*)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;

// 取り込み側は URL 中の空白と ) を扱えないので、同じ意味のままパーセントエンコードする。
function encodeHref(href: string) {
  return href.replace(/\s/g, encodeURIComponent).replace(/\(/g, "%28").replace(/\)/g, "%29");
}

// 回答の出典は [タイトル](<URL>) の形で終わるが、取り込み側は <…> を読めない。通常の [タイトル](URL) に書き直す。
function rewriteLinks(text: string) {
  return text
    .replace(LINK, (_match, bang: string, label: string, destination: string) => {
      const href = encodeHref(destination.startsWith("<") ? destination.slice(1, -1) : destination);
      // 画像はノートの画像ブロックにできない（外部の URL）ので、リンクにする。
      return `[${label || (bang ? "Image" : href)}](${href})`;
    })
    .replace(/<(https?:\/\/[^\s<>]+)>/g, (_match, url: string) => `[${url}](${encodeHref(url)})`);
}

// コードの範囲（`…`）には手を入れずに、それ以外の部分だけ書き直す。
function rewriteLine(line: string) {
  return line.split(/(`[^`]*`)/).map((part, index) => (index % 2 ? part : rewriteLinks(part))).join("");
}

// 表の 1 行をセルに分ける。\| とコードの中の | では区切らない。
function splitRow(line: string) {
  const cells: string[] = [];
  let cell = "";
  let inCode = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === "\\" && line[index + 1] === "|") {
      cell += "|";
      index++;
    } else if (char === "`") {
      inCode = !inCode;
      cell += char;
    } else if (char === "|" && !inCode) {
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

const TABLE_SEPARATOR = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

function startsTable(lines: string[], index: number) {
  const header = lines[index];
  const separator = lines[index + 1];
  return header.includes("|") && separator !== undefined && separator.includes("|") && TABLE_SEPARATOR.test(separator)
    && splitRow(header).length === splitRow(separator).length;
}

// 行頭が箇条書きや見出しの記号に見える行は、段落のままになるよう記号を退避する（**太字** で始まる行はそのまま）。
function escapeLineStart(text: string) {
  if (/^\d+[.)](\s|$)/.test(text)) return text.replace(/^(\d+)([.)])/, "$1\\$2");
  return /^(#{1,6}(\s|$)|[-+*](\s|$)|>|`{3}|(-{3,}|\*{3,}|_{3,})$)/.test(text) ? `\\${text}` : text;
}

// 取り込み側（markdownToBlocks）が読める形にそろえる。
// - 出典などのリンクを通常の形へ
// - 表は読める行へ（区切り行は捨て、セルは " | " でつなぐ。表のブロックは無い）
// - コードの囲みは ``` に統一する（~~~ や言語の後ろの説明は読めず、閉じ忘れると以降が全部コードになる）
function prepareMarkdown(markdown: string) {
  const lines = normalizeNewlines(markdown).split("\n");
  const out: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const opened = openFence(line);
    if (opened) {
      const body: string[] = [];
      while (++index < lines.length && !closesFence(lines[index], opened)) body.push(lines[index]);
      // 中身に ``` があっても閉じられないよう、中の最長のバッククォート列より長い囲みにする。
      const longest = Math.max(0, ...body.flatMap((text) => [...text.matchAll(/`+/g)].map((run) => run[0].length)));
      const quote = "`".repeat(Math.max(3, longest + 1));
      const language = (opened.info.trim().split(/\s+/)[0] ?? "").replace(/[^\w+#.-]/g, "").slice(0, 80);
      out.push(`${opened.indent}${quote}${language}`, ...body, `${opened.indent}${quote}`);
      continue;
    }
    if (startsTable(lines, index)) {
      out.push(escapeLineStart(splitRow(line).map(rewriteLine).join(" | ")));
      index++;
      while (index + 1 < lines.length && lines[index + 1].trim() && lines[index + 1].includes("|")) {
        out.push(escapeLineStart(splitRow(lines[++index]).map(rewriteLine).join(" | ")));
      }
      continue;
    }
    out.push(rewriteLine(line));
  }
  return out.join("\n");
}

// 子を持てる深さを超えた分は、同じ階層に並べ直す（超えると保存の検証で弾かれる）。
function clampDepth(blocks: NoteBlockNode[], level = 0): NoteBlockNode[] {
  return blocks.flatMap((block) =>
    level < LAST_NESTING_LEVEL
      ? [{ ...block, children: clampDepth(block.children, level + 1) }]
      : [{ ...block, children: [] }, ...clampDepth(block.children, level)],
  );
}

function countBlocks(blocks: NoteBlockNode[]): number {
  return blocks.reduce((sum, block) => sum + 1 + countBlocks(block.children), 0);
}

// 深さ優先（画面の上から下）の順で、先頭から count 個のブロックだけを残す。親は子より先に数えるので、木のまま成り立つ。
function takeBlocks(blocks: NoteBlockNode[], count: number): NoteBlockNode[] {
  let left = count;
  const walk = (list: NoteBlockNode[]): NoteBlockNode[] => {
    const kept: NoteBlockNode[] = [];
    for (const block of list) {
      if (left <= 0) break;
      left--;
      kept.push({ ...block, children: walk(block.children) });
    }
    return kept;
  };
  return walk(blocks);
}

const muted = { textColor: "gray" };

// 区切り線と、どの会話から保存したかを書いた段落。切り詰めたときは、その旨も書く。
function sourceBlocks({ conversationTitle, conversationUrl, savedAt }: AnswerSource, truncated: boolean): NoteBlockNode[] {
  const label = conversationLabel(conversationTitle);
  const content: unknown[] = [{ type: "text", text: 'Saved from the conversation "', styles: muted }];
  content.push(isHttpUrl(conversationUrl)
    ? { type: "link", href: conversationUrl, content: [{ type: "text", text: label, styles: muted }] }
    : { type: "text", text: label, styles: muted });
  content.push({
    type: "text",
    text: `" on ${formatDate(savedAt)}.${truncated ? " The answer was too long to save in full, so the end was left out." : ""}`,
    styles: muted,
  });
  return [
    { id: crypto.randomUUID(), type: "divider", props: {}, children: [] },
    { id: crypto.randomUUID(), type: "paragraph", props: {}, content, children: [] },
  ];
}

// 回答の Markdown から、新しいノートの題名とブロックを作る。ノートの上限（2000 ブロック、1 MiB）を超える長い回答は、本文をブロックの区切りで切り詰める。
// 最初の見出しが題名になったときは、同じ文字が本文の先頭に重ならないよう本文から外す。
export function answerToNoteContent(markdown: string, source: AnswerSource): { title: string; blocks: NoteBlockNode[] } {
  const lines = normalizeNewlines(markdown).split("\n");
  const found = analyze(lines);
  const title = pickTitle(found, source.conversationTitle);
  if (found.heading?.leading && title === found.heading.text) lines.splice(found.heading.line, 1);
  const body = clampDepth(markdownToBlocks(prepareMarkdown(lines.join("\n"))));

  const build = (keep: number, truncated: boolean) => [...takeBlocks(body, keep), ...sourceBlocks(source, truncated)];
  const fits = (blocks: NoteBlockNode[]) =>
    countBlocks(blocks) <= MAX_BLOCKS
    && new TextEncoder().encode(JSON.stringify({ title, icon: null, cover: null, coverPosition: null, blocks })).byteLength <= MAX_NOTE_BYTES - BYTE_MARGIN;

  const total = countBlocks(body);
  const whole = build(total, false);
  if (fits(whole)) return { title, blocks: whole };
  // 収まらないので、先頭から何ブロックまで残せるかを二分探索する（残す数が増えるほど大きくなる）。
  let low = 0;
  let high = total - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(build(middle, true))) low = middle;
    else high = middle - 1;
  }
  return { title, blocks: build(low, true) };
}
