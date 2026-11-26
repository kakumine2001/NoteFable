import type { CanvasKind, PageKind } from "@/lib/page-kinds";
import { pageCardOf, pageLinkUrl } from "@/lib/whiteboard/links";
import { storedToScene } from "@/lib/whiteboard/scene";

// バックリンク（#189）：このページを指している自分のページ（ノートの「@」メンション・本文のページへのリンク、ホワイトボードの
// ページへのリンク・ページカード、スライドの文字のリンク）と、このページを使った会話（ノートの AI パネルで始めた会話、
// 発言に添付した会話）。サーバー（note-backlinks-server.ts・canvas-store.ts）と画面（note-backlinks.tsx）で使う、
// prisma を読み込まない部分。

// 一度に返す数（ページ・会話それぞれ）。
export const BACKLINK_LIMIT = 50;

export type PageBacklink = { id: string; kind: PageKind; title: string; icon: string | null };
// messageId はこのページを添付した発言（新しいもの）。ノートの AI パネルで始めただけの会話は null（会話の末尾を開く）。
export type ChatBacklink = { id: string; title: string; icon: string | null; messageId: string | null };
export type NoteBacklinks = { pages: PageBacklink[]; chats: ChatBacklink[] };

// NoteCanvas.links に残す数と 1 件の長さの上限（本体の大きさの上限の中で、列だけが膨らまないように）。
export const MAX_CANVAS_LINKS = 1000;
const MAX_CANVAS_LINK_CHARS = 2048;

const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

// ホワイトボード・スライドの本体が持つ、アプリ内のページへのリンクの候補（保存のたびに NoteCanvas.links に入れる）。
// ホワイトボードは要素のリンクとページカードの印（消した要素・置けない種類の要素は見ない：storedToScene と同じ）、
// スライドは文字のリンク（{ type: "link", attrs: { href } }）。どのオリジンへのリンクかは読む時に確かめるので、
// href のまま持つ（view=pages を含むものだけ）。深さに依存しないよう再帰は使わない。
// 追加した時のマイグレーション（20261126000000_note_canvas_links）が、同じ規則で今ある行を埋める。
export function extractCanvasLinks(kind: CanvasKind, data: unknown): string[] {
  const links = new Set<string>();
  const add = (href: unknown) => {
    if (links.size < MAX_CANVAS_LINKS && typeof href === "string" && href.length <= MAX_CANVAS_LINK_CHARS && href.includes("view=pages")) links.add(href);
  };
  if (kind === "whiteboard") {
    for (const element of storedToScene(data).elements) {
      add(element.link);
      const card = pageCardOf(element.customData);
      if (card) add(pageLinkUrl(card.id));
    }
  } else {
    const stack: unknown[] = [object(data) ? data.slides : null];
    while (stack.length) {
      const node = stack.pop();
      if (Array.isArray(node)) { for (let index = node.length - 1; index >= 0; index--) stack.push(node[index]); continue; }
      if (!object(node)) continue;
      if (node.type === "link" && object(node.attrs)) add(node.attrs.href);
      for (const value of Object.values(node)) if (typeof value === "object" && value !== null) stack.push(value);
    }
  }
  return [...links];
}

// 開いているページのバックリンクが古くなった合図。ページの保存・ゴミ箱への移動と、会話の変化で出す。
// detail.pageId はきっかけのページ（そのページ自身を開いている画面は読み直さない。自分へのリンクは数えない）。
export const BACKLINKS_STALE_EVENT = "notefable:backlinks-stale";

export function dispatchBacklinksStale(pageId?: string) {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
  window.dispatchEvent(new CustomEvent<{ pageId?: string }>(BACKLINKS_STALE_EVENT, { detail: { pageId } }));
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
