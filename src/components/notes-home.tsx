import { FileText, Plus } from "lucide-react";
import { WorkspaceSwitch, type WorkspaceView } from "@/components/workspace-nav";
import type { NotePageSummary } from "@/types/notes";

// スマホの Notes ホーム: 作成済みのノートを一覧にして、押したものを開く。ノートが 0 件のときは呼び出し側が空状態を出す。
export function NotesHome({ pages, busy, onOpen, onCreate, onWorkspaceChange }: {
  pages: NotePageSummary[];
  busy: boolean;
  onOpen: (id: string) => void;
  onCreate: () => void;
  onWorkspaceChange: (view: WorkspaceView) => void;
}) {
  return (
    <div className="notes-column notes-home">
      <div className="notion-home-switch"><WorkspaceSwitch view="pages" onChange={onWorkspaceChange} /></div>
      <h1 className="notes-home-title">Notes</h1>
      <ul className="notes-home-list">
        {pages.map((page) => (
          <li key={page.id}>
            <button type="button" className="notes-home-row" disabled={busy} onClick={() => onOpen(page.id)}>
              <span className="notes-home-icon" aria-hidden="true">{page.icon ?? <FileText size={20} />}</span>
              <span className="notes-home-name">{page.title}</span>
              <time className="notes-home-date" dateTime={page.updatedAt}>
                {new Date(page.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              </time>
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="notes-empty-new notes-home-new" disabled={busy} onClick={onCreate}>
        <Plus size={16} />New note
      </button>
    </div>
  );
}
