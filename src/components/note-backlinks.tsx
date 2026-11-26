"use client";

import { MessageSquareText } from "lucide-react";
import { useEffect, useId, useState, type MouseEvent } from "react";
import { useT } from "@/components/i18n-provider";
import { NoteIcon } from "@/components/note-icon";
import { PageKindIcon } from "@/components/page-kind-icon";
import { NOTE_CHAT_SAVED_EVENT } from "@/components/page-assistant";
import { appHref } from "@/lib/hosts";
import { BACKLINKS_STALE_EVENT, parseNoteBacklinks, type NoteBacklinks } from "@/lib/note-backlinks";
import { PAGES_TRASHED_EVENT } from "@/lib/proposal-sync";

// 最初に見せる数（ページ・会話それぞれ）。残りは「+N 件」で広げる。
const COLLAPSED_COUNT = 5;
// 別のページの保存・更新・ゴミ箱が続いたとき、まとめて 1 回読み直す。
const REFRESH_DELAY_MS = 400;

// ノートの本文の下に出すバックリンク（#189）：このページを指している自分のページと、このページを使った会話。
// どちらも無い・読めなかった・開く手段が無い（古いアプリの埋め込み）ときは何も出さない。
// onOpenPage / onOpenChat を渡した方だけ出す。ブラウザでは Ctrl / ⌘ / Shift を押したクリックを新しいタブに任せる。
// embedded（アプリの WebView）ではリンク先へ移らず、いつもアプリに開いてもらう。
export function NoteBacklinksSection({ pageId, embedded = false, onOpenPage, onOpenChat }: {
  pageId: string;
  embedded?: boolean;
  onOpenPage?: (id: string) => void;
  onOpenChat?: (id: string, messageId?: string) => void;
}) {
  const t = useT();
  const headingId = useId();
  const [data, setData] = useState<{ pageId: string; backlinks: NoteBacklinks } | null>(null);
  const [expanded, setExpanded] = useState<{ pageId: string; pages: boolean; chats: boolean }>({ pageId, pages: false, chats: false });
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/pages/${encodeURIComponent(pageId)}/backlinks`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => (response.ok ? parseNoteBacklinks(await response.json()) : null))
      // 読めなかったときは前の結果も出さない（別のページのものを残さない）。
      .then((backlinks) => { if (!controller.signal.aborted) setData(backlinks ? { pageId, backlinks } : null); })
      .catch(() => { if (!controller.signal.aborted) setData(null); });
    return () => controller.abort();
  }, [pageId, reload]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => { clearTimeout(timer); timer = setTimeout(() => setReload((value) => value + 1), REFRESH_DELAY_MS); };
    // このページ自身の保存・更新では変わらない（自分へのリンクは数えない）。
    const onOtherPage = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: unknown; pageId?: unknown }>).detail;
      if ((detail?.pageId ?? detail?.id) !== pageId) schedule();
    };
    // 別のページの保存・ゴミ箱への移動と会話の変化（合図）、AI などによる書き換え、新しく作った・復元したページ、
    // ノートの AI パネルの会話。
    const listeners: [string, (event: Event) => void][] = [
      [BACKLINKS_STALE_EVENT, onOtherPage],
      ["notefable:page-updated", onOtherPage],
      ["notefable:page-created", onOtherPage],
      [PAGES_TRASHED_EVENT, schedule],
      [NOTE_CHAT_SAVED_EVENT, schedule],
    ];
    for (const [name, listener] of listeners) window.addEventListener(name, listener);
    return () => {
      clearTimeout(timer);
      for (const [name, listener] of listeners) window.removeEventListener(name, listener);
    };
  }, [pageId]);

  const backlinks = data?.pageId === pageId ? data.backlinks : null;
  const pages = onOpenPage ? backlinks?.pages ?? [] : [];
  const chats = onOpenChat ? backlinks?.chats ?? [] : [];
  if (!pages.length && !chats.length) return null;
  const open = expanded.pageId === pageId ? expanded : { pageId, pages: false, chats: false };
  const shownPages = open.pages ? pages : pages.slice(0, COLLAPSED_COUNT);
  const shownChats = open.chats ? chats : chats.slice(0, COLLAPSED_COUNT);
  // その場で開くか（false ならブラウザの既定の動き：新しいタブなど）。
  const handle = (event: MouseEvent, open: () => void) => {
    if (!embedded && (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0)) return;
    event.preventDefault();
    open();
  };

  return <section className="notes-backlinks" aria-labelledby={headingId}>
    <h2 id={headingId} className="notes-backlinks-title">{t("Backlinks")}</h2>
    {pages.length > 0 && <div className="notes-backlinks-group">
      <h3 className="notes-backlinks-label">{t("Pages")}</h3>
      <ul className="notes-backlinks-list">
        {shownPages.map((page) => {
          const title = page.title.trim() && page.title !== "Untitled" ? page.title : t("Untitled");
          return <li key={page.id}>
            <a className="notes-backlinks-item" href={`/app?view=pages&page=${encodeURIComponent(page.id)}`}
              onClick={(event) => handle(event, () => onOpenPage?.(page.id))}>
              <span className="notes-backlinks-icon" aria-hidden="true"><NoteIcon icon={page.icon} fallback={<PageKindIcon kind={page.kind} size={16} strokeWidth={1.8} />} /></span>
              <span className="notes-backlinks-name">{title}</span>
            </a>
          </li>;
        })}
      </ul>
      {pages.length > shownPages.length && <button type="button" className="notes-backlinks-more"
        onClick={() => setExpanded({ ...open, pages: true })}>{t("+{count} more", { count: pages.length - shownPages.length })}</button>}
    </div>}
    {chats.length > 0 && <div className="notes-backlinks-group">
      <h3 className="notes-backlinks-label">{t("Chats")}</h3>
      <ul className="notes-backlinks-list">
        {shownChats.map((chat) => <li key={chat.id}>
          <a className="notes-backlinks-item" href={appHref(`?${new URLSearchParams(chat.messageId ? { chat: chat.id, message: chat.messageId } : { chat: chat.id })}`)}
            onClick={(event) => handle(event, () => onOpenChat?.(chat.id, chat.messageId ?? undefined))}>
            <span className="notes-backlinks-icon" aria-hidden="true">{chat.icon ?? <MessageSquareText size={16} strokeWidth={1.8} />}</span>
            <span className="notes-backlinks-name">{chat.title}</span>
          </a>
        </li>)}
      </ul>
      {chats.length > shownChats.length && <button type="button" className="notes-backlinks-more"
        onClick={() => setExpanded({ ...open, chats: true })}>{t("+{count} more", { count: chats.length - shownChats.length })}</button>}
    </div>}
  </section>;
}
