import type { Block } from "@blocknote/core";
import { isEmojiIcon } from "@/lib/emoji-icon";
import { parseNoteFileUrl } from "@/lib/note-file-keys";
import type { NoteContent } from "@/types/notes";
import { msg, fmt } from "@/lib/i18n/translate";

export const NOTE_BLOCK_TYPES = ["paragraph", "heading", "bulletListItem", "numberedListItem", "checkListItem", "toggleListItem", "quote", "callout", "codeBlock", "divider", "table", "image", "file"] as const;
export const MAX_NOTE_BYTES = 1024 * 1024;
export const MAX_NOTE_TITLE = 200;

// Notion のカバーギャラリーに近いプリセット。任意 URL は受け付けず、キーだけを保存する。
export const NOTE_COVERS = {
  "gradient-sunset": "linear-gradient(135deg, #f6d365 0%, #fda085 100%)",
  "gradient-peach": "linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)",
  "gradient-mint": "linear-gradient(135deg, #d4fc79 0%, #96e6a1 100%)",
  "gradient-ocean": "linear-gradient(135deg, #89f7fe 0%, #66a6ff 100%)",
  "gradient-lavender": "linear-gradient(135deg, #e0c3fc 0%, #8ec5fc 100%)",
  "gradient-night": "linear-gradient(135deg, #30cfd0 0%, #330867 100%)",
  "solid-red": "#e16259",
  "solid-yellow": "#dfab01",
  "solid-green": "#4dab9a",
  "solid-blue": "#529cca",
  "solid-purple": "#9a6dd7",
  "solid-beige": "#e9e5e3",
} as const;
export type NoteCover = keyof typeof NOTE_COVERS;

// アップロード画像のカバーは「upload:page-covers/<所有者 ID>/<UUID>.<拡張子>」の形で保存する。
// 所有者 ID をパスに含め、他人の画像キーを自分のページに付け替えられないようにする。
const UPLOAD_COVER = /^upload:(page-covers\/([a-z0-9]{1,64})\/[0-9a-f-]{36}\.(?:jpg|png|webp|gif))$/;
// Vercel Functions の受信上限 4.5 MB に multipart の余白を残す。
export const MAX_COVER_BYTES = 4 * 1024 * 1024;

export function uploadedCoverPath(cover: unknown) {
  const match = typeof cover === "string" ? cover.match(UPLOAD_COVER) : null;
  return match ? { path: match[1], ownerId: match[2] } : null;
}

export function isPresetCover(cover: unknown): cover is NoteCover {
  return typeof cover === "string" && Object.hasOwn(NOTE_COVERS, cover);
}

export class NoteValidationError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validStyles(value: unknown) {
  if (!object(value)) return false;
  return Object.entries(value).every(([key, entry]) =>
    ["bold", "italic", "underline", "strike", "code"].includes(key) ? typeof entry === "boolean" :
      ["textColor", "backgroundColor"].includes(key) && typeof entry === "string" && /^[a-zA-Z]+$/.test(entry) && entry.length <= 32,
  );
}

function validInline(value: unknown, links = true): boolean {
  if (!Array.isArray(value)) return false;
  return value.every((entry) => {
    if (!object(entry)) return false;
    if (entry.type === "text") return typeof entry.text === "string" && validStyles(entry.styles);
    if (links && entry.type === "link" && typeof entry.href === "string") {
      try {
        const url = new URL(entry.href);
        return ["http:", "https:", "mailto:", "tel:"].includes(url.protocol) && validInline(entry.content, false);
      } catch { return false; }
    }
    return false;
  });
}

const validColor = (entry: unknown) => typeof entry === "string" && /^[a-zA-Z]+$/.test(entry) && entry.length <= 32;
const ALIGNMENTS = ["left", "center", "right", "justify"];

// 表ブロックの content（BlockNote の tableContent）。セルは本文の配列か、色・配置・結合を持つ tableCell。
// 行数・列数には上限を置かない（エディターで作れる・貼り付けられる表を保存で弾かない）。大きさはノート全体の 1 MiB で抑える。
function validTable(content: unknown) {
  if (!object(content) || content.type !== "tableContent") return false;
  if (!Object.keys(content).every((key) => ["type", "columnWidths", "headerRows", "headerCols", "rows"].includes(key))) return false;
  const { columnWidths, headerRows, headerCols, rows } = content;
  // 未設定の列幅は JSON では null になる。
  if (columnWidths !== undefined && !(Array.isArray(columnWidths)
    && columnWidths.every((width) => width === null || width === undefined || (typeof width === "number" && Number.isFinite(width) && width > 0 && width <= 4000)))) return false;
  // BlockNote は「すべてのセルが見出し」の行・列を数えるので、1 より大きくなることがある（見出し行が 2 つある表の貼り付けなど）。
  const count = (entry: unknown) => entry === undefined || (Number.isSafeInteger(entry) && Number(entry) >= 0);
  if (!count(headerRows) || !count(headerCols)) return false;
  if (!Array.isArray(rows) || !rows.length) return false;
  const span = (entry: unknown) => entry === undefined || (Number.isSafeInteger(entry) && Number(entry) >= 1);
  return rows.every((row) => object(row) && Object.keys(row).every((key) => key === "cells") && Array.isArray(row.cells) && row.cells.length > 0
    && row.cells.every((cell) => {
      if (Array.isArray(cell)) return validInline(cell);
      if (!object(cell) || cell.type !== "tableCell" || !validInline(cell.content) || !Object.keys(cell).every((key) => ["type", "props", "content"].includes(key))) return false;
      if (cell.props === undefined) return true;
      return object(cell.props) && Object.entries(cell.props).every(([key, entry]) =>
        key === "backgroundColor" || key === "textColor" ? validColor(entry) :
          key === "textAlignment" ? ALIGNMENTS.includes(String(entry)) :
            (key === "colspan" || key === "rowspan") && span(entry));
    }));
}

export function validateNoteContent(value: unknown): NoteContent {
  if (!object(value) || typeof value.title !== "string" || value.title.length > MAX_NOTE_TITLE) {
    throw new NoteValidationError(fmt("Note title must be at most {max} characters.", { max: MAX_NOTE_TITLE }));
  }
  const ids = new Set<string>();
  let count = 0;
  function validBlocks(blocks: unknown, depth: number): boolean {
    if (!Array.isArray(blocks) || depth > 8) return false;
    return blocks.every((block) => {
      if (++count > 2000 || !object(block) || typeof block.id !== "string" || !block.id || block.id.length > 120 || ids.has(block.id)) return false;
      ids.add(block.id);
      if (!NOTE_BLOCK_TYPES.some((type) => type === block.type) || !object(block.props)) return false;
      const props = block.props;
      const validProps = Object.entries(props).every(([key, entry]) => {
        if (["backgroundColor", "textColor"].includes(key)) return typeof entry === "string" && /^[a-zA-Z]+$/.test(entry) && entry.length <= 32;
        if (key === "textAlignment") return ["left", "center", "right", "justify"].includes(String(entry));
        if (key === "level") return block.type === "heading" && [1, 2, 3].includes(Number(entry)) && typeof entry === "number";
        if (key === "isToggleable") return block.type === "heading" && typeof entry === "boolean";
        if (key === "emoji") return block.type === "callout" && isEmojiIcon(entry);
        if (key === "checked") return block.type === "checkListItem" && typeof entry === "boolean";
        if (key === "start") return block.type === "numberedListItem" && Number.isInteger(entry) && Number(entry) > 0;
        if (key === "language") return block.type === "codeBlock" && typeof entry === "string" && entry.length <= 80;
        // 画像・ファイルブロック。url は自分のサービスのファイルだけ（空はアップロード前の空ブロック）。
        const media = block.type === "image" || block.type === "file";
        if (key === "url") return media && parseNoteFileUrl(entry) !== null;
        if (key === "name" || key === "caption") return media && typeof entry === "string" && entry.length <= (key === "name" ? 200 : 500) && !/[\u0000-\u001f\u007f]/.test(entry);
        if (key === "showPreview") return block.type === "image" && typeof entry === "boolean";
        if (key === "previewWidth") return block.type === "image" && typeof entry === "number" && Number.isFinite(entry) && entry >= 16 && entry <= 4000;
        return false;
      });
      if (!validProps) return false;
      if (block.type === "divider") {
        if (block.content !== undefined || Object.keys(props).length) return false;
      } else if (block.type === "table") {
        // 表は子ブロックを持たない。
        if (!validTable(block.content) || (block.children !== undefined && !(Array.isArray(block.children) && !block.children.length))) return false;
      } else if (block.type === "image" || block.type === "file") {
        if (block.content !== undefined) return false;
      } else if (block.type === "codeBlock") {
        if (!validInline(block.content, false) || !Array.isArray(block.content) || block.content.some((entry) => Object.keys(entry.styles).length)) return false;
      } else if (!validInline(block.content)) return false;
      return validBlocks(block.children ?? [], depth + 1);
    });
  }
  if (!validBlocks(value.blocks, 0)) throw new NoteValidationError(msg("This note contains an unsupported or invalid block."));
  // 旧クライアントや旧下書きには icon/cover がないため、未指定は null として扱う。
  const icon = value.icon ?? null;
  const cover = value.cover ?? null;
  if (icon !== null && !isEmojiIcon(icon)) throw new NoteValidationError(msg("Note icon must be a single emoji."));
  if (cover !== null && !isPresetCover(cover) && !uploadedCoverPath(cover)) throw new NoteValidationError(msg("Unsupported note cover."));
  const coverPosition = value.coverPosition ?? null;
  if (coverPosition !== null && !(Number.isInteger(coverPosition) && Number(coverPosition) >= 0 && Number(coverPosition) <= 100)) {
    throw new NoteValidationError(msg("Cover position must be between 0 and 100."));
  }
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_NOTE_BYTES) throw new NoteValidationError(msg("Note content exceeds 1 MiB."), 413);
  return { title: value.title.trim() || "Untitled", icon: icon as string | null, cover: cover as string | null, coverPosition: coverPosition as number | null, blocks: value.blocks as Block[] };
}

export const NOTE_META_FIELDS = ["icon", "cover", "coverPosition"] as const;

// 保存済みページから編集対象の本文だけを取り出す。
export function noteContentOf(page: NoteContent): NoteContent {
  return { title: page.title, icon: page.icon ?? null, cover: page.cover ?? null, coverPosition: page.coverPosition ?? null, blocks: page.blocks };
}

export async function readNoteRequest(request: Request) {
  // 実際の受信量も制限し、Content-Length がない場合も巨大な本文を読まない。
  const reader = request.body?.getReader();
  if (!reader) throw new NoteValidationError(msg("Request body is required."));
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_NOTE_BYTES) {
        await reader.cancel();
        throw new NoteValidationError(msg("Note content exceeds 1 MiB."), 413);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return body;
  } catch (error) {
    if (error instanceof NoteValidationError) throw error;
    throw new NoteValidationError(msg("Invalid JSON request."));
  } finally { reader.releaseLock(); }
}

export function validateNoteUpdate(value: unknown) {
  const content = validateNoteContent(value);
  if (!object(value) || !Number.isSafeInteger(value.version) || Number(value.version) < 0) throw new NoteValidationError(msg("A valid note version is required."));
  // 旧クライアントや旧下書きは icon/cover/coverPosition を送らない。送られた項目だけを更新し、
  // 省略された項目は保存済みの値を残す（null で上書きしない）。
  const present = NOTE_META_FIELDS.filter((key) => key in value);
  return { ...content, version: value.version as number, present };
}
