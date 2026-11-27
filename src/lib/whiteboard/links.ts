import { parseCanvasSegments } from "@/lib/canvas-document";
import { notePageIdFromUrl } from "@/lib/note-mention";
import { leadingText } from "@/lib/note-text";
import { isCanvasKind, type PageKind } from "@/lib/page-kinds";
import { WHITEBOARD_ELEMENT_TYPES } from "@/lib/whiteboard/scene";
import { wrapText } from "@/lib/whiteboard/text-measure";

// ホワイトボードの要素のリンク（Excalidraw の element.link）。アプリ内のページへのリンクは、ノートの本文のリンクと同じ形
// （/app?view=pages&page=<ID>）にして、押したらその場で開く（ノートのメンションと同じ動き）。
// ページカード（リンク先のページの題名とアイコンを出す付箋状の図形）は customData.notefablePage に { id, kind } を持つ。

const PAGE_ID = /^[A-Za-z0-9_-]{1,64}$/;
export const MAX_PAGE_CARD_BATCH = 200;
export const MAX_PAGE_CARD_SUMMARY = 140;

export function isValidPageCardId(id: unknown): id is string {
  return typeof id === "string" && PAGE_ID.test(id);
}

export function pageLinkUrl(id: string) {
  return `/app?view=pages&page=${encodeURIComponent(id)}`;
}

// アプリ内のページへのリンクなら、そのページの ID。
export function pageIdFromLink(link: string | null | undefined, origin: string) {
  if (!link) return null;
  return notePageIdFromUrl(link, origin);
}

// 要素に付けてよい外部リンク（http・https・mailto だけ。javascript: などは付けない）。前後の空白を落とし、スキームが無ければ https を足す。
export function normalizeExternalLink(value: string): string | null {
  const text = value.trim();
  if (!text || text.length > 2048 || /[\u0000-\u001f\u007f]/.test(text)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  try {
    const url = new URL(withScheme);
    if (!["http:", "https:", "mailto:"].includes(url.protocol)) return null;
    if (url.protocol !== "mailto:" && !url.hostname) return null;
    return url.toString();
  } catch { return null; }
}

export type PageCardData = { id: string; kind: PageKind };

export type PageCardPreview = {
  id: string;
  kind: PageKind;
  title: string;
  icon: string | null;
  summary: string;
  // 公開リンクでアップロード画像アイコンを使うときの URL（所有者側では icon から /api/pages/covers を組み立てる）。
  iconUrl?: string | null;
};

export function pageCardOf(customData: unknown): PageCardData | null {
  if (typeof customData !== "object" || customData === null) return null;
  const card = (customData as { notefablePage?: unknown }).notefablePage;
  if (typeof card !== "object" || card === null) return null;
  const { id, kind } = card as { id?: unknown; kind?: unknown };
  if (typeof id !== "string" || !PAGE_ID.test(id)) return null;
  return { id, kind: kind === "whiteboard" || kind === "slides" ? kind : "note" };
}

// カードに出す文字：アイコン（絵文字のときだけ）と題名。アップロードした画像のアイコンは文字にできないので、種類の記号を使う。
const KIND_GLYPHS: Record<string, string> = { note: "📄", whiteboard: "🧩", slides: "📊" };
export function pageCardLabel(page: { title: string; icon: string | null; kind?: string }, untitled: string) {
  const title = page.title.trim() && page.title !== "Untitled" ? page.title.trim() : untitled;
  const icon = page.icon && !page.icon.startsWith("upload:") ? page.icon : KIND_GLYPHS[page.kind ?? "note"] ?? KIND_GLYPHS.note;
  return `${icon} ${title}`;
}

export function pageCardMissingLabel(missingText: string) {
  return missingText;
}

// ホワイトボード本体（または要素一覧）に含まれる生きているページカードの参照先ページ ID（重複なし）。
export function whiteboardPageCardIds(data: unknown, limit = MAX_PAGE_CARD_BATCH): string[] {
  const list = Array.isArray(data)
    ? data
    : (typeof data === "object" && data !== null && Array.isArray((data as { elements?: unknown }).elements)
      ? (data as { elements: unknown[] }).elements
      : []);
  const seen = new Set<string>();
  for (const raw of list) {
    if (typeof raw !== "object" || raw === null) continue;
    const element = raw as { type?: unknown; isDeleted?: unknown; customData?: unknown };
    if (element.isDeleted === true) continue;
    if (typeof element.type === "string" && !WHITEBOARD_ELEMENT_TYPES.has(element.type)) continue;
    const card = pageCardOf(element.customData);
    if (!card || seen.has(card.id)) continue;
    seen.add(card.id);
    if (seen.size >= limit) break;
  }
  return [...seen];
}

// サロゲートペアの途中で切らず、短い要約を 1 行のプレーンテキストに整える。
function clipSummary(raw: string, limit = MAX_PAGE_CARD_SUMMARY): string {
  const normalized = raw.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length <= limit) return normalized;
  const cut = Math.max(1, limit - 1);
  const end = (normalized.charCodeAt(cut - 1) & 0xfc00) === 0xd800 ? cut - 1 : cut;
  return `${normalized.slice(0, end).trimEnd()}…`;
}

// ページカードのリアルタイム要約（表示専用：白板 JSON・書き出し・検索には入れない）。
export function extractPageCardSummary(kind: PageKind, blocks: unknown, segments: unknown, limit = MAX_PAGE_CARD_SUMMARY): string {
  if (isCanvasKind(kind)) {
    const parts: string[] = [];
    let length = 0;
    for (const segment of parseCanvasSegments(segments)) {
      const piece = segment.text.replace(/\s+/g, " ").trim();
      if (!piece) continue;
      parts.push(piece);
      length += piece.length + 3;
      if (length >= limit * 2) break;
    }
    return clipSummary(parts.join(" · "), limit);
  }
  return clipSummary(leadingText(blocks, limit * 2), limit);
}

// サーバー側でカードの文字を差し替えるときに、枠の幅に収まるよう折り返す。
export function wrapCardLabelText(label: string, containerWidth: number, fontSize = 18): string {
  const safeWidth = Number.isFinite(containerWidth) && containerWidth > 40 ? containerWidth - 20 : 240;
  const safeFont = Number.isFinite(fontSize) && fontSize > 6 ? fontSize : 18;
  return wrapText(label, safeFont, safeWidth).join("\n");
}
