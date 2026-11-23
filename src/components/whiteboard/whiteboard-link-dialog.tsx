"use client";

import { Globe, Link2Off } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/components/i18n-provider";
import { NoteIcon } from "@/components/note-icon";
import { PageKindIcon } from "@/components/page-kind-icon";
import type { MentionPage } from "@/components/note-mention";
import { useBackToClose } from "@/lib/use-back-to-close";
import { normalizeExternalLink } from "@/lib/whiteboard/links";

// ホワイトボードのリンク：選んだ図形をページ（ノート・ホワイトボード・スライド）か Web の URL につなぐ。
// mode="card" はページのカードを置く（Web の URL は選べない）。
// ページの一覧は渡されたもの（/app）を使い、無ければ（/note-embed）ここで読む。
export function WhiteboardLinkDialog({ mode, pages: given, currentPageId, initialUrl, onPickPage, onPickUrl, onRemove, onClose }: {
  mode: "link" | "card";
  pages?: MentionPage[];
  currentPageId: string;
  initialUrl?: string;
  onPickPage: (page: MentionPage) => void;
  onPickUrl?: (url: string) => void;
  onRemove?: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const [fetched, setFetched] = useState<MentionPage[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState("");
  const [url, setUrl] = useState(initialUrl ?? "");
  const [urlError, setUrlError] = useState(false);
  useBackToClose(true, onClose);
  useEffect(() => { ref.current?.showModal(); }, []);
  useEffect(() => {
    if (given) return;
    let cancelled = false;
    fetch("/api/pages", { cache: "no-store" }).then((response) => response.ok ? response.json() : null)
      .then((data: { pages?: MentionPage[] } | null) => {
        if (cancelled) return;
        if (data?.pages) setFetched(data.pages.map(({ id, kind, title, icon }) => ({ id, kind, title, icon })));
        else setFailed(true);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [given]);
  const pages = (given ?? fetched ?? []).filter((page) => page.id !== currentPageId);
  const query = filter.trim().toLocaleLowerCase();
  const shown = (query ? pages.filter((page) => page.title.toLocaleLowerCase().includes(query)) : pages).slice(0, 80);
  const loading = !given && !fetched && !failed;
  return <dialog ref={ref} onCancel={(event) => { event.preventDefault(); onClose(); }} aria-label={mode === "card" ? t("Link to a page") : t("Add link")} className="notes-dialog whiteboard-link-dialog">
    <h2 className="text-base font-semibold">{mode === "card" ? t("Link to a page") : t("Add link")}</h2>
    {mode === "card" && <p className="mt-1 text-sm text-[var(--notion-muted)]">{t("Place a card that opens the page.")}</p>}
    <input autoFocus value={filter} onChange={(event) => setFilter(event.target.value)} placeholder={t("Search pages")} aria-label={t("Search pages")} className="notes-dialog-input" />
    <div className="whiteboard-link-pages" role="listbox" aria-label={t("Pages")}>
      {loading && <p className="px-3 py-2 text-sm text-[var(--notion-muted)]">{t("Loading notes…")}</p>}
      {failed && <p className="px-3 py-2 text-sm text-[var(--notion-muted)]">{t("Failed to load notes.")}</p>}
      {!loading && !failed && shown.map((page) => <button key={page.id} type="button" role="option" aria-selected={false} className="notes-dialog-option" onClick={() => onPickPage(page)}>
        <span className="flex min-w-0 items-center gap-2">
          <span className="notes-move-icon" aria-hidden="true"><NoteIcon icon={page.icon} fallback={<PageKindIcon kind={page.kind} size={15} />} /></span>
          <span className="truncate">{page.title.trim() && page.title !== "Untitled" ? page.title : t("Untitled")}</span>
        </span>
      </button>)}
      {!loading && !failed && !shown.length && <p className="px-3 py-2 text-sm text-[var(--notion-muted)]">{t("No matching pages.")}</p>}
    </div>
    {mode === "link" && onPickUrl && <form className="whiteboard-link-url" onSubmit={(event) => {
      event.preventDefault();
      const normalized = normalizeExternalLink(url);
      if (!normalized) { setUrlError(true); return; }
      onPickUrl(normalized);
    }}>
      <h3 className="notes-dialog-subtitle">{t("Web link")}</h3>
      <div className="flex gap-2">
        <span className="whiteboard-link-url-icon" aria-hidden="true"><Globe size={15} /></span>
        <input value={url} onChange={(event) => { setUrl(event.target.value); setUrlError(false); }} placeholder="https://" aria-label={t("Web link")} className="notes-dialog-input !mt-0 flex-1" inputMode="url" dir="ltr" />
        <button type="submit" className="notion-button notion-button-primary">{t("Apply")}</button>
      </div>
      {urlError && <p role="alert" className="mt-1 text-sm text-[#b91c1c]">{t("Enter a valid http or https link.")}</p>}
    </form>}
    <div className="mt-4 flex justify-between gap-2">
      {onRemove ? <button type="button" className="notion-button inline-flex items-center gap-2" onClick={onRemove}><Link2Off size={15} />{t("Remove link")}</button> : <span />}
      <button type="button" className="notion-button" onClick={onClose}>{t("Close")}</button>
    </div>
  </dialog>;
}
