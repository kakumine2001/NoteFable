"use client";

import { ChevronDown, FileText, History, Lock, Maximize2, Plus, Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useI18n } from "@/components/i18n-provider";
import { NotePageMenu } from "@/components/note-page-menu";
import { NotesWorkspace } from "@/components/notes-workspace";
import { localizeSystemText } from "@/lib/i18n/translate";
import { drawNoteDiagram } from "@/lib/draw-diagram-jobs";
import { openSlidesWizard } from "@/lib/slides-wizard-jobs";
import { openPptxImport } from "@/lib/pptx-import-jobs";
import { dispatchSlidesCommand } from "@/lib/native-bridge";
import { recentPages } from "@/lib/notes-home-text";
import type { useNotePages } from "@/lib/use-note-pages";
import { pageSettingsOf, type NotePageSummary } from "@/types/notes";
import type { PageSelection } from "@/lib/page-ai/types";
import { NoteIcon } from "@/components/note-icon";
import { PageKindIcon } from "@/components/page-kind-icon";

type SplitNotePaneProps = {
  notes: ReturnType<typeof useNotePages>;
  model: string;
  reasoning: string;
  onSelectNote: (id: string) => void;
  // バックリンクの会話を左のチャットで開く。
  onOpenChat: (id: string, messageId?: string) => void;
  onCreateNote: (parentId?: string) => void;
  onOpenFullView: (id: string) => void;
  onOpenHistory: (id: string) => void;
  onMoveNote: (id: string) => void;
  onExportNote: (id: string) => void;
  onTrashNote: (id: string) => void;
  onAskSelectionInChat: (selection: PageSelection) => void;
  onClose: () => void;
};

// デスクトップ幅でチャットの右側に並べるノートパネル。
// 既存の useNotePages と NotesWorkspace をそのまま共有するため、左のチャットで提案を適用すると右側が即座に更新される。
export function SplitNotePane({
  notes,
  model,
  reasoning,
  onSelectNote,
  onOpenChat,
  onCreateNote,
  onOpenFullView,
  onOpenHistory,
  onMoveNote,
  onExportNote,
  onTrashNote,
  onAskSelectionInChat,
  onClose,
}: SplitNotePaneProps) {
  const { t } = useI18n();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const pickerId = useId();

  const activeSummary: NotePageSummary | undefined = notes.activeId
    ? notes.pages.find((page) => page.id === notes.activeId)
    : undefined;
  const activeSettings = pageSettingsOf(activeSummary);
  const recent = useMemo(() => recentPages(notes.pages, 8), [notes.pages]);

  const filteredPages = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return notes.pages.slice(0, 60);
    return notes.pages.filter((page) => page.title.toLowerCase().includes(trimmed)).slice(0, 60);
  }, [notes.pages, query]);

  useEffect(() => {
    if (!pickerOpen) return;
    queueMicrotask(() => searchInputRef.current?.focus());
    const onPointerDown = (event: MouseEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setPickerOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPickerOpen(false);
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [pickerOpen]);

  const currentTitle = notes.active?.content.title.trim() || activeSummary?.title || t("Workspace");
  const currentIcon = notes.active?.content.icon ?? activeSummary?.icon ?? null;
  const currentKind = activeSummary?.kind ?? notes.active?.page.kind;

  return (
    <aside className="workspace-split-note" aria-label={t("Workspace")}>
      <header className="notion-topbar workspace-split-header">
        <div className="relative min-w-0 flex-1" ref={pickerRef}>
          <button
            type="button"
            className="workspace-split-picker-trigger"
            aria-haspopup="listbox"
            aria-expanded={pickerOpen}
            aria-controls={pickerId}
            onClick={() => { setQuery(""); setPickerOpen((open) => !open); }}
          >
            <span className="shrink-0 text-[15px] leading-none" aria-hidden="true">
              <NoteIcon icon={currentIcon} fallback={<PageKindIcon kind={currentKind} size={15} />} />
            </span>
            <span className="truncate">{currentTitle}</span>
            <ChevronDown size={14} className="shrink-0 text-[var(--notion-faint)]" aria-hidden="true" />
          </button>
          {pickerOpen && (
            <div id={pickerId} className="workspace-split-picker" role="dialog" aria-label={t("Switch page")}>
              <div className="workspace-split-picker-search">
                <Search size={14} className="shrink-0 text-[var(--notion-faint)]" aria-hidden="true" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("Filter pages…")}
                  className="min-w-0 flex-1 bg-transparent text-sm text-[var(--notion-text)] outline-none placeholder:text-[var(--notion-faint)]"
                />
              </div>
              <button
                type="button"
                className="chat-menu-item workspace-split-picker-new"
                disabled={notes.busy}
                onClick={() => { setPickerOpen(false); onCreateNote(); }}
              >
                <Plus size={15} aria-hidden="true" />
                <span>{t("New note")}</span>
              </button>
              <hr className="chat-menu-divider" />
              <div className="workspace-split-picker-list" role="listbox">
                {filteredPages.length ? filteredPages.map((page) => (
                  <button
                    key={page.id}
                    type="button"
                    role="option"
                    aria-selected={page.id === notes.activeId}
                    className={`chat-menu-item${page.id === notes.activeId ? " is-selected" : ""}`}
                    onPointerEnter={(event) => { if (event.pointerType !== "touch") notes.prefetch(page.id, false); }}
                    onPointerLeave={() => notes.cancelPrefetch(page.id)}
                    onPointerDown={(event) => { if (event.pointerType !== "touch" && event.button === 0) notes.prefetch(page.id, true); }}
                    onFocus={() => notes.prefetch(page.id, true)}
                    onClick={() => { setPickerOpen(false); onSelectNote(page.id); }}
                  >
                    <span className="shrink-0 text-[14px] leading-none" aria-hidden="true">
                      <NoteIcon icon={page.icon} fallback={<PageKindIcon kind={page.kind} size={14} />} />
                    </span>
                    <span className="truncate">{page.title}</span>
                  </button>
                )) : (
                  <p className="px-3 py-2 text-xs text-[var(--notion-muted)]">{t("No results")}</p>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {activeSummary && activeSettings.locked && (
            <button
              type="button"
              className="notes-locked-button"
              disabled={notes.busy}
              onClick={() => void notes.updateSettings(activeSummary.id, { locked: false })}
              aria-label={t("Unlock page")}
              title={t("Unlock page")}
            >
              <Lock size={14} />
            </button>
          )}
          {notes.active && notes.activeId && (
            <button
              type="button"
              className="notion-icon-button grid"
              disabled={notes.busy}
              onClick={() => onOpenHistory(notes.activeId!)}
              aria-label={t("Version history")}
              title={t("Version history")}
              aria-haspopup="dialog"
            >
              <History size={18} />
            </button>
          )}
          {notes.active && (
            <span
              role="status"
              data-status={notes.active.status}
              className={`notes-save-status ${notes.active.status === "error" || notes.active.status === "conflict" ? "has-error" : ""}`}
            >
              <span className="notes-save-dot" aria-hidden="true" />
              <span>{({ saved: t("Saved"), pending: t("Saving…"), saving: t("Saving…"), error: t("Not saved"), conflict: t("Conflict") })[notes.active.status]}</span>
            </span>
          )}
          {activeSummary && (
            <NotePageMenu
              page={activeSummary}
              busy={notes.busy}
              error={notes.groupError}
              onSettings={(settings) => void notes.updateSettings(activeSummary.id, settings)}
              onPresent={() => dispatchSlidesCommand({ action: "present" })}
              onFavorite={(favorite) => void notes.setFavorite(activeSummary.id, favorite)}
              onDuplicate={() => void notes.duplicate(activeSummary.id)}
              onAddSubpage={() => onCreateNote(activeSummary.id)}
              // サーバーは保存済みのノートを読むので、入力中の内容を先に保存してから始める（窓は page.tsx の DrawDiagramHost）。
              onDrawDiagram={() => void drawNoteDiagram(activeSummary.id, model, () => (notes.active?.page.id === activeSummary.id ? notes.active.flush() : Promise.resolve(true)))}
              onGenerateSlides={() => openSlidesWizard({ entry: { type: "note", pageId: activeSummary.id, title: activeSummary.title, icon: activeSummary.icon }, model })}
              onImportPptx={() => openPptxImport({ groupId: activeSummary.groupId })}
              onMove={() => onMoveNote(activeSummary.id)}
              onExport={() => onExportNote(activeSummary.id)}
              onTrash={() => onTrashNote(activeSummary.id)}
            />
          )}
          {notes.activeId && (
            <button
              type="button"
              className="notion-icon-button grid"
              onClick={() => onOpenFullView(notes.activeId!)}
              aria-label={t("Open in full view")}
              title={t("Open in full view")}
            >
              <Maximize2 size={17} />
            </button>
          )}
          <button
            type="button"
            className="notion-icon-button grid"
            onClick={onClose}
            aria-label={t("Close split view")}
            title={t("Close split view")}
          >
            <X size={18} />
          </button>
        </div>
      </header>

      {notes.active && notes.activeId ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <NotesWorkspace
            notes={notes}
            listMode={false}
            split
            model={model}
            reasoning={reasoning}
            onOpen={onSelectNote}
            onOpenChat={onOpenChat}
            onCreate={() => onCreateNote()}
            onWorkspaceChange={() => {}}
            onAskSelectionInChat={onAskSelectionInChat}
          />
        </div>
      ) : notes.loading ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <p className="notes-loading">{t("Loading page…")}</p>
        </div>
      ) : (
        <div className="workspace-split-empty">
          {/* ノートを開いていない間は NotesWorkspace が無いので、読み込み・取り込みの失敗はここで出す。 */}
          {notes.error && <div className="notion-error mb-4" role="alert">{localizeSystemText(notes.error, t)}<button type="button" className="notion-button ml-3" onClick={() => void notes.load()}>{t("Retry")}</button></div>}
          {notes.actionError && <div className="notion-error mb-4" role="alert">{localizeSystemText(notes.actionError, t)}<button type="button" className="notion-button ml-3" onClick={notes.dismissActionError}>{t("Close")}</button></div>}
          <FileText size={26} strokeWidth={1.4} className="text-[var(--notion-faint)]" />
          <p className="mt-3 text-sm text-[var(--notion-muted)]">
            {t("Open a page beside this chat to read and edit while talking with AI.")}
          </p>
          <button type="button" className="notes-empty-new mt-4" disabled={notes.busy} onClick={() => onCreateNote()}>
            <Plus size={16} />{t("New note")}
          </button>
          {recent.length > 0 && (
            <div className="workspace-split-recent">
              <p className="chat-section-label">{t("Recently edited")}</p>
              <ul className="space-y-1">
                {recent.map((page) => (
                  <li key={page.id}>
                    <button type="button" className="chat-menu-item"
                      onPointerEnter={(event) => { if (event.pointerType !== "touch") notes.prefetch(page.id, false); }}
                      onPointerLeave={() => notes.cancelPrefetch(page.id)}
                      onPointerDown={(event) => { if (event.pointerType !== "touch" && event.button === 0) notes.prefetch(page.id, true); }}
                      onFocus={() => notes.prefetch(page.id, true)}
                      onClick={() => onSelectNote(page.id)}>
                      <span className="shrink-0 text-[14px] leading-none" aria-hidden="true"><NoteIcon icon={page.icon} fallback={<PageKindIcon kind={page.kind} size={14} />} /></span>
                      <span className="truncate">{page.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
