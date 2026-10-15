"use client";

import { ChevronDown, ChevronRight, FileText, Folder, FolderInput, PanelLeftClose, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { FloatingEmojiPopover, floatingPositionFor, usePickerBackToClose, type FloatingPosition } from "@/components/emoji-picker";
import { ReorderHandle } from "@/components/reorder-handle";
import type { ReorderRequest } from "@/lib/list-order";
import { SidebarFooter } from "@/components/sidebar-footer";
import { ConfirmDialog, GroupNameDialog, MoveNoteDialog } from "@/components/note-group-dialogs";
import { NoteTrashDialog } from "@/components/note-trash-dialog";
import { StudyMateLogo } from "@/components/studymate-logo";
import { WorkspaceNav, type WorkspaceView } from "@/components/workspace-nav";
import { rowName } from "@/lib/view-transition";
import { TRASH_RETENTION_DAYS, type NoteGroupSummary, type NotePageSummary } from "@/types/notes";

const COLLAPSED_KEY = "studymate:note-groups-collapsed:v1";

type GroupActions = {
  groups: NoteGroupSummary[]; groupError: string;
  onReorder: (move:ReorderRequest)=>Promise<unknown>;
  onMoveNote: (pageId: string, groupId: string | null) => Promise<unknown>;
  // 行のアイコンから変える。失敗したら null。
  onChangeIcon: (pageId: string, icon: string | null) => Promise<unknown>;
  onCreateGroup: (name: string) => Promise<NoteGroupSummary | null>;
  onRenameGroup: (id: string, name: string) => Promise<unknown>;
  onDeleteGroup: (id: string) => Promise<unknown>;
};

export function NotesSidebar({ pages, activeId, busy, onCreate, onSearch, onSelect, onDelete, onClose, onWorkspaceChange, groups, groupError, onMoveNote, onChangeIcon, onCreateGroup, onRenameGroup, onDeleteGroup, onReorder }: {
  pages: NotePageSummary[]; activeId: string | null; busy: boolean;
  onWorkspaceChange: (view: WorkspaceView) => void; onCreate: () => void; onSearch: () => void; onSelect: (id: string) => void; onDelete: (id: string) => Promise<void>; onClose: () => void;
} & GroupActions) {
  const [deleting, setDeleting] = useState<NotePageSummary | null>(null);
  // ゴミ箱の小窓。復元したノートは "studymate:page-created" で一覧に戻るので、開閉の状態だけここで持つ。
  const [trashOpen, setTrashOpen] = useState(false);
  const [moving, setMoving] = useState<NotePageSummary | null>(null);
  const [naming, setNaming] = useState<{ mode: "create" } | { mode: "rename"; group: NoteGroupSummary } | null>(null);
  const [deletingGroup, setDeletingGroup] = useState<NoteGroupSummary | null>(null);
  // 折りたたみの状態は端末に覚えておく。この側のパネルは Notes に切り替えた後にだけ作られるので、初期値で読んでもサーバー描画とずれない。
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "{}"); } catch { return {}; }
  });
  // アイコン選択を開いているノートと、その位置（スクロールしても固定位置で出すため開いた時点で決める）。チャットの行と同じ作り。
  const [picker, setPicker] = useState<{ id: string; position: FloatingPosition } | null>(null);
  const [iconError, setIconError] = useState("");
  const triggerRef = useRef<HTMLElement | null>(null);
  const closePicker = () => setPicker(null);
  usePickerBackToClose(picker !== null, closePicker);
  const pickerPage = picker ? pages.find((page) => page.id === picker.id) : undefined;
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
      <ReorderHandle id={page.id} title={page.title} scope="note" ids={pages.filter(item=>item.groupId===page.groupId).map(item=>item.id)} disabled={busy} onMove={onReorder} onMoveGroup={async groupId=>{
        const ok=await onMoveNote(page.id,groupId);
        if(ok && groupId)setCollapsed(current=>{
          const next={...current,[groupId]:false};
          try{localStorage.setItem(COLLAPSED_KEY,JSON.stringify(next));}catch{/* Keep the current view usable without storage. */}
          return next;
        });
        return ok;
      }}/>
      <button type="button" disabled={busy} className="chat-row-icon-button" aria-label={`Change icon of ${page.title}`} title="Change icon"
        aria-haspopup="dialog" aria-expanded={picker?.id === page.id}
        onClick={(event) => {
          triggerRef.current = event.currentTarget;
          const position = floatingPositionFor(event.currentTarget.getBoundingClientRect());
          setPicker(picker?.id === page.id ? null : { id: page.id, position });
        }}>
        <span className="notes-row-icon" aria-hidden="true">{page.icon ?? <FileText size={15} />}</span>
      </button>
      <button type="button" disabled={busy} onClick={() => onSelect(page.id)} className="flex min-w-0 flex-1 items-center py-1.5 pl-1 pr-2 text-left" title={page.title}>
        <span className="truncate text-sm">{page.title}</span>
      </button>
      <button type="button" disabled={busy} onClick={() => setMoving(page)} className="notion-row-action notes-move-action" aria-label={`Move ${page.title} to a project`} title="Move to project"><FolderInput size={14} /></button>
      <button type="button" disabled={busy} onClick={() => setDeleting(page)} className="notion-row-action" aria-label={`Move ${page.title} to Trash`} title="Move to Trash"><Trash2 size={14} /></button>
    </div>
  );

  return (
    <aside className="notion-sidebar" data-reorder-list>
      <div className="flex h-12 items-center justify-between px-3">
        <StudyMateLogo />
        <button type="button" className="notion-icon-button grid" onClick={onClose} aria-label="Close sidebar"><PanelLeftClose size={17} /></button>
      </div>
      <WorkspaceNav view="pages" onChange={onWorkspaceChange} />
      <div className="mt-3 px-2">
        <button type="button" className="notion-sidebar-action" onClick={onSearch} aria-keyshortcuts="Control+K Meta+K">
          <Search size={16} /><span>Search</span><kbd className="sidebar-search-hint" aria-hidden="true">Ctrl K</kbd>
        </button>
        <button type="button" className="notion-sidebar-action" disabled={busy} onClick={onCreate}><Plus size={16} /><span>New note</span></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        <div className="chat-project-heading">
          <span>Projects</span>
          <button type="button" className="notion-icon-button" onClick={() => setNaming({ mode: "create" })} aria-label="New project" title="New project"><Plus size={15} /></button>
        </div>
        {groups.map((group) => {
          const members = pages.filter((page) => page.groupId === group.id);
          const open = !collapsed[group.id];
          return (
            <div key={group.id}>
              <div className="notion-session-row group" data-note-group-drop={group.id}>
                <button type="button" onClick={() => toggle(group.id)} aria-expanded={open} className="chat-project-toggle" title={group.name}>
                  {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <Folder size={15}/>
                  <span className="truncate text-sm font-medium">{group.name}</span>
                  <span className="text-xs text-[var(--notion-faint)]">{members.length}</span>
                </button>
                <button type="button" onClick={() => setNaming({ mode: "rename", group })} className="notion-row-action" aria-label={`Rename ${group.name}`}><Pencil size={13} /></button>
                <button type="button" onClick={() => setDeletingGroup(group)} className="notion-row-action" aria-label={`Delete project ${group.name}`}><Trash2 size={14} /></button>
              </div>
              {open && <div className="notes-group-members">
                {members.length ? members.map(row) : <p className="px-2 py-1.5 text-xs text-[var(--notion-faint)]">No notes in this project.</p>}
              </div>}
            </div>
          );
        })}
        {iconError && <p role="alert" className="px-2 text-xs text-[#b91c1c]">{iconError}</p>}
        <div className="chat-section-label" data-note-group-drop="">Notes</div>
        {loose.map(row)}
        {!pages.length && <p className="px-2 py-3 text-xs leading-5 text-[var(--notion-muted)]">Your notes will appear here.</p>}
      </div>
      <div className="shrink-0 px-2 pb-1">
        <button type="button" className="notion-sidebar-action" aria-haspopup="dialog" onClick={() => setTrashOpen(true)}><Trash2 size={16} /><span>Trash</span></button>
      </div>
      {deleting && <dialog ref={dialog} onCancel={() => setDeleting(null)} aria-labelledby="delete-page-title" aria-describedby="delete-page-description" className="notes-dialog">
          <h2 id="delete-page-title" className="text-base font-semibold">Move note to Trash?</h2>
          <p id="delete-page-description" className="mt-2 text-sm text-[var(--notion-muted)]">“{deleting.title}” will be moved to Trash. You can restore it for {TRASH_RETENTION_DAYS} days.</p>
          <div className="mt-5 flex justify-end gap-2">
            <button autoFocus type="button" disabled={busy} className="notion-button" onClick={() => setDeleting(null)}>Cancel</button>
            <button type="button" disabled={busy} className="notion-button notes-delete" onClick={async () => { await onDelete(deleting.id); setDeleting(null); }}>Move to Trash</button>
          </div>
      </dialog>}
      {trashOpen && <NoteTrashDialog onClose={() => setTrashOpen(false)} />}
      {moving && <MoveNoteDialog page={pages.find((page) => page.id === moving.id) ?? moving} groups={groups} error={groupError}
        onMove={onMoveNote} onCreateGroup={onCreateGroup} onClose={() => setMoving(null)} />}
      {naming && <GroupNameDialog title={naming.mode === "create" ? "New project" : "Rename project"} initial={naming.mode === "rename" ? naming.group.name : ""}
        submitLabel={naming.mode === "create" ? "Create" : "Save"} error={groupError} onClose={() => setNaming(null)}
        onSubmit={async (name) => naming.mode === "create" ? Boolean(await onCreateGroup(name)) : Boolean(await onRenameGroup(naming.group.id, name))} />}
      {deletingGroup && <ConfirmDialog title="Delete project?" confirmLabel="Delete project" error={groupError} onClose={() => setDeletingGroup(null)}
        body={`“${deletingGroup.name}” will be deleted. Its notes are kept and move out of the project.`}
        onConfirm={async () => Boolean(await onDeleteGroup(deletingGroup.id))} />}
      <SidebarFooter />
      {picker && pickerPage && (
        <FloatingEmojiPopover position={picker.position} trigger={triggerRef} current={pickerPage.icon}
          onChange={async (icon) => { setIconError(""); if (!(await onChangeIcon(pickerPage.id, icon))) setIconError("Could not change the icon. Try again."); }} onClose={closePicker} />
      )}
    </aside>
  );
}
