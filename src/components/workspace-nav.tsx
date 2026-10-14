"use client";

import { FileText, MessageSquareText } from "lucide-react";

export type WorkspaceView = "chat" | "pages";

const WORKSPACE_ITEMS = [
  { id: "chat", label: "Chat", Icon: MessageSquareText },
  { id: "pages", label: "Note", Icon: FileText },
] as const;

// Chat / Note の切替（左右に並んだ 2 つのボタン）。サイドバー最上部とスマホのホーム画面で同じ見た目を使う。
export function WorkspaceSwitch({ view, onChange }: { view: WorkspaceView; onChange: (view: WorkspaceView) => void }) {
  return (
    <div className="notion-segmented" role="group" aria-label="Workspace mode">
      {WORKSPACE_ITEMS.map(({ id, label, Icon }) => (
        <button key={id} type="button" className={`notion-segment ${view === id ? "is-active" : ""}`}
          aria-pressed={view === id} onClick={() => onChange(id)}>
          <Icon size={16} /><span>{label}</span>
        </button>
      ))}
    </div>
  );
}

export function WorkspaceNav({ view, onChange }: { view: WorkspaceView; onChange: (view: WorkspaceView) => void }) {
  return (
    <nav className="px-2 pt-1" aria-label="Workspace">
      <WorkspaceSwitch view={view} onChange={onChange} />
    </nav>
  );
}
