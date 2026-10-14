"use client";

import { MessageSquareText, PanelLeftClose, Plus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { FloatingEmojiPopover, floatingPositionFor, usePickerBackToClose, type FloatingPosition } from "@/components/emoji-picker";
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
  onChangeIcon: (sessionId: string, icon: string | null) => void;
};

export function ChatSidebar({
  sessions,
  activeSessionId,
  onClose,
  onCreate,
  onLoad,
  onDelete,
  onChangeIcon,
  onWorkspaceChange,
}: ChatSidebarProps) {
  // アイコン選択を開いている会話と、その位置（スクロールしても固定位置で出すため開いた時点で決める）。
  const [picker, setPicker] = useState<{ id: string; position: FloatingPosition } | null>(null);
  const closePicker = () => setPicker(null);
  // 押した行のアイコンボタン。別の行のボタンを押したときは外側のクリックとして閉じる。
  const triggerRef = useRef<HTMLElement | null>(null);
  usePickerBackToClose(picker !== null, closePicker);
  const pickerSession = picker ? sessions.find((session) => session.id === picker.id) : undefined;

  return (
    <aside className="notion-sidebar">
      <div className="flex h-12 items-center justify-between px-3">
        <StudyMateLogo />
        <button type="button" className="notion-icon-button grid" onClick={onClose} aria-label="Close sidebar" title="Toggle sidebar (Ctrl+B)">
          <PanelLeftClose size={17} />
        </button>
      </div>

      <WorkspaceNav view="chat" onChange={onWorkspaceChange} />

      <div className="mt-3 px-2">
        <div className="flex h-7 items-center px-2 text-xs font-medium text-[var(--notion-muted)]">
          Chats
        </div>
        <button type="button" onClick={onCreate} className="notion-sidebar-action">
          <Plus size={16} />
          <span>New chat</span>
        </button>
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
                  <button type="button" className="chat-row-icon-button" aria-label={`Change icon of ${session.title}`} title="Change icon"
                    aria-haspopup="dialog" aria-expanded={picker?.id === session.id}
                    onClick={(event) => {
                      triggerRef.current = event.currentTarget;
                      const position = floatingPositionFor(event.currentTarget.getBoundingClientRect());
                      setPicker(picker?.id === session.id ? null : { id: session.id, position });
                    }}>
                    {session.icon
                      ? <span className="notes-row-icon" aria-hidden="true">{session.icon}</span>
                      : <MessageSquareText size={15} className="shrink-0 text-[var(--notion-muted)]" />}
                  </button>
                  <button type="button" onClick={() => onLoad(session.id)} className="flex min-w-0 flex-1 items-center py-1.5 pr-2 text-left" title={session.title}>
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
      {picker && pickerSession && (
        <FloatingEmojiPopover position={picker.position} trigger={triggerRef} current={pickerSession.icon ?? null}
          onChange={(icon) => onChangeIcon(pickerSession.id, icon)} onClose={closePicker} />
      )}
    </aside>
  );
}
