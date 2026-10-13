"use client";

import { FileText, MessageSquareText } from "lucide-react";
import { AccountButton } from "@/components/account-button";

export type WorkspaceView = "chat" | "pages";

// サイドバー上部の Chat / Notes 切替。両サイドバーで同じ見た目を使う。
export function WorkspaceNav({ view, onChange }: { view: WorkspaceView; onChange: (view: WorkspaceView) => void }) {
  const items = [
    { id: "chat", label: "Chat", Icon: MessageSquareText },
    { id: "pages", label: "Notes", Icon: FileText },
  ] as const;
  return (
    <nav className="px-2 pt-1" aria-label="Workspace mode">
      {items.map(({ id, label, Icon }) => (
        <button key={id} type="button" className={`notion-sidebar-action ${view === id ? "is-active" : ""}`}
          aria-pressed={view === id} onClick={() => onChange(id)}>
          <Icon size={16} /><span>{label}</span>
        </button>
      ))}
      <AccountButton />
    </nav>
  );
}
