"use client";

import { ChevronDown, ChevronRight, Ellipsis, Folder, FolderInput, House, PanelLeftClose, Pencil, Plus, Search, Star, StarOff, Trash2, Upload } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AnswerMenu } from "@/components/answer-actions";
import { FloatingEmojiPopover, floatingPositionFor, usePickerBackToClose, type FloatingPosition } from "@/components/emoji-picker";
import { ReorderRowButton } from "@/components/reorder-row-button";
import type { ReorderRequest } from "@/lib/list-order";
import { SidebarFooter } from "@/components/sidebar-footer";
import { ConfirmDialog, GroupNameDialog, MoveNoteDialog, RenamePageDialog } from "@/components/note-group-dialogs";
import { NoteTrashDialog } from "@/components/note-trash-dialog";
import { NoteFableLogo } from "@/components/app-icon";
import { WorkspaceNav, type WorkspaceView } from "@/components/workspace-nav";
import { ancestorsOf, childrenByParent, rootPages } from "@/lib/note-tree";
import { creatablePageKinds, PAGE_KIND_NEW_LABELS, PAGE_KIND_SECTION_LABELS, type PageKind } from "@/lib/page-kinds";
import { sectionKindOf, workspaceSections, type NewPageRequest } from "@/lib/workspace-sections";
import { NewPageButton } from "@/components/new-page-button";
import { useExpandedPages } from "@/lib/use-expanded-pages";
import { rowName } from "@/lib/view-transition";
import { TRASH_RETENTION_DAYS, type NoteGroupSummary, type NotePageSummary } from "@/types/notes";
import { useT } from "@/components/i18n-provider";
import { msg } from "@/lib/i18n/translate";
import { NoteIcon } from "@/components/note-icon";
import { PageKindIcon } from "@/components/page-kind-icon";

const COLLAPSED_KEY = "notefable:note-groups-collapsed:v1";
// 分区（ノート・スライド・ホワイトボード）の折りたたみ。種類 → true。プロジェクトと同じく端末に覚えておく。
const SECTIONS_COLLAPSED_KEY = "notefable:workspace-sections-collapsed:v1";

function readCollapsed(key: string): Record<string, boolean> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, boolean> : {};
  } catch { return {}; }
}

type GroupActions = {
  groups: NoteGroupSummary[]; groupError: string;
  onReorder: (move:ReorderRequest)=>Promise<unknown>;
  onMoveNote: (pageId: string, groupId: string | null) => Promise<unknown>;
  // 行のアイコンから変える。失敗したら null。
  onChangeIcon: (pageId: string, icon: string | null) => Promise<unknown>;
  onRenamePage: (pageId: string, title: string) => Promise<unknown>;
  onCreateGroup: (name: string) => Promise<NoteGroupSummary | null>;
  onRenameGroup: (id: string, name: string) => Promise<unknown>;
  onDeleteGroup: (id: string) => Promise<unknown>;
  onMoveToPage: (pageId: string, parentId: string) => Promise<unknown>;
  onFavorite: (pageId: string, favorite: boolean) => Promise<unknown>;
};

export function NotesSidebar({ pages, activeId, busy, home, onHome, onCreate, onGenerateSlides, onImport, onSearch, onSelect, onPrefetch, onCancelPrefetch, onDelete, onClose, onWorkspaceChange, groups, groupError, onMoveNote, onChangeIcon, onRenamePage, onCreateGroup, onRenameGroup, onDeleteGroup, onReorder, onMoveToPage, onFavorite }: {
  pages: NotePageSummary[]; activeId: string | null; busy: boolean;
  // Notes のホーム（最近のノートと一覧）を出しているか、とホームへ戻る操作。
  home: boolean; onHome: () => void;
  // 作り先（種類・親ページ・プロジェクト）を渡して新しいページを作る。省略はプロジェクトなしのノート。
  onWorkspaceChange: (view: WorkspaceView) => void; onCreate: (request?: NewPageRequest) => void;
  // AI のスライド生成の窓を開く。作り先（プロジェクト・親ページ）はそのまま渡す。
  onGenerateSlides?: (placement?: { groupId?: string; parentId?: string }) => void; onImport: (files: File[]) => void; onSearch: () => void; onSelect: (id: string) => void; onPrefetch?: (id: string, immediate?: boolean) => void; onCancelPrefetch?: (id?: string) => void; onDelete: (id: string) => Promise<unknown>; onClose: () => void;
} & GroupActions) {
  const t = useT();
  const rowMenuId = useId();
  const importInputRef = useRef<HTMLInputElement>(null);
  const [deleting, setDeleting] = useState<NotePageSummary | null>(null);
  // ゴミ箱の小窓。復元したノートは "notefable:page-created" で一覧に戻るので、開閉の状態だけここで持つ。
  const [trashOpen, setTrashOpen] = useState(false);
  const [moving, setMoving] = useState<NotePageSummary | null>(null);
  const [renamingPage, setRenamingPage] = useState<NotePageSummary | null>(null);
  const [rowMenu, setRowMenu] = useState<{ page: NotePageSummary; anchor: DOMRect; trigger: HTMLButtonElement; focusLast: boolean } | null>(null);
  const [naming, setNaming] = useState<{ mode: "create" } | { mode: "rename"; group: NoteGroupSummary } | null>(null);
  const [deletingGroup, setDeletingGroup] = useState<NoteGroupSummary | null>(null);
  // 折りたたみの状態は端末に覚えておく。この側のパネルは Notes に切り替えた後にだけ作られるので、初期値で読んでもサーバー描画とずれない。
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => readCollapsed(COLLAPSED_KEY));
  const [sectionsCollapsed, setSectionsCollapsed] = useState<Record<string, boolean>>(() => readCollapsed(SECTIONS_COLLAPSED_KEY));
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
  // プロジェクトに入れた・作ったページが見えるよう、閉じていたら開く。
  function openGroup(id: string) {
    setCollapsed((current) => {
      if (!current[id]) return current;
      const next = { ...current, [id]: false };
      try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next)); } catch { /* Keep the current view usable without storage. */ }
      return next;
    });
  }
  function setSectionOpen(kind: PageKind, open: boolean) {
    setSectionsCollapsed((current) => {
      if (!current[kind] === open) return current;
      const next = { ...current, [kind]: !open };
      try { localStorage.setItem(SECTIONS_COLLAPSED_KEY, JSON.stringify(next)); } catch { /* 保存できなくても動作は変えない。 */ }
      return next;
    });
  }

  // サブページの木。最上位のページをプロジェクトごと（種類は混ぜる）と、プロジェクトなしは種類ごとの分区に並べ、子は開いた親の下に字下げして出す。
  // 分区とメニューに出る種類は、作れる種類（エディターがある種類）だけ（#168）。
  const kinds = creatablePageKinds();
  const children = childrenByParent(pages);
  const roots = rootPages(pages);
  const sections = workspaceSections(pages, groups, kinds);
  const sectionOf = new Map(sections.flatMap((section) => section.roots.map((page) => [page.id, section] as const)));
  const favorites = pages.filter((page) => page.favoritedAt).sort((a, b) => (a.favoritedAt ?? "").localeCompare(b.favoritedAt ?? ""));
  // 開いているページの祖先は、閉じていても開いて見せる。
  const activeAncestors = new Set(activeId ? ancestorsOf(pages, activeId).map((page) => page.id) : []);
  // キーボードでの並べ替えは、同じ親・同じグループの兄弟の中で動かす。
  const known = new Set(pages.map((page) => page.id));
  // プロジェクトなしの最上位は、同じ分区の中だけで動かす。
  const siblingIds = (page: NotePageSummary) => sectionOf.get(page.id)?.roots.map((item) => item.id) ?? (children.get(page.parentId && known.has(page.parentId) ? page.parentId : null) ?? [])
    .filter((item) => item.groupId === page.groupId).map((item) => item.id);
  const create = (request: NewPageRequest) => {
    if (request.parentId) expand(request.parentId);
    if (request.groupId) openGroup(request.groupId);
    if (!request.parentId && !request.groupId) setSectionOpen(request.kind ?? "note", true);
    onCreate(request);
  };
  const generate = (placement?: { groupId?: string; parentId?: string }) => (onGenerateSlides ? () => onGenerateSlides(placement) : undefined);
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
  const row = (page: NotePageSummary, open = false) => {
    const menuOpen = rowMenu?.page.id === page.id;
    return (
    // data-page-kind はこのページが並ぶ分区（拖動したときに放せる分区）、data-drop-kind は分区の最上位の行（同じ分区のページだけを前後に放せる）。
    <div key={page.id} className={`notion-session-row vt-row group${activeId === page.id ? " is-active" : ""}${menuOpen ? " is-menu-open" : ""}`} style={rowName(`nrow-${page.id}`)} data-order-id={page.id} data-order-scope="note"
      data-page-kind={sectionKindOf(page, kinds)} data-drop-kind={sectionOf.get(page.id)?.kind}>
      <button type="button" className="notes-row-toggle" aria-expanded={open} onClick={() => toggleExpanded(page.id, !open)}
        aria-label={open ? t("Collapse {title}", { title: page.title }) : t("Expand {title}", { title: page.title })}>
        <ChevronRight size={13} className={`sidebar-chevron rtl-mirror${open ? " is-open" : ""}`} />
      </button>
      <button type="button" disabled={busy || page.locked === true} className="chat-row-icon-button" aria-label={t("Change icon of {title}", { title: page.title })} title={t("Change icon")}
        aria-haspopup="dialog" aria-expanded={picker?.id === page.id}
        onClick={(event) => {
          triggerRef.current = event.currentTarget;
          const position = floatingPositionFor(event.currentTarget.getBoundingClientRect());
          setPicker(picker?.id === page.id ? null : { id: page.id, position });
        }}>
        <span className="notes-row-icon" aria-hidden="true"><NoteIcon icon={page.icon} fallback={<PageKindIcon kind={page.kind} size={15} />} /></span>
      </button>
      <ReorderRowButton id={page.id} title={page.title} scope="note" ids={siblingIds(page)} disabled={busy} onMove={onReorder} onOpen={() => onSelect(page.id)}
        onPrefetch={onPrefetch ? (immediate) => onPrefetch(page.id, immediate) : undefined}
        onCancelPrefetch={onCancelPrefetch ? () => onCancelPrefetch(page.id) : undefined}
        className="flex min-w-0 flex-1 items-center py-1.5 ps-1 pe-2 text-start" onMoveGroup={async groupId=>{
        const ok=await onMoveNote(page.id,groupId);
        if(ok && groupId)openGroup(groupId);
        else if(ok)setSectionOpen(sectionKindOf(page,kinds),true);
        return ok;
      }}>
        <span className="truncate text-[13.5px] leading-5">{page.title}</span>
      </ReorderRowButton>
      <span className="sidebar-row-actions">
        <button type="button" disabled={busy} className="notion-row-action"
          aria-label={t("Actions for {title}", { title: page.title })} title={t("Page options")}
          aria-haspopup="menu" aria-expanded={menuOpen} aria-controls={menuOpen ? rowMenuId : undefined}
          onClick={(event) => setRowMenu({ page, anchor: event.currentTarget.getBoundingClientRect(), trigger: event.currentTarget, focusLast: false })}
          onKeyDown={(event) => {
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
            event.preventDefault();
            setRowMenu({ page, anchor: event.currentTarget.getBoundingClientRect(), trigger: event.currentTarget, focusLast: event.key === "ArrowUp" });
          }}>
          <Ellipsis size={14} />
        </button>
        <NewPageButton kinds={kinds} busy={busy} onCreate={(kind) => create({ kind, parentId: page.id })} onGenerate={generate({ parentId: page.id })} className="notion-row-action"
          label={t("Add a page inside {title}", { title: page.title })} title={t("Add a page inside")} menuLabel={t("Add a page inside {title}", { title: page.title })}><Plus size={14} /></NewPageButton>
      </span>
    </div>
    );
  };

  return (
    <aside className="notion-sidebar" data-reorder-list>
      <div className="sidebar-header flex h-12 items-center justify-between px-3.5">
        <NoteFableLogo />
        <button type="button" className="notion-icon-button grid" onClick={onClose} aria-label={t("Close sidebar")} title={t("Toggle sidebar (Ctrl+B)")}><PanelLeftClose size={17} className="rtl-mirror" /></button>
      </div>
      <WorkspaceNav view="pages" onChange={onWorkspaceChange} />
      <div className="sidebar-top-actions mt-2.5 flex flex-col gap-1.5 px-2.5">
        {/* 作れる種類がノートだけなら「New note」（押すとすぐノート）、2 つ以上なら「New」で種類を選ぶ。 */}
        <NewPageButton kinds={kinds} busy={busy} onCreate={(kind) => create({ kind })} onGenerate={generate()} className="sidebar-primary-action" menuLabel={t("New page")}>
          <Plus size={15} strokeWidth={2.2} /><span>{kinds.length > 1 ? t("New") : t("New note")}</span>
          {kinds.length > 1 && <ChevronDown size={14} className="sidebar-primary-chevron" aria-hidden="true" />}
        </NewPageButton>
        <button type="button" className={`notion-sidebar-action notes-sidebar-home ${home ? "is-active" : ""}`} aria-current={home ? "page" : undefined} onClick={onHome}>
          <House size={15} /><span>{t("Home")}</span>
        </button>
        <button type="button" className="notion-sidebar-action sidebar-search-trigger" onClick={onSearch} aria-keyshortcuts="Control+K Meta+K">
          <Search size={15} /><span>{t("Search")}</span><kbd className="sidebar-search-hint" aria-hidden="true">{t("Ctrl K")}</kbd>
        </button>
      </div>
      <div className="sidebar-scroll min-h-0 flex-1 overflow-y-auto px-2.5 pb-4">
        {favorites.length > 0 && <div className="sidebar-group">
          <div className="chat-section-label sidebar-section-inline">
            <span className="sidebar-section-badge is-fav" aria-hidden="true"><Star size={11.5} className="sidebar-fav-star" /></span>
            <span className="truncate">{t("Favorites")}</span>
            <span className="sidebar-section-count">{favorites.length}</span>
          </div>
          {favorites.map((page) => <div key={page.id} className={`notion-session-row group ${activeId === page.id ? "is-active" : ""}`} data-page-kind={page.kind}>
            <span className="chat-row-icon-button" aria-hidden="true"><span className="notes-row-icon"><NoteIcon icon={page.icon} fallback={<PageKindIcon kind={page.kind} size={15} />} /></span></span>
            <button type="button" disabled={busy} onClick={() => onSelect(page.id)}
              onPointerEnter={(event) => { if (event.pointerType !== "touch") onPrefetch?.(page.id, false); }}
              onPointerLeave={() => onCancelPrefetch?.(page.id)}
              onPointerDown={(event) => { if (event.pointerType !== "touch" && event.button === 0) onPrefetch?.(page.id, true); }}
              onFocus={() => onPrefetch?.(page.id, true)}
              className="flex min-w-0 flex-1 items-center py-1.5 ps-1 pe-2 text-start" title={page.title}>
              <span className="truncate text-[13.5px] leading-5">{page.title}</span>
            </button>
            <span className="sidebar-row-actions">
              {page.locked !== true && (
                <button type="button" disabled={busy} onClick={() => setRenamingPage(page)} className="notion-row-action" aria-label={t("Rename {name}", { name: page.title })} title={t("Rename")}><Pencil size={13} /></button>
              )}
              <button type="button" disabled={busy} onClick={() => void onFavorite(page.id, false)} className="notion-row-action" aria-label={t("Remove {title} from Favorites", { title: page.title })} title={t("Remove from Favorites")}><StarOff size={13.5} /></button>
            </span>
          </div>)}
        </div>}
        <div className="sidebar-group">
          <div className="chat-project-heading">
            <span className="sidebar-section-inline min-w-0">
              <span className="sidebar-section-badge is-projects" aria-hidden="true"><Folder size={11.5} /></span>
              <span className="truncate">{t("Projects")}</span>
              {groups.length > 0 && <span className="sidebar-section-count">{groups.length}</span>}
            </span>
            <button type="button" className="notion-icon-button sidebar-heading-add" onClick={() => setNaming({ mode: "create" })} aria-label={t("New project")} title={t("New project")}><Plus size={14} /></button>
          </div>
          {groups.map((group) => {
            const members = roots.filter((page) => page.groupId === group.id);
            // 数はサブページも含めた、この項目のページ数。
            const total = pages.filter((page) => page.groupId === group.id).length;
            const open = !collapsed[group.id];
            return (
              <div key={group.id}>
                <div className="notion-session-row sidebar-project-row group" data-note-group-drop={group.id}>
                  <button type="button" onClick={() => toggle(group.id)} aria-expanded={open} className="chat-project-toggle" title={group.name}>
                    <ChevronRight size={13} className={`sidebar-chevron rtl-mirror${open ? " is-open" : ""}`} />
                    <Folder size={14.5} className="shrink-0 text-[var(--notion-muted)]" />
                    <span className="truncate text-[13.5px] font-medium">{group.name}</span>
                    <span className="sidebar-count-pill">{total}</span>
                  </button>
                  <span className="sidebar-row-actions">
                    <NewPageButton kinds={kinds} busy={busy} onCreate={(kind) => create({ kind, groupId: group.id })} onGenerate={generate({ groupId: group.id })} className="notion-row-action"
                      label={t("New page in {name}", { name: group.name })} menuLabel={t("New page in {name}", { name: group.name })}><Plus size={14} /></NewPageButton>
                    <button type="button" onClick={() => setNaming({ mode: "rename", group })} className="notion-row-action" aria-label={t("Rename {name}", { name: group.name })}><Pencil size={13} /></button>
                    <button type="button" onClick={() => setDeletingGroup(group)} className="notion-row-action is-danger" aria-label={t("Delete project {name}", { name: group.name })}><Trash2 size={13.5} /></button>
                  </span>
                </div>
                {open && <div className="notes-group-members">
                  {members.length ? members.map(tree) : <p className="px-2 py-1.5 text-xs text-[var(--notion-faint)]">{t("No pages in this project.")}</p>}
                </div>}
              </div>
            );
          })}
        </div>
        {iconError && <p role="alert" className="px-2 text-xs text-[#b91c1c]">{t(iconError)}</p>}
        {/* 分区（ノート・スライド・ホワイトボード）：プロジェクトに入っていない最上位のページを種類ごとに。見出しは押すと折りたたみ、
            「+」はその種類を作る。見出しはプロジェクトから外す放し先で、同じ分区に並ぶページだけを受ける。 */}
        {sections.map((section) => {
          const label = t(PAGE_KIND_SECTION_LABELS[section.kind]);
          const open = !sectionsCollapsed[section.kind];
          return <div key={section.kind} className="notes-section sidebar-group">
            <div className="chat-project-heading notes-section-heading" data-note-group-drop="" data-drop-kind={section.kind}>
              <button type="button" className="notes-section-toggle" aria-expanded={open} onClick={() => setSectionOpen(section.kind, !open)}
                aria-label={open ? t("Collapse {title}", { title: label }) : t("Expand {title}", { title: label })}>
                <span className={`sidebar-section-badge is-${section.kind}`} aria-hidden="true">
                  <PageKindIcon kind={section.kind} size={12} />
                </span>
                <span className="truncate">{label}</span>
                {section.count > 0 && <span className="sidebar-section-count">{section.count}</span>}
                <ChevronRight size={12.5} className={`sidebar-chevron rtl-mirror${open ? " is-open" : ""}`} aria-hidden="true" />
              </button>
              {/* スライドの分区の「+」は「New slide deck」と「Generate with AI」のメニュー。他の分区は押すとすぐ作る。 */}
              <NewPageButton kinds={[section.kind]} busy={busy} onCreate={(kind) => create({ kind })} onGenerate={generate()} className="notion-icon-button sidebar-heading-add"
                label={t(PAGE_KIND_NEW_LABELS[section.kind])} menuLabel={t(PAGE_KIND_NEW_LABELS[section.kind])}><Plus size={14} /></NewPageButton>
            </div>
            {open && section.roots.map(tree)}
            {open && section.kind === "note" && !pages.length && <p className="px-2 py-2.5 text-xs leading-5 text-[var(--notion-faint)]">{t("Your notes will appear here.")}</p>}
          </div>;
        })}
      </div>
      <div className="sidebar-utility-footer shrink-0 px-2.5 py-1.5">
        <input ref={importInputRef} type="file" multiple accept=".md,.markdown,.txt,text/markdown,text/plain" className="sr-only"
          onChange={(event) => {
            const picked = Array.from(event.target.files ?? []);
            event.target.value = "";
            if (picked.length) onImport(picked);
          }} />
        <button type="button" className="notion-sidebar-action is-subtle" disabled={busy} onClick={() => importInputRef.current?.click()}>
          <Upload size={15} /><span>{t("Import Markdown")}</span>
        </button>
        <button type="button" className="notion-sidebar-action is-subtle" aria-haspopup="dialog" onClick={() => setTrashOpen(true)}><Trash2 size={15} /><span>{t("Trash")}</span></button>
      </div>
      {deleting && <dialog ref={dialog} onCancel={() => setDeleting(null)} aria-labelledby="delete-page-title" aria-describedby="delete-page-description" className="notes-dialog">
          <h2 id="delete-page-title" className="text-base font-semibold">{t("Move page to Trash?")}</h2>
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
      {renamingPage && <RenamePageDialog page={pages.find((page) => page.id === renamingPage.id) ?? renamingPage} error={groupError}
        onClose={() => setRenamingPage(null)}
        onSubmit={async (title) => Boolean(await onRenamePage(renamingPage.id, title))} />}
      {rowMenu && (() => {
        const target = pages.find((page) => page.id === rowMenu.page.id) ?? rowMenu.page;
        const closeMenu = () => setRowMenu(null);
        return (
          <AnswerMenu id={rowMenuId} label={t("Actions for {title}", { title: target.title })} className="chat-row-menu"
            anchor={rowMenu.anchor} trigger={rowMenu.trigger} focusLast={rowMenu.focusLast} onClose={closeMenu}>
            {target.locked !== true && (
              <button type="button" role="menuitem" className="chat-menu-item" onClick={() => { closeMenu(); setRenamingPage(target); }}>
                <Pencil size={15} aria-hidden="true" />{t("Rename")}
              </button>
            )}
            <button type="button" role="menuitem" className="chat-menu-item" onClick={() => { closeMenu(); void onFavorite(target.id, !target.favoritedAt); }}>
              {target.favoritedAt ? <StarOff size={15} aria-hidden="true" /> : <Star size={15} aria-hidden="true" />}
              {target.favoritedAt ? t("Remove from Favorites") : t("Add to Favorites")}
            </button>
            <button type="button" role="menuitem" className="chat-menu-item" onClick={() => { closeMenu(); setMoving(target); }}>
              <FolderInput size={15} aria-hidden="true" />{t("Move to")}
            </button>
            <hr className="chat-menu-divider" />
            <button type="button" role="menuitem" className="chat-menu-item is-danger" onClick={() => { closeMenu(); setDeleting(target); }}>
              <Trash2 size={15} aria-hidden="true" />{t("Move to Trash")}
            </button>
          </AnswerMenu>
        );
      })()}
      {naming && <GroupNameDialog title={naming.mode === "create" ? t("New project") : t("Rename project")} initial={naming.mode === "rename" ? naming.group.name : ""}
        submitLabel={naming.mode === "create" ? t("Create") : t("Save")} error={groupError} onClose={() => setNaming(null)}
        onSubmit={async (name) => naming.mode === "create" ? Boolean(await onCreateGroup(name)) : Boolean(await onRenameGroup(naming.group.id, name))} />}
      {deletingGroup && <ConfirmDialog title={t("Delete project?")} confirmLabel={t("Delete project")} error={groupError} onClose={() => setDeletingGroup(null)}
        body={t("“{name}” will be deleted. Its pages are kept and move out of the project.", { name: deletingGroup.name })}
        onConfirm={async () => Boolean(await onDeleteGroup(deletingGroup.id))} />}
      <SidebarFooter />
      {picker && pickerPage && (
        <FloatingEmojiPopover position={picker.position} trigger={triggerRef} current={pickerPage.icon} allowUpload
          onChange={async (icon) => { setIconError(""); if (!(await onChangeIcon(pickerPage.id, icon))) setIconError(msg("Could not change the icon. Try again.")); }} onClose={closePicker} />
      )}
    </aside>
  );
}
