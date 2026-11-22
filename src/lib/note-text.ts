// ノートのブロック JSON から文字列を取り出す純粋な関数（prisma を読み込まない）。
// 検索（search.ts）と意味検索の索引（note-embeddings.ts）が同じ取り出し方を使う。

export type BlockLike = { id?: unknown; content?: unknown; children?: unknown; type?: unknown };

// 文書の順（親 → 子 → 次の兄弟）にブロックを返す。深さに依存しないよう再帰は使わない。
export function* walkBlocks(blocks: unknown): Generator<BlockLike> {
  const stack: unknown[] = Array.isArray(blocks) ? [...blocks].reverse() : [];
  while (stack.length) {
    const block = stack.pop();
    if (!block || typeof block !== "object") continue;
    yield block as BlockLike;
    const children = (block as BlockLike).children;
    if (Array.isArray(children)) for (let index = children.length - 1; index >= 0; index--) stack.push(children[index]);
  }
}

// そのブロック自身の文字列（リンクの文字を含み、子ブロックは含まない）。装飾で区切られた語もつなげて探せる。
export function inlineText(content: unknown): string {
  if (Array.isArray(content)) return content.map(inlineText).join("");
  if (!content || typeof content !== "object") return "";
  const node = content as { type?: unknown; text?: unknown; content?: unknown; rows?: unknown; props?: unknown };
  // 「@」メンションは表示している文字（ページのタイトル、日付）。search.ts の MENTION_*_PATH と対。
  if (node.type === "mention") {
    const props = (node.props ?? {}) as { kind?: unknown; title?: unknown; date?: unknown };
    const label = props.kind === "date" ? props.date : props.title;
    return typeof label === "string" ? label : "";
  }
  // 表ブロックの本文は rows[].cells[] にある。セルは空白でつなぐ。
  if (Array.isArray(node.rows)) {
    return node.rows.flatMap((row) => { const cells = (row as { cells?: unknown } | null)?.cells; return Array.isArray(cells) ? cells.map(inlineText) : []; }).join(" ");
  }
  return (typeof node.text === "string" ? node.text : "") + inlineText(node.content);
}

const LEADING_CHARS = 400;

// ノート冒頭の本文（ブロックの文字列を空白でつないだもの）。一致するブロックが無いときのスニペットに使う。
export function leadingText(blocks: unknown, limit = LEADING_CHARS) {
  let text = "";
  for (const block of walkBlocks(blocks)) {
    const own = inlineText(block.content).trim();
    if (!own) continue;
    text += (text ? " " : "") + own;
    if (text.length >= limit) break;
  }
  return text;
}

// 指定した blockId から始まる本文を抜き出す（意味検索で一致したチャンクの抜粋を、現在の本文から直接作るため）。
export function excerptFromBlock(blocks: unknown, blockId: string | null, limit = LEADING_CHARS) {
  if (!blockId) return leadingText(blocks, limit);
  let found = false;
  let text = "";
  for (const block of walkBlocks(blocks)) {
    if (!found) {
      if (block.id !== blockId) continue;
      found = true;
    }
    const own = inlineText(block.content).trim();
    if (!own) continue;
    text += (text ? " " : "") + own;
    if (text.length >= limit) break;
  }
  return text || leadingText(blocks, limit);
}

// ---- 意味検索用のチャンク ----

export type NoteTextChunk = {
  chunkIndex: number;
  // チャンクの先頭にあるブロックの ID（検索結果から飛ぶ先）。ID のあるブロックが無ければ null。
  blockId: string | null;
  // 画面に出す抜粋の元（タイトルは含めない）。
  chunkText: string;
  // 埋め込みに渡す文字列（意味のあるタイトルを頭に付ける）。
  embedInput: string;
};

export const MAX_CHUNK_CHARS = 1000;
export const MIN_HEADING_SPLIT_CHARS = 250;
export const MAX_CHUNKS_PER_NOTE = 12;
export const MAX_STORED_CHUNK_TEXT = 1200;

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;

// 長すぎる 1 ブロックを、サロゲートペアの途中で切らずに分ける。
function sliceSafely(text: string, size: number): string[] {
  const pieces: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + size);
    if (end < text.length && isHighSurrogate(text.charCodeAt(end - 1))) end--;
    pieces.push(text.slice(start, end));
    start = end;
  }
  return pieces;
}

// タイトルと本文を、意味検索のために最大 12 個のチャンクに分ける。
// 連続するブロックを 1,000 文字まで 1 つにまとめ、見出しの前では（直前のチャンクが 250 文字以上なら）区切る。
// タイトルが空または Untitled のとき、タイトルは埋め込みの入力に含めない。本文もタイトルも無ければ空配列。
export function extractNoteChunks(title: string, blocks: unknown): NoteTextChunk[] {
  const cleanTitle = title.trim();
  const hasTitle = cleanTitle !== "" && cleanTitle !== "Untitled";
  const parts: { blockId: string | null; text: string }[][] = [];
  let current: { blockId: string | null; text: string }[] = [];
  let currentLength = 0;
  const flush = () => {
    if (current.length) parts.push(current);
    current = [];
    currentLength = 0;
  };
  for (const block of walkBlocks(blocks)) {
    const own = inlineText(block.content).trim();
    if (!own) continue;
    const blockId = typeof block.id === "string" && block.id ? block.id : null;
    const isHeading = block.type === "heading";
    if (current.length && isHeading && currentLength >= MIN_HEADING_SPLIT_CHARS) flush();
    for (const piece of own.length > MAX_CHUNK_CHARS ? sliceSafely(own, MAX_CHUNK_CHARS) : [own]) {
      if (current.length && currentLength + piece.length + 1 > MAX_CHUNK_CHARS) flush();
      current.push({ blockId, text: piece });
      currentLength += piece.length + (current.length > 1 ? 1 : 0);
    }
    if (parts.length >= MAX_CHUNKS_PER_NOTE) break;
  }
  flush();
  const limited = parts.slice(0, MAX_CHUNKS_PER_NOTE);
  if (!limited.length) return hasTitle ? [{ chunkIndex: 0, blockId: null, chunkText: "", embedInput: cleanTitle }] : [];
  return limited.map((group, chunkIndex) => {
    const body = group.map((part) => part.text).join(" ");
    return {
      chunkIndex,
      blockId: group.find((part) => part.blockId)?.blockId ?? null,
      chunkText: body.slice(0, MAX_STORED_CHUNK_TEXT),
      embedInput: hasTitle ? `${cleanTitle}\n\n${body}` : body,
    };
  });
}
