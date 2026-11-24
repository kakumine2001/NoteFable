import type { ActivityEvent } from "@/lib/chat-activity";

// 「自動適用」で、確認なしに適用された AI の提案がチャットの流れで届いたとき、開いているページの編集と一覧を最新にそろえる。
// カードの「適用」を押したときと同じブラウザのイベント（use-note-pages.ts が受け取る）を出す。
// 適用はサーバーで済んでいるので、ここではページを読み直すだけ。同じ提案は 1 回だけ。

// AI の提案を元に戻して、作ったページ（とサブページ）がゴミ箱へ移ったことを知らせるイベント。detail は { ids }。
export const PAGES_TRASHED_EVENT = "notefable:pages-trashed";

// AI の提案で作ったページを元に戻す（ゴミ箱へ移す）前に出すイベント。受け手（use-note-pages.ts）は、そのページとサブページの
// 入力中の内容を保存する Promise（保存できたら true）を waits に入れる。
export const PAGES_WILL_TRASH_EVENT = "notefable:pages-will-trash";
export type PagesWillTrashDetail = { ids: string[]; waits: Promise<boolean>[] };

// ゴミ箱へ移す前に、開いている編集を保存する。どれかを保存できなければ false（未保存の内容を捨てないよう、移すのをやめる）。
export async function saveBeforeTrash(ids: string[]): Promise<boolean> {
  const detail: PagesWillTrashDetail = { ids, waits: [] };
  window.dispatchEvent(new CustomEvent(PAGES_WILL_TRASH_EVENT, { detail }));
  const results = await Promise.all(detail.waits.map((wait) => wait.catch(() => false)));
  return results.every(Boolean);
}

const synced = new Set<string>();
// 読み直しを試す間隔（通信やサーバーの一時的な失敗のあと）。
const RETRY_DELAYS_MS = [1_000, 3_000, 8_000];

async function readPage(pageId: string): Promise<unknown | null> {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(`/api/pages/${encodeURIComponent(pageId)}`, { cache: "no-store" });
      // ページが無い（ゴミ箱へ移した・消した）なら、読み直しても変わらない。
      if (response.status === 404) return null;
      if (response.ok) return ((await response.json()) as { page?: unknown }).page ?? null;
    } catch { /* 通信の失敗。少し待ってからもう一度。 */ }
    if (attempt >= RETRY_DELAYS_MS.length) return null;
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
  }
}

export function syncAutoAppliedProposal(event: ActivityEvent) {
  if (event.type !== "proposal" && event.type !== "create_proposal") return;
  if (event.status !== "applied" || !event.autoApplied || synced.has(event.id)) return;
  const pageId = event.type === "proposal" ? event.pageId : event.appliedPageId;
  if (!pageId) return;
  synced.add(event.id);
  void readPage(pageId).then((page) => {
    // 読み直せなかった（何度か試しても）。次に同じ提案が届いたときにもう一度試せるようにする（開き直せば最新が読まれる）。
    if (!page) { synced.delete(event.id); return; }
    window.dispatchEvent(new CustomEvent(event.type === "proposal" ? "notefable:page-updated" : "notefable:page-created", { detail: page }));
  });
}
