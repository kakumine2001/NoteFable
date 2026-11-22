// ノートの「@」メンション（ページ・日付）の形と検証。エディター（note-mention.tsx）、保存時の検証（note-document.ts）、
// AI ツール用の Markdown（note-markdown.ts）で共有する。

export const MENTION_PAGE_ID = /^[A-Za-z0-9_-]{1,64}$/;
export const MAX_MENTION_TITLE = 200;

// 実在する暦日の YYYY-MM-DD か。
export function isNoteDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export type MentionProps = { kind: "page"; pageId: string; title: string; date: "" } | { kind: "date"; pageId: ""; title: ""; date: string };

// 保存する JSON の 1 つのインライン要素として正しいメンションか。BlockNote は propSchema の全項目を書くので、使わない項目は空文字。
export function validMention(entry: Record<string, unknown>) {
  if (!Object.keys(entry).every((key) => key === "type" || key === "props")) return false;
  const props = entry.props;
  if (typeof props !== "object" || props === null || Array.isArray(props)) return false;
  const value = props as Record<string, unknown>;
  if (!Object.keys(value).every((key) => ["kind", "pageId", "title", "date"].includes(key))) return false;
  const empty = (key: string) => value[key] === undefined || value[key] === "";
  if (value.kind === "page") {
    return typeof value.pageId === "string" && MENTION_PAGE_ID.test(value.pageId)
      && (empty("title") || (typeof value.title === "string" && value.title.length <= MAX_MENTION_TITLE && !/[\u0000-\u001f\u007f]/.test(value.title)))
      && empty("date");
  }
  if (value.kind === "date") return isNoteDate(value.date) && empty("pageId") && empty("title");
  return false;
}

export function pageMention(pageId: string, title: string): { type: "mention"; props: MentionProps } {
  return { type: "mention", props: { kind: "page", pageId, title: title.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, MAX_MENTION_TITLE), date: "" } };
}

export function dateMention(date: string): { type: "mention"; props: MentionProps } {
  return { type: "mention", props: { kind: "date", pageId: "", title: "", date } };
}

// 端末のその日の日付（YYYY-MM-DD）。offset 日ずらす。
export function localDate(offset = 0, now = new Date()) {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// Markdown での書き方（AI のツールが読み書きする）。ページは [@タイトル](page:ID)、日付は [@YYYY-MM-DD](date:YYYY-MM-DD)。
export function mentionHref(props: Record<string, unknown>) {
  return props.kind === "date" ? `date:${String(props.date)}` : `page:${String(props.pageId)}`;
}

export function mentionFromHref(href: string, label: string) {
  const page = /^page:([A-Za-z0-9_-]{1,64})$/.exec(href);
  if (page) return pageMention(page[1], label.replace(/^@/, ""));
  const date = /^date:(\d{4}-\d{2}-\d{2})$/.exec(href);
  if (date && isNoteDate(date[1])) return dateMention(date[1]);
  return null;
}

// 本文としての文字（検索のハイライト、コードへの変換など）。
export function mentionText(props: Record<string, unknown>) {
  return props.kind === "date" ? `@${String(props.date ?? "")}` : `@${String(props.title ?? "")}`;
}

// アプリ内のページの URL（?view=pages&page=ID）なら、そのページ ID。リンクを押した時にページを切り替えるのに使う。
export function notePageIdFromUrl(href: string, origin: string) {
  try {
    const url = new URL(href, origin);
    if (url.origin !== origin || url.searchParams.get("view") !== "pages") return null;
    const id = url.searchParams.get("page");
    return id && MENTION_PAGE_ID.test(id) ? id : null;
  } catch { return null; }
}
