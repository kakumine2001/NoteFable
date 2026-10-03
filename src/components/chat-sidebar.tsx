"use client";

import { MessageSquareText, PanelLeftClose, Plus, Trash2 } from "lucide-react";
import { StudyMateLogo } from "@/components/studymate-logo";
import { WorkspaceNav, type WorkspaceView } from "@/components/workspace-nav";
import type { Session } from "@/types/chat";

type ChatSidebarProps = {
  onWorkspaceChange: (view: WorkspaceView) => void;
  sessions: Session[];
  activeSessionId: string | null;
  onClose: () => void;
  onCreate: () => void;
  onLoad: (sessionId: string) => void;
  onDelete: (sessionId: string) => void;
};

export function ChatSidebar({
  sessions,
  activeSessionId,
  onClose,
  onCreate,
  onLoad,
  onDelete,
  onWorkspaceChange,
}: ChatSidebarProps) {
  return (
    <aside className="notion-sidebar">
      <div className="flex h-12 items-center justify-between px-3">
        <StudyMateLogo />
        <button type="button" className="notion-icon-button grid" onClick={onClose} aria-label="Close sidebar" title="Toggle sidebar (Ctrl+B)">
          <PanelLeftClose size={17} />
        </button>
      </div>

      <WorkspaceNav view="chat" onChange={onWorkspaceChange} />

      <div className="px-2 pt-1">
        <button type="button" onClick={onCreate} className="notion-sidebar-action">
          <Plus size={16} />
          <span>New chat</span>
        </button>
      </div>

      <div className="mt-5 px-2">
        <div className="flex h-7 items-center px-2 text-xs font-medium text-[var(--notion-muted)]">
          Chats
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {sessions.length === 0 ? (
          <div className="px-2 py-3 text-xs leading-5 text-[var(--notion-muted)]">
            Your recent conversations will appear here.
          </div>
        ) : (
          <div className="space-y-px">
            {sessions.map((session) => {
              const active = activeSessionId === session.id;
              return (
                <div key={session.id} className={`notion-session-row group ${active ? "is-active" : ""}`}>
                  <button type="button" onClick={() => onLoad(session.id)} className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left" title={session.title}>
                    <MessageSquareText size={15} className="shrink-0 text-[var(--notion-muted)]" />
                    <span className="truncate text-sm">{session.title}</span>
                  </button>
                  <button type="button" onClick={() => onDelete(session.id)} className="notion-row-action" aria-label={`Delete ${session.title}`}>
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
