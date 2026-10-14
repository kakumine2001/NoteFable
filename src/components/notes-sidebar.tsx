"use client";

import { ChevronDown, ChevronRight, FileText, FolderInput, FolderPlus, PanelLeftClose, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ReorderHandle } from "@/components/reorder-handle";
import type { ReorderRequest } from "@/lib/list-order";
import { SidebarFooter } from "@/components/sidebar-footer";
import { ConfirmDialog, GroupNameDialog, MoveNoteDialog } from "@/components/note-group-dialogs";
import { StudyMateLogo } from "@/components/studymate-logo";
import { WorkspaceNav, type WorkspaceView } from "@/components/workspace-nav";
import { rowName } from "@/lib/view-transition";
import type { NoteGroupSummary, NotePageSummary } from "@/types/notes";

const COLLAPSED_KEY = "studymate:note-groups-collapsed:v1";

type GroupActions = {
  groups: NoteGroupSummary[]; groupError: string;
  onReorder: (move:ReorderRequest)=>Promise<unknown>;
  onMoveNote: (pageId: string, groupId: string | null) => Promise<unknown>;
  onCreateGroup: (name: string) => Promise<NoteGroupSummary | null>;
  onRenameGroup: (id: string, name: string) => Promise<unknown>;
  onDeleteGroup: (id: string) => Promise<unknown>;
};

export function NotesSidebar({ pages, activeId, busy, onCreate, onSelect, onDelete, onClose, onWorkspaceChange, groups, groupError, onMoveNote, onCreateGroup, onRenameGroup, onDeleteGroup, onReorder }: {
  pages: NotePageSummary[]; activeId: string | null; busy: boolean;
  onWorkspaceChange: (view: WorkspaceView) => void; onCreate: () => void; onSelect: (id: string) => void; onDelete: (id: string) => Promise<void>; onClose: () => void;
} & GroupActions) {
  const [deleting, setDeleting] = useState<NotePageSummary | null>(null);
  const [moving, setMoving] = useState<NotePageSummary | null>(null);
  const [naming, setNaming] = useState<{ mode: "create" } | { mode: "rename"; group: NoteGroupSummary } | null>(null);
  const [deletingGroup, setDeletingGroup] = useState<NoteGroupSummary | null>(null);
  // 折りたたみの状態は端末に覚えておく。この側のパネルは Notes に切り替えた後にだけ作られるので、初期値で読んでもサーバー描画とずれない。
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "{}"); } catch { return {}; }
  });
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (deleting) dialog.current?.showModal();
  }, [deleting]);
  function toggle(id: string) {
    setCollapsed((current) => {
      const next = { ...current, [id]: !current[id] };
      try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next)); } catch { /* 保存できなくても動作は変えない。 */ }
      return next;
    });
  }

  const loose = pages.filter((page) => !page.groupId || !groups.some((group) => group.id === page.groupId));
  const row = (page: NotePageSummary) => (
    <div key={page.id} className={`notion-session-row vt-row group ${activeId === page.id ? "is-active" : ""}`} style={rowName(`nrow-${page.id}`)} data-order-id={page.id} data-order-scope="note">
      <ReorderHandle id={page.id} title={page.title} scope="note" ids={pages.filter(item=>item.groupId===page.groupId).map(item=>item.id)} disabled={busy} onMove={onReorder}/>
      <button type="button" disabled={busy} onClick={() => onSelect(page.id)} className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left" title={page.title}>
        <span className="notes-row-icon" aria-hidden="true">{page.icon ?? <FileText size={15} />}</span><span className="truncate text-sm">{page.title}</span>
      </button>
      <button type="button" disabled={busy} onClick={() => setMoving(page)} className="notion-row-action notes-move-action" aria-label={`Move ${page.title} to a group`} title="Move to group"><FolderInput size={14} /></button>
      <button type="button" disabled={busy} onClick={() => setDeleting(page)} className="notion-row-action" aria-label={`Delete ${page.title}`}><Trash2 size={14} /></button>
    </div>
  );

  return (
    <aside className="notion-sidebar" data-reorder-list>
      <div className="flex h-12 items-center justify-between px-3">
        <StudyMateLogo />
        <button type="button" className="notion-icon-button grid" onClick={onClose} aria-label="Close sidebar"><PanelLeftClose size={17} /></button>
      </div>
      <WorkspaceNav view="pages" onChange={onWorkspaceChange} />
      <div className="mt-5 flex h-6 items-center justify-between pl-4 pr-3 text-xs font-medium text-[var(--notion-muted)]">
        <span>Private</span>
        <button type="button" className="notion-icon-button grid !h-5 !w-5 [@media(pointer:coarse)]:!h-8 [@media(pointer:coarse)]:!w-8" disabled={busy} onClick={onCreate} aria-label="New note" title="New note"><Plus size={14} /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {!pages.length && <p className="px-2 py-3 text-xs leading-5 text-[var(--notion-muted)]">Your notes will appear here.</p>}
        {loose.map(row)}
        <button type="button" className="notion-sidebar-action !text-[var(--notion-faint)]" disabled={busy} onClick={onCreate}><Plus size={16} /><span>New note</span></button>

        <div className="mt-4 flex h-6 items-center justify-between pl-2 pr-1 text-xs font-medium text-[var(--notion-muted)]">
          <span>Groups</span>
          <button type="button" className="notion-icon-button grid !h-5 !w-5 [@media(pointer:coarse)]:!h-8 [@media(pointer:coarse)]:!w-8" onClick={() => setNaming({ mode: "create" })} aria-label="New group" title="New group"><FolderPlus size={14} /></button>
        </div>
        {!groups.length && <p className="px-2 py-2 text-xs leading-5 text-[var(--notion-muted)]">Make a group to keep related notes together.</p>}
        {groups.map((group) => {
          const members = pages.filter((page) => page.groupId === group.id);
          const open = !collapsed[group.id];
          return (
            <div key={group.id}>
              <div className="notion-session-row group">
                <button type="button" onClick={() => toggle(group.id)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-1.5 px-1.5 py-1.5 text-left" title={group.name}>
                  {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <span className="truncate text-sm font-medium">{group.name}</span>
                  <span className="text-xs text-[var(--notion-faint)]">{members.length}</span>
                </button>
                <button type="button" onClick={() => setNaming({ mode: "rename", group })} className="notion-row-action" aria-label={`Rename ${group.name}`}><Pencil size={13} /></button>
                <button type="button" onClick={() => setDeletingGroup(group)} className="notion-row-action" aria-label={`Delete group ${group.name}`}><Trash2 size={14} /></button>
              </div>
              {open && <div className="notes-group-members">
                {members.length ? members.map(row) : <p className="px-2 py-1.5 text-xs text-[var(--notion-faint)]">No notes in this group.</p>}
              </div>}
            </div>
          );
        })}
      </div>
      {deleting && <dialog ref={dialog} onCancel={() => setDeleting(null)} aria-labelledby="delete-page-title" aria-describedby="delete-page-description" className="notes-dialog">
          <h2 id="delete-page-title" className="text-base font-semibold">Delete note?</h2>
          <p id="delete-page-description" className="mt-2 text-sm text-[var(--notion-muted)]">“{deleting.title}” will be permanently deleted.</p>
          <div className="mt-5 flex justify-end gap-2">
            <button autoFocus type="button" disabled={busy} className="notion-button" onClick={() => setDeleting(null)}>Cancel</button>
            <button type="button" disabled={busy} className="notion-button notes-delete" onClick={async () => { await onDelete(deleting.id); setDeleting(null); }}>Delete note</button>
          </div>
      </dialog>}
      {moving && <MoveNoteDialog page={pages.find((page) => page.id === moving.id) ?? moving} groups={groups} error={groupError}
        onMove={onMoveNote} onCreateGroup={onCreateGroup} onClose={() => setMoving(null)} />}
      {naming && <GroupNameDialog title={naming.mode === "create" ? "New group" : "Rename group"} initial={naming.mode === "rename" ? naming.group.name : ""}
        submitLabel={naming.mode === "create" ? "Create" : "Save"} error={groupError} onClose={() => setNaming(null)}
        onSubmit={async (name) => naming.mode === "create" ? Boolean(await onCreateGroup(name)) : Boolean(await onRenameGroup(naming.group.id, name))} />}
      {deletingGroup && <ConfirmDialog title="Delete group?" confirmLabel="Delete group" error={groupError} onClose={() => setDeletingGroup(null)}
        body={`“${deletingGroup.name}” will be deleted. Its notes are kept and move out of the group.`}
        onConfirm={async () => Boolean(await onDeleteGroup(deletingGroup.id))} />}
      <SidebarFooter />
    </aside>
  );
}
