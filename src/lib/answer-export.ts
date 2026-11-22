import { MAX_NOTE_BYTES, MAX_NOTE_TITLE } from "@/lib/note-document";
import { prepareMath } from "@/lib/math-markdown";
import { MAX_PARSED_TABLE_CELLS, TABLE_SEPARATOR, escapeCellPipes, inlineMathEnd, markdownToBlocks, splitTableRow as splitRow } from "@/lib/note-markdown";

// 回答のコピー・ノート保存と、会話全体の Markdown 書き出しに使う純粋な変換。

type NoteBlockNode = ReturnType<typeof markdownToBlocks>[number];
export type AnswerSource = {
  // 回答があった会話のタイトルと、そこへ戻るリンク。
  conversationTitle: string;
  conversationUrl: string;
  savedAt: Date;
  // 出典の段落で、切り詰めたものを何と呼ぶか（既定は回答。Create page は会話から書いたページ）。
  subject?: "answer" | "page";
  // モデルが出力の上限で書き終える前に止まった。ノートの上限で切り詰めたときと同じ断り書きを付ける。
  cutOff?: boolean;
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
    .replace(/\\([\\`*_{}[\]()#+\-.!~>|$])/g, "$1")
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
  // raw は見出し行の「# 」より後ろをそのまま（書式を外す前）。取り込むファイルの題名に使う。
  heading: { text: string; raw: string; line: number; leading: boolean } | null;
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
      if (label) return { heading: { text: label, raw: heading[1].trim(), line: index, leading: !seenContent }, firstLine };
      seenContent = true;
      continue;
    }
    seenContent = true;
    if (!firstLine) {
      const label = stripInline(text);
      // 区切り線や表の罫線のように、記号だけの行は題名にしない。
      if (!/^[\s\-_*=#>|:~`+.$]*$/.test(label)) firstLine = label;
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
// 形は /c/<会話>?message=<メッセージ>（proxy がワークスペースの /?chat=…&message=… へ送る。Android は App Links でこの形を App で開く）。
// 以前の /?chat=… のリンクも引き続き開ける。
export function answerConversationUrl(origin: string, sessionId: string, messageId?: string | null) {
  const stored = messageId && isStoredMessageId(messageId) ? messageId : null;
  const query = stored ? `?${new URLSearchParams({ message: stored })}` : "";
  return `${origin}/c/${encodeURIComponent(sessionId)}${query}`;
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

export type ConversationMessage = {
  role: string;
  content: string;
  attachments?: readonly { filename: string; dataUrl?: string }[];
  generatedImages?: readonly { id: string; dataUrl: string }[];
};

// 履歴 API の順序のまま全ユーザー発言・回答を書き出す。本文は切り詰めず、内部メッセージは含めない。
export function conversationToMarkdownFile(messages: readonly ConversationMessage[], source: AnswerSource) {
  function attachment(label: string, url?: string) {
    const name = escapeLabel(label.replace(/\s+/g, " ").trim());
    if (url) {
      try {
        const href = new URL(url, source.conversationUrl).href;
        if (isHttpUrl(href)) return `- [${name}](<${href}>)`;
      } catch { /* URL を作れない添付もファイル名は残す。 */ }
    }
    return `- ${name}`;
  }
  const sections = messages.filter(message => message.role === "USER" || message.role === "ASSISTANT").map(message => {
    const files = [
      ...(message.attachments ?? []).map(file => attachment(file.filename, file.dataUrl)),
      ...(message.generatedImages ?? []).map((image, index) => attachment(`Generated image ${index + 1}`, image.dataUrl)),
    ];
    const body = [normalizeNewlines(message.content).trimEnd(), files.join("\n")].filter(Boolean).join("\n\n");
    return `## ${message.role === "USER" ? "You" : "NoteFable"}\n\n${body}`;
  });
  const title = escapeLabel(shorten(source.conversationTitle, MAX_NOTE_TITLE) || "New chat");
  return answerToMarkdownFile([`# ${title}`, ...sections].join("\n\n"), source);
}

// ---- ノートへの保存 ----

// [テキスト](URL) と ![代替文](URL)。URL は <…>（空白を含められる）、または丸括弧が釣り合った文字列で、"タイトル" が付いてもよい。
const LINK = /(!?)\[([^\]]*)\]\(\s*(<[^>\n]*>|(?:[^\s()]|\((?:[^\s()]|\([^\s()]*\))*\))*)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;

// 取り込み側は URL 中の空白と ) を扱えないので、同じ意味のままパーセントエンコードする。
function encodeHref(href: string) {
  return href.replace(/\s/g, encodeURIComponent).replace(/\(/g, "%28").replace(/\)/g, "%29");
}

// 回答の出典は [タイトル](<URL>) の形で終わるが、取り込み側は <…> を読めない。通常の [タイトル](URL) に書き直す。
function rewriteSingleLink(text: string) {
  return text.replace(LINK, (_match, bang: string, label: string, destination: string) => {
    const href = encodeHref(destination.startsWith("<") ? destination.slice(1, -1) : destination);
    // 画像はノートの画像ブロックにできない（外部の URL）ので、リンクにする。
    return `[${label || (bang ? "Image" : href)}](${href})`;
  });
}

function rewriteLinks(text: string) {
  return rewriteSingleLink(text)
    .replace(/<(https?:\/\/[^\s<>]+)>/g, (_match, url: string) => `[${url}](${encodeHref(url)})`);
}

const LINK_AT = new RegExp(LINK.source, "y");
const AUTOLINK_AT = /<https?:\/\/[^\s<>]+>/y;
const BARE_URL_AT = /https?:\/\/[^\s<>]+/y;

// コードの範囲（`…`）と行内の数式（$…$、$$…$$）には手を入れずに、それ以外の部分だけ書き直す。
// URL やリンク先の中の $ は数式として切らない（<https://example.com/$user$/profile> を壊さないため）。
function rewriteLine(line: string) {
  let out = "";
  let plain = "";
  const flush = () => { out += rewriteLinks(plain); plain = ""; };
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === "\\" && index + 1 < line.length) {
      plain += char + line[++index];
    } else if (char === "`") {
      const code = /`[^`]*`/y;
      code.lastIndex = index;
      const hit = code.exec(line);
      if (hit) { flush(); out += hit[0]; index += hit[0].length - 1; } else plain += char;
    } else if (char === "[" || char === "!") {
      LINK_AT.lastIndex = index;
      const hit = LINK_AT.exec(line);
      // リンクのラベル内（例: [`<https://example.com>`](https://other.com)）には自動リンク変換をかけない。
      if (hit) { flush(); out += rewriteSingleLink(hit[0]); index += hit[0].length - 1; } else plain += char;
    } else if (char === "<") {
      AUTOLINK_AT.lastIndex = index;
      const hit = AUTOLINK_AT.exec(line);
      if (hit) { flush(); out += rewriteLinks(hit[0]); index += hit[0].length - 1; } else plain += char;
    } else if (char === "h") {
      BARE_URL_AT.lastIndex = index;
      const hit = BARE_URL_AT.exec(line);
      // 裸の URL に含まれる $（例: https://example.com/$user$/profile）は、markdownToBlocks が数式と誤認しないよう退避する。
      if (hit) { flush(); out += hit[0].replace(/\$/g, "\\$"); index += hit[0].length - 1; } else plain += char;
    } else if (char === "$" && inlineMathEnd(line, index) > 0) {
      const end = inlineMathEnd(line, index);
      flush();
      out += line.slice(index, end);
      index = end - 1;
    } else plain += char;
  }
  flush();
  return out;
}

function startsTable(lines: string[], index: number) {
  const header = lines[index];
  const separator = lines[index + 1];
  return header.includes("|") && separator !== undefined && separator.includes("|") && TABLE_SEPARATOR.test(separator)
    && splitRow(header, { protectMath: false }).length === splitRow(separator, { protectMath: false }).length;
}

// 表のセル内の \| を | に戻す。ただし数式（$…$、$$…$$）の中の \|（ノルム記号など）はそのまま保つ。
function unescapeNonMathPipes(text: string) {
  let out = "";
  for (let index = 0; index < text.length; index++) {
    if (text[index] === "\\" && text[index + 1] === "|") { out += "|"; index++; continue; }
    if (text[index] === "\\" && index + 1 < text.length) { out += text[index] + text[++index]; continue; }
    if (text[index] === "$") {
      const end = inlineMathEnd(text, index);
      if (end > 0) { out += text.slice(index, end); index = end - 1; continue; }
    }
    out += text[index];
  }
  return out;
}

const INDENTED_CODE = /^(?: {4,}| {0,3}\t)\s*\S/;
const LIST_ITEM_LINE = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;

function emitCodeFence(out: string[], indent: string, language: string, body: string[]) {
  // 取り込むファイルは何十万行にもなるので、行を引数に展開しない（引数の数の上限で RangeError になる）。
  let longest = 0;
  for (const text of body) for (const run of text.matchAll(/`+/g)) longest = Math.max(longest, run[0].length);
  const quote = "`".repeat(Math.max(3, longest + 1));
  out.push(`${indent}${quote}${language}`);
  for (const text of body) out.push(text);
  out.push(`${indent}${quote}`);
}

// 取り込み側（markdownToBlocks）が読める形にそろえる。
// - 表は GFM のセル境界で先に分けてから各セルごとに inlineOnly で prepareMath をかける（金額の | や $$E=mc^2$$ で行が割れないようにする）
// - 4 スペース字下げのコードブロック（リスト外）はコード囲みにして、中の $x$ が数式として解釈されないようにする
// - 表以外の本文は prepareMath で、チャットの画面と同じ書き方（$…$、$$ の行）にそろえる
// - 出典などのリンクを通常の形へ
// - コードの囲みは ``` に統一する（~~~ や言語の後ろの説明は読めず、閉じ忘れると以降が全部コードになる）
export function prepareNoteMarkdown(markdown: string) {
  return prepareMarkdown(markdown);
}

// ブロックの入れ子の深さをノート保存の上限内に収め、必要なら先頭から切り詰める。
export function fitMarkdownBlocksToNote(title: string, markdown: string): { blocks: NoteBlockNode[]; truncated: boolean } {
  const body = clampDepth(markdownToBlocks(prepareMarkdown(markdown)));
  const fits = (blocks: NoteBlockNode[]) =>
    countBlocks(blocks) <= MAX_BLOCKS
    && new TextEncoder().encode(JSON.stringify({ title, icon: null, cover: null, coverPosition: null, blocks })).byteLength <= MAX_NOTE_BYTES - BYTE_MARGIN;
  const total = countBlocks(body);
  if (fits(body)) return { blocks: body, truncated: false };
  let low = 0;
  let high = total - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(takeBlocks(body, middle))) low = middle;
    else high = middle - 1;
  }
  return { blocks: takeBlocks(body, low), truncated: true };
}

// 取り込むファイルの題名。回答の題名（80 文字）と違い、書き出したノートの題名がそのまま戻るよう、ノートの上限（200 文字）まで残す。
export function extractLeadingHeadingTitle(markdown: string, fallback: string): { title: string; body: string } {
  const lines = normalizeNewlines(markdown).split("\n");
  const found = analyze(lines);
  if (found.heading?.leading) {
    // 題名は書式を持たない文字列。「1. 手順」や「**太字** 案」のような題名が書き出し → 取り込みで変わらないよう、
    // 回答の題名のように書式を外さず、書き出し側（noteToMarkdownFile）が付けた \ のエスケープだけを戻す。
    const title = shorten(found.heading.raw.replace(/\\([\\`*_[\]<>~#])/g, "$1"), MAX_NOTE_TITLE);
    lines.splice(found.heading.line, 1);
    return { title: title || shorten(fallback, MAX_NOTE_TITLE) || "Untitled", body: lines.join("\n") };
  }
  const cleanFallback = shorten(fallback, MAX_NOTE_TITLE);
  if (cleanFallback) return { title: cleanFallback, body: lines.join("\n") };
  return { title: pickTitle(found, "Untitled"), body: lines.join("\n") };
}

function prepareMarkdown(markdown: string) {
  const rawLines = normalizeNewlines(markdown).split("\n");
  const out: string[] = [];
  let prose: string[] = [];
  const flushProse = () => {
    if (!prose.length) return;
    const prepared = prepareMath(prose.join("\n"), { doubleBeforeDigit: true }).text.split("\n");
    prose = [];
    for (let i = 0; i < prepared.length; i++) {
      const line = prepared[i];
      // 「$$ だけの行」または引用内の「> $$」で囲まれたブロックの数式は、そのまま通す（空行やコード囲みで打ち切る）。
      const quoteMatch = /^(\s*(?:>\s?)*)\$\$\s*$/.exec(line);
      if (quoteMatch) {
        const quoted = quoteMatch[1].includes(">");
        let close = -1;
        for (let k = i + 1; k < prepared.length; k++) {
          const inner = quoted ? (/^\s*>\s?(.*)$/.exec(prepared[k])?.[1] ?? null) : prepared[k];
          if (inner === null || !inner.trim() || openFence(inner)) break;
          if (inner.trim() === "$$") { close = k; break; }
        }
        if (close > i) {
          out.push(...prepared.slice(i, close + 1));
          i = close;
          continue;
        }
      }
      out.push(rewriteLine(line));
    }
  };
  let afterBreak = true;
  let inList = false;
  for (let index = 0; index < rawLines.length; index++) {
    const line = rawLines[index];
    const opened = openFence(line);
    if (opened) {
      flushProse();
      const body: string[] = [];
      while (++index < rawLines.length && !closesFence(rawLines[index], opened)) body.push(rawLines[index]);
      const language = (opened.info.trim().split(/\s+/)[0] ?? "").replace(/[^\w+#.-]/g, "").slice(0, 80);
      emitCodeFence(out, opened.indent, language, body);
      afterBreak = true;
      continue;
    }
    // CommonMark の 4 スペース字下げコードブロックをコード囲みにそろえ、markdownToBlocks の字下げ除去で数式化されるのを防ぐ。
    if (afterBreak && !inList && INDENTED_CODE.test(line)) {
      flushProse();
      const body: string[] = [];
      while (index < rawLines.length && (rawLines[index].trim() === "" || INDENTED_CODE.test(rawLines[index]))) {
        body.push(rawLines[index].replace(/^(?: {4}| {0,3}\t)/, ""));
        index++;
      }
      while (body.length && !body[body.length - 1].trim()) body.pop();
      emitCodeFence(out, "", "", body);
      index--;
      afterBreak = true;
      continue;
    }
    if (startsTable(rawLines, index)) {
      flushProse();
      const start = index;
      const rows = [splitRow(line, { protectMath: false, unescapePipes: false })];
      index++;
      while (index + 1 < rawLines.length && rawLines[index + 1].trim() && rawLines[index + 1].includes("|")) {
        rows.push(splitRow(rawLines[++index], { protectMath: false, unescapePipes: false }));
      }
      const columns = rows[0].length;
      // 列をそろえた後のセル数が取り込み側の上限を超える表は、そろえずに元の行のまま渡す（取り込み側も表にしない）。
      // 先にそろえると、行数 × 見出しの列数のセルを作ってメモリを使い切る。
      if (rows.length * columns > MAX_PARSED_TABLE_CELLS) {
        for (let at = start; at <= index; at++) out.push(rewriteLine(rawLines[at]));
        afterBreak = false;
        continue;
      }
      const cell = (value: string) => escapeCellPipes(rewriteLine(
        unescapeNonMathPipes(prepareMath(value, { doubleBeforeDigit: true, inlineOnly: true }).text).replace(/\n/g, " "),
      ));
      const row = (cells: string[]) => `| ${Array.from({ length: columns }, (_, column) => cell(cells[column] ?? "")).join(" | ")} |`;
      out.push(row(rows[0]), `| ${Array.from({ length: columns }, () => "---").join(" | ")} |`);
      for (let at = 1; at < rows.length; at++) out.push(row(rows[at]));
      afterBreak = false;
      continue;
    }
    const blank = line.trim() === "";
    if (LIST_ITEM_LINE.test(line)) inList = true;
    else if (/^ ?\S/.test(line)) inList = false;
    afterBreak = blank;
    prose.push(line);
  }
  flushProse();
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
function sourceBlocks({ conversationTitle, conversationUrl, savedAt, subject = "answer", cutOff = false }: AnswerSource, truncated: boolean): NoteBlockNode[] {
  const label = conversationLabel(conversationTitle);
  const content: unknown[] = [{ type: "text", text: 'Saved from the conversation "', styles: muted }];
  content.push(isHttpUrl(conversationUrl)
    ? { type: "link", href: conversationUrl, content: [{ type: "text", text: label, styles: muted }] }
    : { type: "text", text: label, styles: muted });
  content.push({
    type: "text",
    text: `" on ${formatDate(savedAt)}.${truncated || cutOff ? ` The ${subject} was too long to save in full, so the end was left out.` : ""}`,
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
