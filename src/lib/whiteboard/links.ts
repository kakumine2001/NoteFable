import { notePageIdFromUrl } from "@/lib/note-mention";

// ホワイトボードの要素のリンク（Excalidraw の element.link）。アプリ内のページへのリンクは、ノートの本文のリンクと同じ形
// （/app?view=pages&page=<ID>）にして、押したらその場で開く（ノートのメンションと同じ動き）。
// ページカード（リンク先のページの題名とアイコンを出す付箋状の図形）は customData.notefablePage に { id, kind } を持つ。

const PAGE_ID = /^[A-Za-z0-9_-]{1,64}$/;

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

export type PageCardData = { id: string; kind: string };

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
