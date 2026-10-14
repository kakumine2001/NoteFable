"use client";

import { FileText, Plus, RefreshCw } from "lucide-react";
import dynamic from "next/dynamic";
import { useLayoutEffect, useRef } from "react";
import type { NoteEditorHandle } from "@/components/note-editor";
import { NoteAssistant } from "@/components/note-assistant";
import { NotePageHeader } from "@/components/note-page-header";
import { NotesHome } from "@/components/notes-home";
import { WorkspaceSwitch, type WorkspaceView } from "@/components/workspace-nav";
import type { useNotePages } from "@/lib/use-note-pages";

const NoteEditor = dynamic(() => import("@/components/note-editor"), {
  ssr: false, loading: () => <p className="notes-loading">Loading editor…</p>,
});

export function NotesWorkspace({ notes, listMode, model, reasoning, onOpen, onCreate, onWorkspaceChange }: {
  notes: ReturnType<typeof useNotePages>;
  listMode: boolean;
  // ノートの AI アシスタントが使うモデルと推論強度（チャットで選んでいるものと同じ）。
  model: string;
  reasoning: string;
  onOpen: (id: string) => void;
  onCreate: () => void;
  onWorkspaceChange: (view: WorkspaceView) => void;
}) {
  const { active, activeId, loading, busy, error, backupError } = notes;
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const editorRef = useRef<NoteEditorHandle>(null);
  const emptyPage = active?.content.title === "Untitled" && !active.content.blocks.length;
  useLayoutEffect(() => {
    if (!titleRef.current) return;
    titleRef.current.style.height = "auto";
    titleRef.current.style.height = `${titleRef.current.scrollHeight}px`;
  }, [active?.content.title, activeId, loading]);
  useLayoutEffect(() => {
    if (!loading && emptyPage) titleRef.current?.focus();
  }, [activeId, loading, emptyPage]);

  return <div className="notes-workspace flex-1 overflow-y-auto">
    {error && <div className="notes-column pt-6"><div className="notion-error" role="alert">{error}<button type="button" className="notion-button ml-3" onClick={() => void notes.load()}>Retry</button></div></div>}
    {listMode && (notes.pages.length > 0 || notes.groups.length > 0) ? (
      <NotesHome pages={notes.pages} groups={notes.groups} groupError={notes.groupError} busy={busy || loading} onOpen={onOpen} onCreate={onCreate}
        onWorkspaceChange={onWorkspaceChange} onReorder={notes.reorder} onMoveNote={notes.moveNote} onCreateGroup={notes.createGroup} />
    ) : loading && (!listMode || !(notes.pages.length || notes.groups.length)) ? <div className="notes-column pt-24"><p className="notes-loading">{listMode ? "Loading notes…" : "Loading note…"}</p></div> : active && activeId && !listMode ? <>
      <NotePageHeader content={active.content} editable={!busy} titleRef={titleRef}
        onPatch={(patch) => active.edit({ ...active.content, ...patch })}
        onTitleKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter" || (event.key === "ArrowDown" && event.currentTarget.selectionStart === event.currentTarget.value.length)) {
            event.preventDefault(); editorRef.current?.focusStart();
          }
        }} />
      <div className="notes-column notes-body">
        {backupError && <div className="notion-warning mb-4" role="alert">{backupError}</div>}
        {!!active.error && <div className="notion-warning mb-5" role="alert">
          <p>{active.error}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {active.status === "conflict" ? <>
              <button type="button" className="notion-button" disabled={busy} onClick={() => void notes.create(true)}>Save as new note</button>
              <button type="button" className="notion-button" onClick={() => { if (window.confirm("Discard this unsaved draft and load the latest version?")) notes.loadLatest(); }}>Load latest</button>
            </> : <button type="button" className="notion-button inline-flex items-center gap-2" onClick={() => void active.flush()}><RefreshCw size={13} />Retry save</button>}
          </div>
        </div>}
        <NoteEditor key={`${activeId}:${notes.editorEpoch}`} blocks={active.content.blocks} editable={!busy}
          editorRef={editorRef} onFocusTitle={() => {
            titleRef.current?.focus();
            const end = titleRef.current?.value.length ?? 0;
            titleRef.current?.setSelectionRange(end, end);
          }}
          onChange={(blocks) => active.edit({ ...active.content, blocks })} />
      </div>
      <NoteAssistant key={activeId} noteId={activeId} noteTitle={active.content.title} model={model} reasoning={reasoning} flush={() => active.flush()} />
    </> : !error && <><div className="notes-column"><div className="notion-home-switch lg:hidden"><WorkspaceSwitch view="pages" onChange={onWorkspaceChange} /></div></div><div className="notes-column notes-empty">
      <FileText size={28} strokeWidth={1.4} className="text-[var(--notion-faint)]" />
      <h1 className="mt-4 text-[2.5rem] font-bold leading-tight tracking-[-0.01em]">Notes</h1>
      <p className="mt-2 text-[15px] leading-6 text-[var(--notion-muted)]">Write notes with blocks — type <kbd className="notes-kbd">/</kbd> for headings, lists, to-dos and code.</p>
      <button type="button" disabled={busy} className="notes-empty-new" onClick={onCreate}><Plus size={16} />New note</button>
      <p className="mt-10 max-w-sm text-xs leading-5 text-[var(--notion-faint)]">Notes are saved on the server and linked to this device. Sign in with Google to open them on other devices. Clearing app or site data creates a separate workspace.</p>
    </div></>}
  </div>;
}
