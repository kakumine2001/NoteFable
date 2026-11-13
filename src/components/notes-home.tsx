import { FileText, FolderInput, FolderPlus, Plus } from "lucide-react";
import { useState } from "react";
import { ReorderHandle } from "@/components/reorder-handle";
import type { ReorderRequest } from "@/lib/list-order";
import { GroupNameDialog, MoveNoteDialog } from "@/components/note-group-dialogs";
import { WorkspaceSwitch, type WorkspaceView } from "@/components/workspace-nav";
import { rowName } from "@/lib/view-transition";
import type { NoteGroupSummary, NotePageSummary } from "@/types/notes";
import { useI18n } from "@/components/i18n-provider";

// スマホの Notes ホーム: 作成済みのノートをグループごとに並べて、押したものを開く。ノートが 0 件のときは呼び出し側が空状態を出す。
export function NotesHome({ pages, groups, groupError, busy, onOpen, onCreate, onWorkspaceChange, onMoveNote, onCreateGroup, onReorder }: {
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
  const known = new Set(groups.map((group) => group.id));
  const loose = pages.filter((page) => !page.groupId || !known.has(page.groupId));
  const item = (page: NotePageSummary) => (
    <li key={page.id} className="notes-home-item vt-row" style={rowName(`hrow-${page.id}`)} data-order-id={page.id} data-order-scope="note">
      <ReorderHandle id={page.id} title={page.title} scope="note" ids={pages.filter(item=>item.groupId===page.groupId).map(item=>item.id)} disabled={busy} onMove={onReorder} onMoveGroup={groupId=>onMoveNote(page.id,groupId)}/>
      <button type="button" className="notes-home-row" disabled={busy} onClick={() => onOpen(page.id)}>
        <span className="notes-home-icon" aria-hidden="true">{page.icon ?? <FileText size={20} />}</span>
        <span className="notes-home-name">{page.title}</span>
        <time className="notes-home-date" dateTime={page.updatedAt}>
          {new Date(page.updatedAt).toLocaleDateString(tag, { month: "short", day: "numeric" })}
        </time>
      </button>
      <button type="button" className="notes-home-move" disabled={busy} onClick={() => setMoving(page)} aria-label={t("Move {title} to a project", { title: page.title })}><FolderInput size={18} /></button>
    </li>
  );
  return (
    <div className="notes-column notes-home" data-reorder-list>
      <div className="notion-home-switch"><WorkspaceSwitch view="pages" onChange={onWorkspaceChange} /></div>
      <h1 className="notes-home-title" data-note-group-drop="">{t("Notes")}</h1>
      {groups.map((group) => {
        const members = pages.filter((page) => page.groupId === group.id);
        return (
          <section key={group.id}>
            <h2 className="notes-home-group" data-note-group-drop={group.id}>{group.name}<span>{members.length}</span></h2>
            {members.length ? <ul className="notes-home-list">{members.map(item)}</ul> : <p className="notes-home-empty">{t("No notes in this project.")}</p>}
          </section>
        );
      })}
      {groups.length > 0 && loose.length > 0 && <h2 className="notes-home-group" data-note-group-drop="">{t("No project")}<span>{loose.length}</span></h2>}
      {loose.length > 0 && <ul className="notes-home-list">{loose.map(item)}</ul>}
      <div className="notes-home-actions">
        <button type="button" className="notes-empty-new" disabled={busy} onClick={onCreate}><Plus size={16} />{t("New note")}</button>
        <button type="button" className="notion-button notes-home-new-group" disabled={busy} onClick={() => setCreatingGroup(true)}><FolderPlus size={16} />{t("New project")}</button>
      </div>
      {moving && <MoveNoteDialog page={pages.find((page) => page.id === moving.id) ?? moving} groups={groups} error={groupError}
        onMove={onMoveNote} onCreateGroup={onCreateGroup} onClose={() => setMoving(null)} />}
      {creatingGroup && <GroupNameDialog title={t("New project")} submitLabel={t("Create")} error={groupError} onClose={() => setCreatingGroup(false)}
        onSubmit={async (name) => Boolean(await onCreateGroup(name))} />}
    </div>
  );
}
