"use client";

import { FileText, MessageSquareText } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { msg } from "@/lib/i18n/translate";

export type WorkspaceView = "chat" | "pages";

const WORKSPACE_ITEMS = [
  { id: "chat", label: msg("Chat"), Icon: MessageSquareText },
  { id: "pages", label: msg("Workspace"), Icon: FileText },
] as const;

// Chat / Workspace の切替（左右に並んだ 2 つのボタン）。サイドバー最上部とスマホのホーム画面で同じ見た目を使う。
export function WorkspaceSwitch({ view, onChange }: { view: WorkspaceView; onChange: (view: WorkspaceView) => void }) {
  const t = useT();
  return (
    <div className="notion-segmented" role="group" aria-label={t("Switch between Chat and Workspace")}>
      {WORKSPACE_ITEMS.map(({ id, label, Icon }) => (
        <button key={id} type="button" className={`notion-segment ${view === id ? "is-active" : ""}`}
          aria-pressed={view === id} onClick={() => onChange(id)}>
          <Icon size={16} /><span>{t(label)}</span>
        </button>
      ))}
    </div>
  );
}

export function WorkspaceNav({ view, onChange }: { view: WorkspaceView; onChange: (view: WorkspaceView) => void }) {
  const t = useT();
  return (
    <nav className="px-2 pt-1" aria-label={t("Main navigation")}>
      <WorkspaceSwitch view={view} onChange={onChange} />
    </nav>
  );
}
