"use client";

import { ChevronDown, ChevronRight, FileText, Folder, FolderInput, House, PanelLeftClose, Pencil, Plus, Search, StarOff, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { FloatingEmojiPopover, floatingPositionFor, usePickerBackToClose, type FloatingPosition } from "@/components/emoji-picker";
import { ReorderHandle } from "@/components/reorder-handle";
import type { ReorderRequest } from "@/lib/list-order";
import { SidebarFooter } from "@/components/sidebar-footer";
import { ConfirmDialog, GroupNameDialog, MoveNoteDialog } from "@/components/note-group-dialogs";
import { NoteTrashDialog } from "@/components/note-trash-dialog";
import { NoteFableLogo } from "@/components/app-icon";
import { WorkspaceNav, type WorkspaceView } from "@/components/workspace-nav";
import { ancestorsOf, childrenByParent, rootPages } from "@/lib/note-tree";
import { useExpandedPages } from "@/lib/use-expanded-pages";
import { rowName } from "@/lib/view-transition";
import { TRASH_RETENTION_DAYS, type NoteGroupSummary, type NotePageSummary } from "@/types/notes";
import { useT } from "@/components/i18n-provider";
import { msg } from "@/lib/i18n/translate";

const COLLAPSED_KEY = "notefable:note-groups-collapsed:v1";

type GroupActions = {
  groups: NoteGroupSummary[]; groupError: string;
  onReorder: (move:ReorderRequest)=>Promise<unknown>;
  onMoveNote: (pageId: string, groupId: string | null) => Promise<unknown>;
  // 行のアイコンから変える。失敗したら null。
  onChangeIcon: (pageId: string, icon: string | null) => Promise<unknown>;
  onCreateGroup: (name: string) => Promise<NoteGroupSummary | null>;
  onRenameGroup: (id: string, name: string) => Promise<unknown>;
  onDeleteGroup: (id: string) => Promise<unknown>;
  onMoveToPage: (pageId: string, parentId: string) => Promise<unknown>;
  onFavorite: (pageId: string, favorite: boolean) => Promise<unknown>;
};

export function NotesSidebar({ pages, activeId, busy, home, onHome, onCreate, onSearch, onSelect, onDelete, onClose, onWorkspaceChange, groups, groupError, onMoveNote, onChangeIcon, onCreateGroup, onRenameGroup, onDeleteGroup, onReorder, onMoveToPage, onFavorite }: {
  pages: NotePageSummary[]; activeId: string | null; busy: boolean;
  // Notes のホーム（最近のノートと一覧）を出しているか、とホームへ戻る操作。
  home: boolean; onHome: () => void;
  // parentId を渡すと、そのページの中にサブページを作る。
  onWorkspaceChange: (view: WorkspaceView) => void; onCreate: (parentId?: string) => void; onSearch: () => void; onSelect: (id: string) => void; onDelete: (id: string) => Promise<unknown>; onClose: () => void;
} & GroupActions) {
  const t = useT();
  const [deleting, setDeleting] = useState<NotePageSummary | null>(null);
  // ゴミ箱の小窓。復元したノートは "notefable:page-created" で一覧に戻るので、開閉の状態だけここで持つ。
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
  const [expanded, toggleExpanded, expand] = useExpandedPages();
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

  // サブページの木。最上位のページだけをグループごとに並べ、子は開いた親の下に字下げして出す。
  const children = childrenByParent(pages);
  const roots = rootPages(pages);
  const loose = roots.filter((page) => !page.groupId || !groups.some((group) => group.id === page.groupId));
  const favorites = pages.filter((page) => page.favoritedAt).sort((a, b) => (a.favoritedAt ?? "").localeCompare(b.favoritedAt ?? ""));
  // 開いているページの祖先は、閉じていても開いて見せる。
  const activeAncestors = new Set(activeId ? ancestorsOf(pages, activeId).map((page) => page.id) : []);
  // キーボードでの並べ替えは、同じ親・同じグループの兄弟の中で動かす。
  const known = new Set(pages.map((page) => page.id));
  const siblingIds = (page: NotePageSummary) => (children.get(page.parentId && known.has(page.parentId) ? page.parentId : null) ?? [])
    .filter((item) => item.groupId === page.groupId).map((item) => item.id);
  const tree = (page: NotePageSummary): ReactNode => {
    const kids = children.get(page.id) ?? [];
    // Notion と同じく、どのページにも開閉の矢印を出す（サブページがなければ「No pages inside」）。
    const open = !!expanded[page.id] || (kids.length > 0 && activeAncestors.has(page.id));
    return <div key={page.id}>
      {row(page, open)}
      {open && <div className="notes-group-members notes-subpages">
        {kids.length ? kids.map(tree) : <p className="notes-subpages-empty">{t("No pages inside")}</p>}
      </div>}
    </div>;
  };
  const row = (page: NotePageSummary, open = false) => (
    <div key={page.id} className={`notion-session-row vt-row group ${activeId === page.id ? "is-active" : ""}`} style={rowName(`nrow-${page.id}`)} data-order-id={page.id} data-order-scope="note">
      <button type="button" className="notes-row-toggle" aria-expanded={open} onClick={() => toggleExpanded(page.id, !open)}
        aria-label={open ? t("Collapse {title}", { title: page.title }) : t("Expand {title}", { title: page.title })}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      <button type="button" disabled={busy || page.locked === true} className="chat-row-icon-button" aria-label={t("Change icon of {title}", { title: page.title })} title={t("Change icon")}
        aria-haspopup="dialog" aria-expanded={picker?.id === page.id}
        onClick={(event) => {
          triggerRef.current = event.currentTarget;
          const position = floatingPositionFor(event.currentTarget.getBoundingClientRect());
          setPicker(picker?.id === page.id ? null : { id: page.id, position });
        }}>
        <span className="notes-row-icon" aria-hidden="true">{page.icon ?? <FileText size={15} />}</span>
      </button>
      <ReorderHandle id={page.id} title={page.title} scope="note" ids={siblingIds(page)} disabled={busy} onMove={onReorder} onOpen={() => onSelect(page.id)} className="flex min-w-0 flex-1 items-center py-1.5 pl-1 pr-2 text-left" onMoveGroup={async groupId=>{
        const ok=await onMoveNote(page.id,groupId);
        if(ok && groupId)setCollapsed(current=>{
          const next={...current,[groupId]:false};
          try{localStorage.setItem(COLLAPSED_KEY,JSON.stringify(next));}catch{/* Keep the current view usable without storage. */}
          return next;
        });
        return ok;
      }}>
        <span className="truncate text-sm">{page.title}</span>
      </ReorderHandle>
      <button type="button" disabled={busy} onClick={() => { expand(page.id); onCreate(page.id); }} className="notion-row-action" aria-label={t("Add a page inside {title}", { title: page.title })} title={t("Add a page inside")}><Plus size={14} /></button>
      <button type="button" disabled={busy} onClick={() => setMoving(page)} className="notion-row-action notes-move-action" aria-label={t("Move {title} to a project", { title: page.title })} title={t("Move to project")}><FolderInput size={14} /></button>
      <button type="button" disabled={busy} onClick={() => setDeleting(page)} className="notion-row-action" aria-label={t("Move {title} to Trash", { title: page.title })} title={t("Move to Trash")}><Trash2 size={14} /></button>
    </div>
  );

  return (
    <aside className="notion-sidebar" data-reorder-list>
      <div className="flex h-12 items-center justify-between px-3">
        <NoteFableLogo />
        <button type="button" className="notion-icon-button grid" onClick={onClose} aria-label={t("Close sidebar")}><PanelLeftClose size={17} /></button>
      </div>
      <WorkspaceNav view="pages" onChange={onWorkspaceChange} />
      <div className="mt-3 px-2">
        <button type="button" className="sidebar-primary-action" disabled={busy} onClick={() => onCreate()}><Plus size={16} /><span>{t("New note")}</span></button>
        <button type="button" className={`notion-sidebar-action notes-sidebar-home ${home ? "is-active" : ""}`} aria-current={home ? "page" : undefined} onClick={onHome}>
          <House size={16} /><span>{t("Home")}</span>
        </button>
        <button type="button" className="notion-sidebar-action" onClick={onSearch} aria-keyshortcuts="Control+K Meta+K">
          <Search size={16} /><span>{t("Search")}</span><kbd className="sidebar-search-hint" aria-hidden="true">{t("Ctrl K")}</kbd>
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {favorites.length > 0 && <>
          <div className="chat-section-label">{t("Favorites")}</div>
          {favorites.map((page) => <div key={page.id} className={`notion-session-row group ${activeId === page.id ? "is-active" : ""}`}>
            <span className="chat-row-icon-button" aria-hidden="true"><span className="notes-row-icon">{page.icon ?? <FileText size={15} />}</span></span>
            <button type="button" disabled={busy} onClick={() => onSelect(page.id)} className="flex min-w-0 flex-1 items-center py-1.5 pl-1 pr-2 text-left" title={page.title}>
              <span className="truncate text-sm">{page.title}</span>
            </button>
            <button type="button" disabled={busy} onClick={() => void onFavorite(page.id, false)} className="notion-row-action" aria-label={t("Remove {title} from Favorites", { title: page.title })} title={t("Remove from Favorites")}><StarOff size={14} /></button>
          </div>)}
        </>}
        <div className="chat-project-heading">
          <span>{t("Projects")}</span>
          <button type="button" className="notion-icon-button" onClick={() => setNaming({ mode: "create" })} aria-label={t("New project")} title={t("New project")}><Plus size={15} /></button>
        </div>
        {groups.map((group) => {
          const members = roots.filter((page) => page.groupId === group.id);
          // 数はサブページも含めた、この項目のページ数。
          const total = pages.filter((page) => page.groupId === group.id).length;
          const open = !collapsed[group.id];
          return (
            <div key={group.id}>
              <div className="notion-session-row group" data-note-group-drop={group.id}>
                <button type="button" onClick={() => toggle(group.id)} aria-expanded={open} className="chat-project-toggle" title={group.name}>
                  {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <Folder size={15}/>
                  <span className="truncate text-sm font-medium">{group.name}</span>
                  <span className="text-xs text-[var(--notion-faint)]">{total}</span>
                </button>
                <button type="button" onClick={() => setNaming({ mode: "rename", group })} className="notion-row-action" aria-label={t("Rename {name}", { name: group.name })}><Pencil size={13} /></button>
                <button type="button" onClick={() => setDeletingGroup(group)} className="notion-row-action" aria-label={t("Delete project {name}", { name: group.name })}><Trash2 size={14} /></button>
              </div>
              {open && <div className="notes-group-members">
                {members.length ? members.map(tree) : <p className="px-2 py-1.5 text-xs text-[var(--notion-faint)]">{t("No notes in this project.")}</p>}
              </div>}
            </div>
          );
        })}
        {iconError && <p role="alert" className="px-2 text-xs text-[#b91c1c]">{t(iconError)}</p>}
        <div className="chat-section-label" data-note-group-drop="">{t("Notes")}</div>
        {loose.map(tree)}
        {!pages.length && <p className="px-2 py-3 text-xs leading-5 text-[var(--notion-muted)]">{t("Your notes will appear here.")}</p>}
      </div>
      <div className="shrink-0 px-2 pb-1">
        <button type="button" className="notion-sidebar-action" aria-haspopup="dialog" onClick={() => setTrashOpen(true)}><Trash2 size={16} /><span>{t("Trash")}</span></button>
      </div>
      {deleting && <dialog ref={dialog} onCancel={() => setDeleting(null)} aria-labelledby="delete-page-title" aria-describedby="delete-page-description" className="notes-dialog">
          <h2 id="delete-page-title" className="text-base font-semibold">{t("Move note to Trash?")}</h2>
          <p id="delete-page-description" className="mt-2 text-sm text-[var(--notion-muted)]">{t("“{title}” will be moved to Trash. You can restore it for {count} days.", { title: deleting.title, count: TRASH_RETENTION_DAYS })}{children.has(deleting.id) ? ` ${t("Its sub-pages move to Trash with it.")}` : ""}</p>
          <div className="mt-5 flex justify-end gap-2">
            <button autoFocus type="button" disabled={busy} className="notion-button" onClick={() => setDeleting(null)}>{t("Cancel")}</button>
            <button type="button" disabled={busy} className="notion-button notes-delete" onClick={async () => { await onDelete(deleting.id); setDeleting(null); }}>{t("Move to Trash")}</button>
          </div>
      </dialog>}
      {trashOpen && <NoteTrashDialog onClose={() => setTrashOpen(false)} />}
      {moving && <MoveNoteDialog page={pages.find((page) => page.id === moving.id) ?? moving} groups={groups} error={groupError}
        onMove={onMoveNote} onCreateGroup={onCreateGroup} onClose={() => setMoving(null)} pages={pages}
        onMoveToPage={async (pageId, parentId) => { const ok = await onMoveToPage(pageId, parentId); if (ok) expand(parentId); return ok; }} />}
      {naming && <GroupNameDialog title={naming.mode === "create" ? t("New project") : t("Rename project")} initial={naming.mode === "rename" ? naming.group.name : ""}
        submitLabel={naming.mode === "create" ? t("Create") : t("Save")} error={groupError} onClose={() => setNaming(null)}
        onSubmit={async (name) => naming.mode === "create" ? Boolean(await onCreateGroup(name)) : Boolean(await onRenameGroup(naming.group.id, name))} />}
      {deletingGroup && <ConfirmDialog title={t("Delete project?")} confirmLabel={t("Delete project")} error={groupError} onClose={() => setDeletingGroup(null)}
        body={t("“{name}” will be deleted. Its notes are kept and move out of the project.", { name: deletingGroup.name })}
        onConfirm={async () => Boolean(await onDeleteGroup(deletingGroup.id))} />}
      <SidebarFooter />
      {picker && pickerPage && (
        <FloatingEmojiPopover position={picker.position} trigger={triggerRef} current={pickerPage.icon}
          onChange={async (icon) => { setIconError(""); if (!(await onChangeIcon(pickerPage.id, icon))) setIconError(msg("Could not change the icon. Try again.")); }} onClose={closePicker} />
      )}
    </aside>
  );
}
