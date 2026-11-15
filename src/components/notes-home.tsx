import { ChevronDown, ChevronRight, Clock3, FileText, FolderInput, FolderPlus, Plus } from "lucide-react";
import { useState } from "react";
import { ReorderHandle } from "@/components/reorder-handle";
import type { ReorderRequest } from "@/lib/list-order";
import { GroupNameDialog, MoveNoteDialog } from "@/components/note-group-dialogs";
import { WorkspaceSwitch, type WorkspaceView } from "@/components/workspace-nav";
import { childrenByParent, rootPages } from "@/lib/note-tree";
import { useExpandedPages } from "@/lib/use-expanded-pages";
import { rowName } from "@/lib/view-transition";
import type { NoteGroupSummary, NotePageSummary } from "@/types/notes";
import { useI18n } from "@/components/i18n-provider";
import { greetingFor, recentPages, relativeTime } from "@/lib/notes-home-text";

// Notes のホーム: 作成済みのノートをグループごとに並べて、押したものを開く。ノートが 0 件のときは呼び出し側が空状態を出す。
// パソコン幅（640px 以上）では、上にあいさつと「最近編集したノート」のカードを出す（スマホ幅は一覧だけ）。
export function NotesHome({ pages, groups, groupError, busy, onOpen, onCreate, onWorkspaceChange, onMoveNote, onCreateGroup, onReorder, onMoveToPage }: {
  onMoveToPage: (pageId: string, parentId: string) => Promise<unknown>;
  pages: NotePageSummary[];
  onReorder:(move:ReorderRequest)=>Promise<unknown>;
  groups: NoteGroupSummary[];
  groupError: string;
  busy: boolean;
  onOpen: (id: string) => void;
  onCreate: () => void;
  onWorkspaceChange: (view: WorkspaceView) => void;
  onMoveNote: (pageId: string, groupId: string | null) => Promise<unknown>;
  onCreateGroup: (name: string) => Promise<NoteGroupSummary | null>;
}) {
  const { t, tag } = useI18n();
  const [moving, setMoving] = useState<NotePageSummary | null>(null);
  const [creatingGroup, setCreatingGroup] = useState(false);
  // ホームを開いた時刻。あいさつと相対時刻の基準にする。
  const [openedAt] = useState(() => Date.now());
  const recent = recentPages(pages);
  const relative = new Intl.RelativeTimeFormat(tag, { numeric: "auto" });
  const known = new Set(groups.map((group) => group.id));
  // サブページの木。最上位のページをグループごとに並べ、子は開いた親の下に字下げして出す（開閉はサイドバーと共有）。
  const children = childrenByParent(pages);
  const roots = rootPages(pages);
  const loose = roots.filter((page) => !page.groupId || !known.has(page.groupId));
  const favorites = pages.filter((page) => page.favoritedAt).sort((a, b) => (a.favoritedAt ?? "").localeCompare(b.favoritedAt ?? ""));
  const [expanded, toggleExpanded] = useExpandedPages();
  const ids = new Set(pages.map((page) => page.id));
  const siblingIds = (page: NotePageSummary) => (children.get(page.parentId && ids.has(page.parentId) ? page.parentId : null) ?? [])
    .filter((item) => item.groupId === page.groupId).map((item) => item.id);
  const item = (page: NotePageSummary) => {
    const kids = children.get(page.id) ?? [];
    // サイドバーと同じく、どのページにも開閉の矢印を出す（サブページがなければ「No pages inside」）。
    const open = !!expanded[page.id];
    return <li key={page.id} className="notes-home-node">
      <div className="notes-home-item vt-row" style={rowName(`hrow-${page.id}`)} data-order-id={page.id} data-order-scope="note">
      <ReorderHandle id={page.id} title={page.title} scope="note" ids={siblingIds(page)} disabled={busy} onMove={onReorder} onMoveGroup={groupId=>onMoveNote(page.id,groupId)}/>
      <button type="button" className="notes-home-toggle" aria-expanded={open} onClick={() => toggleExpanded(page.id, !open)}
        aria-label={open ? t("Collapse {title}", { title: page.title }) : t("Expand {title}", { title: page.title })}>
        {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
      </button>
      <button type="button" className="notes-home-row" disabled={busy} onClick={() => onOpen(page.id)}>
        <span className="notes-home-icon" aria-hidden="true">{page.icon ?? <FileText size={20} />}</span>
        <span className="notes-home-name">{page.title}</span>
        <time className="notes-home-date" dateTime={page.updatedAt}>
          {new Date(page.updatedAt).toLocaleDateString(tag, { month: "short", day: "numeric" })}
        </time>
      </button>
      <button type="button" className="notes-home-move" disabled={busy} onClick={() => setMoving(page)} aria-label={t("Move {title} to a project", { title: page.title })}><FolderInput size={18} /></button>
      </div>
      {open && (kids.length ? <ul className="notes-home-list notes-home-sub">{kids.map(item)}</ul> : <p className="notes-home-empty notes-home-sub">{t("No pages inside")}</p>)}
    </li>;
  };
  return (
    <div className="notes-column notes-home" data-reorder-list>
      <div className="notion-home-switch"><WorkspaceSwitch view="pages" onChange={onWorkspaceChange} /></div>
      <div className="notes-home-hero">
        <h1 className="notes-home-greeting">{t(greetingFor(new Date(openedAt).getHours()))}</h1>
        <section aria-labelledby="notes-home-recent">
          <h2 id="notes-home-recent" className="notes-home-section"><Clock3 size={15} aria-hidden="true" />{t("Recently edited")}</h2>
          <ul className="notes-recent-list">
            {recent.map((page) => <li key={page.id}>
              <button type="button" className="notes-recent-card" disabled={busy} onClick={() => onOpen(page.id)}>
                <span className="notes-recent-cover" aria-hidden="true" />
                <span className="notes-recent-icon" aria-hidden="true">{page.icon ?? <FileText size={24} strokeWidth={1.6} />}</span>
                <span className="notes-recent-name">{page.title}</span>
                <time className="notes-recent-date" dateTime={page.updatedAt}>{relativeTime(page.updatedAt, openedAt, relative)}</time>
              </button>
            </li>)}
          </ul>
        </section>
        <h2 className="notes-home-section"><FileText size={15} aria-hidden="true" />{t("All notes")}</h2>
      </div>
      <h1 className="notes-home-title" data-note-group-drop="">{t("Notes")}</h1>
      {favorites.length > 0 && <section>
        <h2 className="notes-home-group">{t("Favorites")}<span>{favorites.length}</span></h2>
        <ul className="notes-home-list">{favorites.map((page) => <li key={page.id} className="notes-home-node"><div className="notes-home-item">
          <button type="button" className="notes-home-row" disabled={busy} onClick={() => onOpen(page.id)}>
            <span className="notes-home-icon" aria-hidden="true">{page.icon ?? <FileText size={20} />}</span>
            <span className="notes-home-name">{page.title}</span>
          </button>
        </div></li>)}</ul>
      </section>}
      {groups.map((group) => {
        const members = roots.filter((page) => page.groupId === group.id);
        const total = pages.filter((page) => page.groupId === group.id).length;
        return (
          <section key={group.id}>
            <h2 className="notes-home-group" data-note-group-drop={group.id}>{group.name}<span>{total}</span></h2>
            {members.length ? <ul className="notes-home-list">{members.map(item)}</ul> : <p className="notes-home-empty">{t("No notes in this project.")}</p>}
          </section>
        );
      })}
      {groups.length > 0 && loose.length > 0 && <h2 className="notes-home-group" data-note-group-drop="">{t("No project")}<span>{pages.filter((page) => !page.groupId || !known.has(page.groupId)).length}</span></h2>}
      {loose.length > 0 && <ul className="notes-home-list">{loose.map(item)}</ul>}
      <div className="notes-home-actions">
        <button type="button" className="notes-empty-new" disabled={busy} onClick={onCreate}><Plus size={16} />{t("New note")}</button>
        <button type="button" className="notion-button notes-home-new-group" disabled={busy} onClick={() => setCreatingGroup(true)}><FolderPlus size={16} />{t("New project")}</button>
      </div>
      {moving && <MoveNoteDialog page={pages.find((page) => page.id === moving.id) ?? moving} groups={groups} error={groupError}
        onMove={onMoveNote} onCreateGroup={onCreateGroup} onClose={() => setMoving(null)} pages={pages} onMoveToPage={onMoveToPage} />}
      {creatingGroup && <GroupNameDialog title={t("New project")} submitLabel={t("Create")} error={groupError} onClose={() => setCreatingGroup(false)}
        onSubmit={async (name) => Boolean(await onCreateGroup(name))} />}
    </div>
  );
}
