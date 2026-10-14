"use client";

import { ChevronDown, ChevronRight, Folder, MessageSquareText, MoreHorizontal, PanelLeftClose, Pin, Plus } from "lucide-react";
import { useRef, useState } from "react";
import { FloatingEmojiPopover, floatingPositionFor, usePickerBackToClose, type FloatingPosition } from "@/components/emoji-picker";
import { ReorderHandle } from "@/components/reorder-handle";
import type { ReorderRequest } from "@/lib/list-order";
import { ChatActions, type ChatAction, type ChatProject } from "@/components/chat-actions";
import { SidebarFooter } from "@/components/sidebar-footer";
import { StudyMateLogo } from "@/components/studymate-logo";
import { WorkspaceNav, type WorkspaceView } from "@/components/workspace-nav";
import { rowName } from "@/lib/view-transition";
import type { Session } from "@/types/chat";

type ChatSidebarProps = {
  onWorkspaceChange: (view: WorkspaceView) => void;
  sessions: Session[];
  activeSessionId: string | null;
  onClose: () => void;
  onCreate: () => void;
  onLoad: (sessionId: string) => void;
  onDelete: (sessionId: string) => Promise<boolean>;
  projects: ChatProject[];
  projectError: string;
  onProject: (method: "POST" | "PATCH" | "DELETE", name?: string, id?: string) => Promise<ChatProject | boolean | null>;
  onReorder: (move: ReorderRequest) => Promise<unknown>;
  onUpdate: (id: string, changes: Partial<Pick<Session, "title" | "pinned" | "projectId">>) => Promise<boolean>;
  onChangeIcon: (sessionId: string, icon: string | null) => void;
};

export function ChatSidebar({
  sessions,
  activeSessionId,
  onClose,
  onCreate,
  onLoad,
  onDelete,
  onUpdate,
  onReorder,
  projects,
  projectError,
  onProject,
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

  const [action, setAction] = useState<ChatAction | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  function renderRow(session: Session) {
    const active = activeSessionId === session.id;
    return (
                <div key={session.id} className={`notion-session-row vt-row group ${active ? "is-active" : ""}`} style={rowName(`crow-${session.id}`)} data-order-id={session.id} data-order-scope="chat">
                  <ReorderHandle id={session.id} title={session.title} scope="chat" ids={ordered.filter(item=>session.pinned ? item.pinned : !item.pinned && item.projectId===session.projectId).map(item=>item.id)} onMove={onReorder} onMoveProject={async projectId=>{const ok=await onUpdate(session.id,{projectId,pinned:false});if(ok && projectId)setCollapsed(state=>({...state,[projectId]:false}));return ok;}}/>
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
                  <button type="button" onClick={()=>onLoad(session.id)} className="flex min-w-0 flex-1 items-center py-1.5 pr-2 text-left" title={session.title}>
                    <span className="truncate text-sm">{session.title}</span>
                  </button>
                  <button type="button" className="notion-row-action chat-more-button" aria-label={`Actions for ${session.title}`} aria-haspopup="dialog"
                    onClick={event=>{setPicker(null);setAction({kind:"menu",session,anchor:event.currentTarget.getBoundingClientRect()});}}>
                    <MoreHorizontal size={16}/>
                  </button>
                  <ChatPinButton session={session} onUpdate={onUpdate}/>
                </div>
              );
  }
  const ordered=[...sessions].sort((a,b)=>Number(Boolean(b.pinned))-Number(Boolean(a.pinned)) || (a.position ?? 0)-(b.position ?? 0) || Date.parse(b.updatedAt)-Date.parse(a.updatedAt));
  const known=new Set(projects.map(project=>project.id));
  return (
    <aside className="notion-sidebar" data-reorder-list>
      <div className="flex h-12 items-center justify-between px-3">
        <StudyMateLogo />
        <button type="button" className="notion-icon-button grid" onClick={onClose} aria-label="Close sidebar" title="Toggle sidebar (Ctrl+B)">
          <PanelLeftClose size={17} />
        </button>
      </div>

      <WorkspaceNav view="chat" onChange={onWorkspaceChange} />

      <div className="mt-3 px-2">
        <button type="button" onClick={onCreate} className="notion-sidebar-action">
          <Plus size={16} />
          <span>New chat</span>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {ordered.filter(session=>session.pinned).length>0 && <>
          <div className="chat-section-label">Pinned</div>
          {ordered.filter(session=>session.pinned).map(renderRow)}
        </>}
        <div className="chat-project-heading"><span>Projects</span><button type="button" aria-label="New project" className="notion-icon-button" onClick={()=>setAction({kind:"createProject"})}><Plus size={15}/></button></div>
        {projectError && <p role="alert" className="px-2 text-xs text-[#b91c1c]">{projectError}</p>}
        {projects.map(project=><div key={project.id}>
          <div className="notion-session-row chat-project-row" data-chat-project-drop={project.id}>
            <button type="button" className="chat-project-toggle" aria-expanded={!collapsed[project.id]} onClick={()=>setCollapsed(state=>({...state,[project.id]:!state[project.id]}))}>
              {collapsed[project.id] ? <ChevronRight size={13}/> : <ChevronDown size={13}/>}<Folder size={15}/><span className="truncate">{project.name}</span>
            </button>
            <button type="button" className="notion-row-action chat-more-button" aria-label={`Actions for project ${project.name}`} onClick={event=>setAction({kind:"projectMenu",project,anchor:event.currentTarget.getBoundingClientRect()})}><MoreHorizontal size={16}/></button>
          </div>
          {!collapsed[project.id] && <div className="pl-3">{ordered.filter(session=>session.projectId===project.id && !session.pinned).map(renderRow)}
            {!ordered.some(session=>session.projectId===project.id && !session.pinned) && <p className="px-2 py-1 text-xs text-[var(--notion-muted)]">{ordered.some(session=>session.projectId===project.id) ? "All chats pinned" : "No chats"}</p>}
          </div>}
        </div>)}
        <div className="chat-section-label" data-chat-project-drop="">Chats</div>
        {ordered.filter(session=>!session.pinned && (!session.projectId || !known.has(session.projectId))).map(renderRow)}
        {sessions.length===0 && <div className="px-2 py-3 text-xs leading-5 text-[var(--notion-muted)]">Your recent conversations will appear here.</div>}
      </div>
      <SidebarFooter />
      {action && <ChatActions key={action.kind+("session" in action ? action.session.id : "project" in action ? action.project.id : "")} action={action} projects={projects} onClose={()=>setAction(null)} onAction={setAction} onUpdate={onUpdate} onDelete={onDelete} onProject={onProject}/>}
      {picker && pickerSession && (
        <FloatingEmojiPopover position={picker.position} trigger={triggerRef} current={pickerSession.icon ?? null}
          onChange={(icon) => onChangeIcon(pickerSession.id, icon)} onClose={closePicker} />
      )}
    </aside>
  );
}


function ChatPinButton({session,onUpdate}:{session:Session;onUpdate:ChatSidebarProps["onUpdate"]}) {
  const [busy,setBusy]=useState(false);
  const [failed,setFailed]=useState(false);
  return <button type="button" disabled={busy} className={`notion-row-action chat-pin-button${session.pinned ? " is-pinned" : ""}`} aria-label={`${session.pinned ? "Unpin" : "Pin"} ${session.title}`} aria-pressed={Boolean(session.pinned)}
    title={failed ? "Could not save. Try again." : session.pinned ? "Unpin chat" : "Pin chat"}
    onClick={async()=>{setBusy(true);try {setFailed(!await onUpdate(session.id,{pinned:!session.pinned}));}catch{setFailed(true);}finally{setBusy(false);}}}>
    <Pin size={14}/>{failed && <span className="sr-only" role="alert">Could not save pin. Try again.</span>}
  </button>;
}
