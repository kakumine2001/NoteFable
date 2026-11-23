import type { ActivityEvent } from "@/lib/chat-activity";

// 「自動適用」で、確認なしに適用された AI の提案がチャットの流れで届いたとき、開いているページの編集と一覧を最新にそろえる。
// カードの「適用」を押したときと同じブラウザのイベント（use-note-pages.ts が受け取る）を出す。
// 適用はサーバーで済んでいるので、ここではページを読み直すだけ。同じ提案は 1 回だけ。

// AI の提案を元に戻して、作ったページ（とサブページ）がゴミ箱へ移ったことを知らせるイベント。detail は { ids }。
export const PAGES_TRASHED_EVENT = "notefable:pages-trashed";

const synced = new Set<string>();

export function syncAutoAppliedProposal(event: ActivityEvent) {
  if (event.type !== "proposal" && event.type !== "create_proposal") return;
  if (event.status !== "applied" || !event.autoApplied || synced.has(event.id)) return;
  synced.add(event.id);
  const pageId = event.type === "proposal" ? event.pageId : event.appliedPageId;
  if (!pageId) return;
  void fetch(`/api/pages/${encodeURIComponent(pageId)}`, { cache: "no-store" })
    .then((response) => (response.ok ? response.json() : null))
    .then((data: { page?: unknown } | null) => {
      if (!data?.page) return;
      window.dispatchEvent(new CustomEvent(event.type === "proposal" ? "notefable:page-updated" : "notefable:page-created", { detail: data.page }));
    })
    .catch(() => { /* 読み直せなくても、次に開いたときに最新が読まれる。 */ });
}
