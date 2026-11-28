import { noteFileKeyParts } from "@/lib/note-file-keys";
import { MENTION_PAGE_ID } from "@/lib/note-mention";
import { walkBlocks } from "@/lib/note-text";
import {
  MAX_WHITEBOARD_EMBED_FRAME_ID,
  MAX_WHITEBOARD_EMBED_PAGE_ID,
  validWhiteboardEmbedFrameId,
  validWhiteboardEmbedPageId,
} from "@/lib/whiteboard/embed-id";
import { frameOrder } from "@/lib/whiteboard/export-utils";
import {
  isStoredFileUrl,
  pickWhiteboardAppState,
  WHITEBOARD_ELEMENT_TYPES,
  type WhiteboardAppState,
  type WhiteboardElement,
  type WhiteboardFiles,
} from "@/lib/whiteboard/scene";

// ホワイトボードの枠一覧・ノート埋め込みブロックの検証と抽出・オフスクリーン描画用の scene 整形。
// Excalidraw 本体や DOM を読み込まないため、サーバー・クライアント・テストのすべてから安全に使える。

export {
  MAX_WHITEBOARD_EMBED_FRAME_ID,
  MAX_WHITEBOARD_EMBED_PAGE_ID,
  validWhiteboardEmbedFrameId,
  validWhiteboardEmbedPageId,
};

const PUBLIC_SHARE_FILE_PATH = /^\/s\/([A-Za-z0-9_-]{8,64})\/file$/;

export type WhiteboardFrameInfo = {
  id: string;
  name: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type WhiteboardFileUrlMode = "owner" | "public";

export type NoteWhiteboardEmbedRef = {
  pageId: string;
  frameId: string | null;
};

export type WhiteboardEmbedMeta = {
  title: string;
  frames: ReadonlyMap<string, string>;
};

export type WhiteboardMetaMap = ReadonlyMap<string, WhiteboardEmbedMeta>;

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// 公開ページ（/s/:token/file?page=...&key=...）の相対 URL だけを通す。
// 外部 URL・data: URL・持ち主専用の /api/pages/files URL は通さない。
export function isPublicShareFileUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value.startsWith("/s/") || value.startsWith("//")) return false;
  try {
    const parsed = new URL(value, "http://notefable.local");
    if (parsed.origin !== "http://notefable.local") return false;
    if (!PUBLIC_SHARE_FILE_PATH.test(parsed.pathname)) return false;
    const page = parsed.searchParams.get("page");
    if (!page || !MENTION_PAGE_ID.test(page)) return false;
    return noteFileKeyParts(parsed.searchParams.get("key")) !== null;
  } catch {
    return false;
  }
}

function isAllowedFileUrl(value: unknown, mode: WhiteboardFileUrlMode): value is string {
  return mode === "public" ? isPublicShareFileUrl(value) : isStoredFileUrl(value);
}

// 保存済み（または公開用の）ホワイトボード本体を、オフスクリーン描画へ安全に渡せる形にする。
// fileUrlMode === "owner" は /api/pages/files?... のみ、fileUrlMode === "public" は /s/:token/file?... のみ許可する。
export function toRenderableScene(
  data: unknown,
  options?: { fileUrlMode?: WhiteboardFileUrlMode },
): { elements: WhiteboardElement[]; files: WhiteboardFiles; appState: WhiteboardAppState } {
  if (!object(data)) return { elements: [], files: {}, appState: {} };
  const mode = options?.fileUrlMode ?? "owner";
  const rawElements = Array.isArray(data.elements)
    ? data.elements.filter((element): element is WhiteboardElement =>
        object(element)
        && typeof element.id === "string"
        && element.id.length > 0
        && typeof element.type === "string"
        && WHITEBOARD_ELEMENT_TYPES.has(element.type)
        && element.isDeleted !== true)
    : [];
  // 公開埋め込みプレビューは外側の公開リンク（<Link>）の中で描く静止 SVG なので、
  // 要素の link（/app?view=pages&page=... 等）は落として入れ子 <a> や所有者 URL の露出を防ぐ。
  const elements = mode === "public"
    ? rawElements.map((element) => (element.link ? { ...element, link: null } : element))
    : rawElements;
  const used = new Set(
    elements
      .filter((element) => element.type === "image" && typeof element.fileId === "string")
      .map((element) => element.fileId as string),
  );
  const files: WhiteboardFiles = {};
  if (object(data.files)) {
    for (const [id, file] of Object.entries(data.files)) {
      if (!object(file) || !used.has(id)) continue;
      const url = isAllowedFileUrl(file.dataURL, mode) ? file.dataURL : isAllowedFileUrl(file.url, mode) ? file.url : null;
      if (!url) continue;
      files[id] = {
        ...file,
        id,
        mimeType: typeof file.mimeType === "string" ? file.mimeType : "image/png",
        dataURL: url,
      };
    }
  }
  return { elements, files, appState: pickWhiteboardAppState(data.appState) };
}

// 生きている枠（frame）を読む順（上から下・左から右）で列挙する。
export function listWhiteboardFrames(data: unknown): WhiteboardFrameInfo[] {
  if (!object(data) || !Array.isArray(data.elements)) return [];
  const raw: WhiteboardFrameInfo[] = [];
  for (const element of data.elements) {
    if (!object(element) || element.isDeleted === true || element.type !== "frame") continue;
    if (typeof element.id !== "string" || !element.id) continue;
    const x = typeof element.x === "number" && Number.isFinite(element.x) ? element.x : 0;
    const y = typeof element.y === "number" && Number.isFinite(element.y) ? element.y : 0;
    const width = typeof element.width === "number" && Number.isFinite(element.width) ? Math.abs(element.width) : 0;
    const height = typeof element.height === "number" && Number.isFinite(element.height) ? Math.abs(element.height) : 0;
    if (width <= 0 || height <= 0) continue;
    const name = typeof element.name === "string" && element.name.trim() ? element.name.trim() : null;
    raw.push({ id: element.id, name, x, y, width, height });
  }
  return frameOrder(raw);
}

export function findWhiteboardFrame(elements: readonly WhiteboardElement[], frameId: string): WhiteboardElement | null {
  if (!frameId) return null;
  return elements.find((element) => element.type === "frame" && element.id === frameId && element.isDeleted !== true) ?? null;
}

// ノートのブロック列（入れ子・段組みの中も含む）から、空でないホワイトボード埋め込み参照を文書順に取り出す。
export function extractNoteWhiteboardRefs(blocks: unknown): NoteWhiteboardEmbedRef[] {
  const out: NoteWhiteboardEmbedRef[] = [];
  for (const block of walkBlocks(blocks)) {
    if (block.type !== "whiteboard" || !object(block.props)) continue;
    const pageId = typeof block.props.pageId === "string" ? block.props.pageId.trim() : "";
    if (!pageId || !validWhiteboardEmbedPageId(pageId)) continue;
    const rawFrame = typeof block.props.frameId === "string" ? block.props.frameId.trim() : "";
    const frameId = rawFrame && validWhiteboardEmbedFrameId(rawFrame) ? rawFrame : null;
    out.push({ pageId, frameId });
  }
  return out;
}

export function extractNoteWhiteboardPageIds(blocks: unknown): string[] {
  return [...new Set(extractNoteWhiteboardRefs(blocks).map((ref) => ref.pageId))];
}
