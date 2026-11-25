import { MENTION_PAGE_ID, notePageIdFromUrl } from "@/lib/note-mention";
import type { PageKind } from "@/lib/page-kinds";
import { pageCardOf } from "@/lib/whiteboard/links";
import { storedToScene } from "@/lib/whiteboard/scene";

// バックリンク（#189）：このページを指している自分のページ（ノートの「@」メンション・本文のページへのリンク、ホワイトボードの
// ページへのリンク・ページカード）と、このページを使った会話（ノートの AI パネルで始めた会話、発言に添付した会話）。
// サーバー（note-backlinks-server.ts）と画面（note-backlinks.tsx）で使う、prisma を読み込まない部分。

// 一度に返す数（ページ・会話それぞれ）。
export const BACKLINK_LIMIT = 50;

export type PageBacklink = { id: string; kind: PageKind; title: string; icon: string | null };
// messageId はこのページを添付した発言（新しいもの）。ノートの AI パネルで始めただけの会話は null（会話の末尾を開く）。
export type ChatBacklink = { id: string; title: string; icon: string | null; messageId: string | null };
export type NoteBacklinks = { pages: PageBacklink[]; chats: ChatBacklink[] };

const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

// ノートの本文の判定（「@」メンションと、アプリ内のページへのリンク）はサーバーの SQL と notePageIdFromUrl で行う（note-backlinks-server.ts）。

// ホワイトボードの要素が targetId のページを指しているか：要素のリンク（アプリ内のページ）か、ページカードの印。
// 消した要素・置けない種類の要素は見ない（画面に出すものと同じ storedToScene の結果）。
export function whiteboardLinksTo(data: unknown, targetId: string, origin: string): boolean {
  if (!MENTION_PAGE_ID.test(targetId)) return false;
  return storedToScene(data).elements.some((element) =>
    (typeof element.link === "string" && notePageIdFromUrl(element.link, origin) === targetId)
    || pageCardOf(element.customData)?.id === targetId);
}

// 保存が終わったページ。開いているページのバックリンクは、別のページの保存（メンションを書いてすぐ移ってきた場合など）の後に読み直す。
export const PAGE_SAVED_EVENT = "notefable:page-saved";

export function dispatchPageSaved(id: string) {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
  window.dispatchEvent(new CustomEvent<{ id: string }>(PAGE_SAVED_EVENT, { detail: { id } }));
}

// 応答（GET /api/pages/:id/backlinks）を確かめる。形が違う項目は捨てる。
export function parseNoteBacklinks(value: unknown): NoteBacklinks | null {
  if (!object(value) || !Array.isArray(value.pages) || !Array.isArray(value.chats)) return null;
  const pages = value.pages.filter((page): page is PageBacklink => object(page) && typeof page.id === "string" && typeof page.title === "string"
    && (typeof page.icon === "string" || page.icon === null));
  const chats = value.chats.filter((chat): chat is ChatBacklink => object(chat) && typeof chat.id === "string" && typeof chat.title === "string"
    && (typeof chat.icon === "string" || chat.icon === null) && (typeof chat.messageId === "string" || chat.messageId === null));
  return { pages, chats };
}
