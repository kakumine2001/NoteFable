"use client";

import { FileText, Plus, RefreshCw } from "lucide-react";
import dynamic from "next/dynamic";
import type { useNotePages } from "@/lib/use-note-pages";

const NoteEditor = dynamic(() => import("@/components/note-editor"), {
  ssr: false, loading: () => <p className="notes-loading">Loading editor…</p>,
});

export function NotesWorkspace({ notes }: { notes: ReturnType<typeof useNotePages> }) {
  const { active, activeId, loading, busy, error, backupError } = notes;
  return <div className="notes-workspace flex-1 overflow-y-auto">
    <div className="notion-page-column px-6 pb-24 pt-12 sm:px-12">
      {error && <div className="notion-error mb-5" role="alert">{error}<button type="button" className="notion-button ml-3" onClick={() => void notes.load()}>Retry</button></div>}
      {loading ? <p className="notes-loading">Loading page…</p> : active && activeId ? <>
        <input className="notes-title" aria-label="Page title" maxLength={200} placeholder="Untitled" value={active.content.title} disabled={busy}
          onChange={(event) => active.edit({ ...active.content, title: event.target.value })} />
        <p className="mb-8 mt-2 text-sm text-[var(--notion-faint)]">Type / for blocks</p>
        {backupError && <div className="notion-warning mb-4" role="alert">{backupError}</div>}
        {!!active.error && <div className="notion-warning mb-5" role="alert">
          <p>{active.error}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {active.status === "conflict" ? <>
              <button type="button" className="notion-button" disabled={busy} onClick={() => void notes.create(true)}>Save as new page</button>
              <button type="button" className="notion-button" onClick={() => { if (window.confirm("Discard this unsaved draft and load the latest version?")) notes.loadLatest(); }}>Load latest</button>
            </> : <button type="button" className="notion-button inline-flex items-center gap-2" onClick={() => void active.flush()}><RefreshCw size={13} />Retry save</button>}
          </div>
        </div>}
        <NoteEditor key={`${activeId}:${notes.editorEpoch}`} blocks={active.content.blocks} editable={!busy}
          onChange={(blocks) => active.edit({ ...active.content, blocks })} />
      </> : !error && <div className="notes-empty">
        <FileText size={30} strokeWidth={1.3} />
        <h1 className="mt-5 text-3xl font-bold tracking-tight">Your pages</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--notion-muted)]">A quiet place for notes, ideas, and things you want to keep.</p>
        <button type="button" disabled={busy} className="notion-button notion-button-primary mt-6 inline-flex items-center gap-2" onClick={() => void notes.create()}><Plus size={15} />New page</button>
        <p className="mt-8 max-w-sm text-xs leading-5 text-[var(--notion-faint)]">Pages are saved on the server and linked to this browser. Clearing site cookies or using another browser creates a separate workspace.</p>
      </div>}
    </div>
  </div>;
}
