import { MENTION_PAGE_ID } from "@/lib/note-mention";

// ノート埋め込みホワイトボードブロックの ID 検証（リーフモジュール）。
// note-document.ts と whiteboard/frames.ts の双方から参照されるため、whiteboard/scene.ts などの
// キャンバス系モジュールには依存しない（scene → formula → note-document との循環依存を防ぐ）。

export const MAX_WHITEBOARD_EMBED_PAGE_ID = 64;
export const MAX_WHITEBOARD_EMBED_FRAME_ID = 120;

const FRAME_ID_RE = /^[^\s)#\u0000-\u001f\u007f]+$/;

export function validWhiteboardEmbedPageId(value: unknown): value is string {
  return typeof value === "string" && (value === "" || (value.length <= MAX_WHITEBOARD_EMBED_PAGE_ID && MENTION_PAGE_ID.test(value)));
}

export function validWhiteboardEmbedFrameId(value: unknown): value is string {
  return typeof value === "string" && (value === "" || (value.length <= MAX_WHITEBOARD_EMBED_FRAME_ID && FRAME_ID_RE.test(value)));
}
