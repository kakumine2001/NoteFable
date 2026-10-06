import type { Block } from "@blocknote/core";
import type { NoteContent } from "@/types/notes";

export const NOTE_BLOCK_TYPES = ["paragraph", "heading", "bulletListItem", "numberedListItem", "checkListItem", "quote", "codeBlock", "divider"] as const;
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

function validIcon(value: unknown) {
  // 絵文字 1 つ分（肌色や ZWJ 結合を含む）だけを許可する。
  return typeof value === "string" && value.length <= 16 && /^\p{Extended_Pictographic}/u.test(value) && !/\s/.test(value);
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

export function validateNoteContent(value: unknown): NoteContent {
  if (!object(value) || typeof value.title !== "string" || value.title.length > MAX_NOTE_TITLE) {
    throw new NoteValidationError(`Page title must be at most ${MAX_NOTE_TITLE} characters.`);
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
        if (key === "isToggleable") return block.type === "heading" && entry === false;
        if (key === "checked") return block.type === "checkListItem" && typeof entry === "boolean";
        if (key === "start") return block.type === "numberedListItem" && Number.isInteger(entry) && Number(entry) > 0;
        if (key === "language") return block.type === "codeBlock" && typeof entry === "string" && entry.length <= 80;
        return false;
      });
      if (!validProps) return false;
      if (block.type === "divider") {
        if (block.content !== undefined || Object.keys(props).length) return false;
      } else if (block.type === "codeBlock") {
        if (!validInline(block.content, false) || !Array.isArray(block.content) || block.content.some((entry) => Object.keys(entry.styles).length)) return false;
      } else if (!validInline(block.content)) return false;
      return validBlocks(block.children ?? [], depth + 1);
    });
  }
  if (!validBlocks(value.blocks, 0)) throw new NoteValidationError("This page contains an unsupported or invalid block.");
  // 旧クライアントや旧下書きには icon/cover がないため、未指定は null として扱う。
  const icon = value.icon ?? null;
  const cover = value.cover ?? null;
  if (icon !== null && !validIcon(icon)) throw new NoteValidationError("Page icon must be a single emoji.");
  if (cover !== null && !(typeof cover === "string" && Object.hasOwn(NOTE_COVERS, cover))) throw new NoteValidationError("Unsupported page cover.");
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_NOTE_BYTES) throw new NoteValidationError("Page content exceeds 1 MiB.", 413);
  return { title: value.title.trim() || "Untitled", icon: icon as string | null, cover: cover as string | null, blocks: value.blocks as Block[] };
}

// 保存済みページから編集対象の本文だけを取り出す。
export function noteContentOf(page: NoteContent): NoteContent {
  return { title: page.title, icon: page.icon ?? null, cover: page.cover ?? null, blocks: page.blocks };
}

export async function readNoteRequest(request: Request) {
  // 実際の受信量も制限し、Content-Length がない場合も巨大な本文を読まない。
  const reader = request.body?.getReader();
  if (!reader) throw new NoteValidationError("Request body is required.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_NOTE_BYTES) {
        await reader.cancel();
        throw new NoteValidationError("Page content exceeds 1 MiB.", 413);
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
    throw new NoteValidationError("Invalid JSON request.");
  } finally { reader.releaseLock(); }
}

export function validateNoteUpdate(value: unknown) {
  const content = validateNoteContent(value);
  if (!object(value) || !Number.isSafeInteger(value.version) || Number(value.version) < 0) throw new NoteValidationError("A valid page version is required.");
  return { ...content, version: value.version as number };
}
