"use client";

import { FileText, LoaderCircle, Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "@/components/chat-project-settings.css";
import { useT } from "@/components/i18n-provider";
import { localizeSystemText, msg } from "@/lib/i18n/translate";
import { useBackToClose } from "@/lib/use-back-to-close";
import { MAX_MESSAGE_NOTES, toggleAttachedPage, type AttachedPage } from "@/types/chat";
import { NoteIcon } from "@/components/note-icon";

// 一覧に出すノートの上限。多いときは絞り込みで探す（プロジェクト設定の参照ノート選びと同じ）。
const MAX_LISTED = 100;

// チャットの発言に添付するノートを選ぶダイアログ。見た目はプロジェクト設定の参照ノート選びと同じ部品を使う。
// 選んだノートは入力欄の上にチップとして並び、送信すると AI がその内容を文脈として読む。
export function AttachPageDialog({ initial, onClose, onAttach }: {
  initial: AttachedPage[];
  onClose: () => void;
  onAttach: (pages: AttachedPage[]) => void;
}) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [attempt, setAttempt] = useState(0);
  const [pages, setPages] = useState<AttachedPage[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState<AttachedPage[]>(initial);
  const [filter, setFilter] = useState("");
  useBackToClose(true, onClose);
  useEffect(() => { ref.current?.showModal(); }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/pages", { signal: controller.signal, cache: "no-store" }).then(async (response) => {
      const data: unknown = await response.json().catch(() => null);
      const list = data && typeof data === "object" ? (data as { pages?: unknown }).pages : undefined;
      if (!response.ok || !Array.isArray(list)) {
        const error = data && typeof data === "object" ? (data as { error?: unknown }).error : undefined;
        throw new Error(typeof error === "string" && error ? error : msg("Could not load your notes."));
      }
      const live = (list as AttachedPage[]).map(({ id, title, icon }) => ({ id, title, icon: icon ?? null }));
      setPages(live);
      // 前に選んだノートは今のタイトルに揃える。その後ゴミ箱に入ったノートは外す（送っても断られるため）。
      const byId = new Map(live.map((page) => [page.id, page]));
      setSelected((current) => current.flatMap((page) => byId.get(page.id) ?? []));
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setLoadError(reason instanceof Error && reason.message ? reason.message : msg("Could not load your notes."));
    });
    return () => controller.abort();
  }, [attempt]);

  const selectedIds = useMemo(() => new Set(selected.map((page) => page.id)), [selected]);
  const full = selected.length >= MAX_MESSAGE_NOTES;
  const listed = useMemo(() => {
    const query = filter.trim().toLowerCase();
    const list = pages ?? [];
    return query ? list.filter((page) => (page.title || t("Untitled")).toLowerCase().includes(query)) : list;
  }, [pages, filter, t]);

  function toggle(page: AttachedPage) {
    setSelected((list) => toggleAttachedPage(list, page));
  }

  // チャットの画面はサイドバーや入力欄の中に重なっているので、その外（body）に出す。
  // body に出すので入力欄の translate="no" が届かない。ここでも翻訳の対象から外す。
  return createPortal(<dialog ref={ref} aria-labelledby={titleId} className="notes-dialog chat-project-settings" translate="no"
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => { if (event.target === event.currentTarget) { const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) onClose(); } }}>
    <form className="project-settings-shell" onSubmit={(event) => { event.preventDefault(); onAttach(selected); onClose(); }}>
      <div className="project-settings-header">
        <h2 id={titleId}>{t("Attach pages")}</h2>
      </div>
      <div className="project-settings-body">
        <section className="project-settings-section" aria-labelledby={`${titleId}-notes`}>
          <h3 id={`${titleId}-notes`} className="project-settings-label">
            {t("Your notes")}
            <span className={`project-settings-count${full ? " is-full" : ""}`} aria-live="polite">{selected.length}/{MAX_MESSAGE_NOTES}</span>
          </h3>
          {selected.length > 0 && <ul className="project-settings-chips" aria-label={t("Selected notes")}>
            {selected.map((page) => <li key={page.id} className="project-settings-chip">
              <FileText size={13} aria-hidden="true" className="flex-none" />
              <span className="project-settings-chip-title">{page.title || t("Untitled")}</span>
              <button type="button" aria-label={t("Remove {title}", { title: page.title || t("Untitled") })} onClick={() => toggle(page)}><X size={12} aria-hidden="true" /></button>
            </li>)}
          </ul>}
          {!pages && !loadError && <p className="project-settings-empty" role="status"><LoaderCircle size={14} className="mr-1 inline animate-spin" aria-hidden="true" />{t("Loading…")}</p>}
          {loadError && <>
            <p role="alert" className="project-settings-error">{localizeSystemText(loadError, t)}</p>
            <button type="button" className="notion-button mt-2" onClick={() => { setLoadError(""); setAttempt((count) => count + 1); }}>{t("Try again")}</button>
          </>}
          {pages && <>
            <label className="project-settings-search">
              <Search size={14} aria-hidden="true" />
              <input type="search" autoFocus value={filter} placeholder={t("Filter your notes")} aria-label={t("Filter your notes")} onChange={(event) => setFilter(event.target.value)}
                // Enter は絞り込みの確定だけで、添付の確定にはしない。
                onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }} />
            </label>
            {listed.length > 0 && <ul className="project-settings-list" aria-label={t("Your notes")}>
              {listed.slice(0, MAX_LISTED).map((page) => {
                const checked = selectedIds.has(page.id);
                const blocked = !checked && full;
                return <li key={page.id}>
                  <label className={`project-settings-option${checked ? " is-selected" : ""}${blocked ? " is-disabled" : ""}`}>
                    <input type="checkbox" checked={checked} disabled={blocked} onChange={() => toggle(page)} />
                    <span className="project-settings-note-icon" aria-hidden="true"><NoteIcon icon={page.icon} fallback={<FileText size={14} />} /></span>
                    <span className="project-settings-note-title">{page.title || t("Untitled")}</span>
                  </label>
                </li>;
              })}
            </ul>}
            {!listed.length && <p className="project-settings-empty">{pages.length ? t("No notes match.") : t("You don’t have any notes yet.")}</p>}
            {listed.length > MAX_LISTED && <p className="project-settings-empty">{t("Showing the first {count} notes. Type in the filter to find others.", { count: MAX_LISTED })}</p>}
            {full && <p className="project-settings-empty">{t("You can choose up to {count} notes. Remove one to pick another.", { count: MAX_MESSAGE_NOTES })}</p>}
          </>}
        </section>
      </div>
      <div className="project-settings-footer">
        <button type="button" className="notion-button" onClick={onClose}>{t("Cancel")}</button>
        <button type="submit" className="notion-button notion-button-primary">{t("Attach")}</button>
      </div>
    </form>
  </dialog>, document.body);
}
