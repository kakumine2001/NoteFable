"use client";

import { FileText, PanelLeftClose, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { StudyMateLogo } from "@/components/studymate-logo";
import { WorkspaceNav, type WorkspaceView } from "@/components/workspace-nav";
import type { NotePageSummary } from "@/types/notes";

export function NotesSidebar({ pages, activeId, busy, onCreate, onSelect, onDelete, onClose, onWorkspaceChange }: {
  pages: NotePageSummary[]; activeId: string | null; busy: boolean;
  onWorkspaceChange: (view: WorkspaceView) => void; onCreate: () => void; onSelect: (id: string) => void; onDelete: (id: string) => Promise<void>; onClose: () => void;
}) {
  const [deleting, setDeleting] = useState<NotePageSummary | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (deleting) dialog.current?.showModal();
  }, [deleting]);
  return (
    <aside className="notion-sidebar">
      <div className="flex h-12 items-center justify-between px-3">
        <StudyMateLogo />
        <button type="button" className="notion-icon-button grid" onClick={onClose} aria-label="Close sidebar"><PanelLeftClose size={17} /></button>
      </div>
      <WorkspaceNav view="pages" onChange={onWorkspaceChange} />
      <div className="mt-5 flex h-6 items-center justify-between pl-4 pr-3 text-xs font-medium text-[var(--notion-muted)]">
        <span>Private</span>
        <button type="button" className="notion-icon-button grid !h-5 !w-5" disabled={busy} onClick={onCreate} aria-label="New page" title="New page"><Plus size={14} /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {!pages.length && <p className="px-2 py-3 text-xs leading-5 text-[var(--notion-muted)]">Your pages will appear here.</p>}
        {pages.map((page) => (
          <div key={page.id} className={`notion-session-row group ${activeId === page.id ? "is-active" : ""}`}>
            <button type="button" disabled={busy} onClick={() => onSelect(page.id)} className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left" title={page.title}>
              <span className="notes-row-icon" aria-hidden="true">{page.icon ?? <FileText size={15} />}</span><span className="truncate text-sm">{page.title}</span>
            </button>
            <button type="button" disabled={busy} onClick={() => setDeleting(page)} className="notion-row-action" aria-label={`Delete ${page.title}`}><Trash2 size={14} /></button>
          </div>
        ))}
        <button type="button" className="notion-sidebar-action !text-[var(--notion-faint)]" disabled={busy} onClick={onCreate}><Plus size={16} /><span>New page</span></button>
      </div>
      {deleting && <dialog ref={dialog} onCancel={() => setDeleting(null)} aria-labelledby="delete-page-title" aria-describedby="delete-page-description" className="notes-dialog">
          <h2 id="delete-page-title" className="text-base font-semibold">Delete page?</h2>
          <p id="delete-page-description" className="mt-2 text-sm text-[var(--notion-muted)]">“{deleting.title}” will be permanently deleted.</p>
          <div className="mt-5 flex justify-end gap-2">
            <button autoFocus type="button" disabled={busy} className="notion-button" onClick={() => setDeleting(null)}>Cancel</button>
            <button type="button" disabled={busy} className="notion-button notes-delete" onClick={async () => { await onDelete(deleting.id); setDeleting(null); }}>Delete page</button>
          </div>
      </dialog>}
    </aside>
  );
}
