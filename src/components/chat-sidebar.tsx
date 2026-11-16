"use client";

import { ChevronDown, ChevronRight, Folder, MessageSquareText, MoreHorizontal, PanelLeftClose, Pin, Plus, ScrollText, Search } from "lucide-react";
import { useRef, useState } from "react";
import { FloatingEmojiPopover, floatingPositionFor, usePickerBackToClose, type FloatingPosition } from "@/components/emoji-picker";
import { ReorderRowButton } from "@/components/reorder-row-button";
import type { ReorderRequest } from "@/lib/list-order";
import { ChatActions, type ChatAction, type ChatProject } from "@/components/chat-actions";
import { SidebarFooter } from "@/components/sidebar-footer";
import { NoteFableLogo } from "@/components/app-icon";
import { WorkspaceNav, type WorkspaceView } from "@/components/workspace-nav";
import { rowName } from "@/lib/view-transition";
import type { Session } from "@/types/chat";
import { useT } from "@/components/i18n-provider";
import type { Translate } from "@/lib/i18n/translate";

type ChatSidebarProps = {
  onWorkspaceChange: (view: WorkspaceView) => void;
  sessions: Session[];
  activeSessionId: string | null;
  onClose: () => void;
  onCreate: () => void;
  // 検索の小窓を開く。
  onSearch: () => void;
  // プロジェクトの「＋」: そのプロジェクトの中に新しいチャットを作る。
  onCreateInProject: (projectId: string) => void;
  onLoad: (sessionId: string) => void;
  onDelete: (sessionId: string) => Promise<boolean>;
  projects: ChatProject[];
  projectError: string;
  onProject: (method: "POST" | "PATCH" | "DELETE", name?: string, id?: string) => Promise<ChatProject | boolean | null>;
  // 設定画面で保存したプロジェクト（件数と指示の有無を含む）を一覧へ反映する。
  onProjectSaved: (project: ChatProject) => void;
  onReorder: (move: ReorderRequest) => Promise<unknown>;
  onUpdate: (id: string, changes: Partial<Pick<Session, "title" | "pinned" | "projectId">>) => Promise<boolean>;
  onChangeIcon: (sessionId: string, icon: string | null) => void;
};

export function ChatSidebar({
  sessions,
  activeSessionId,
  onClose,
  onCreate,
  onSearch,
  onCreateInProject,
  onLoad,
  onDelete,
  onUpdate,
  onReorder,
  projects,
  projectError,
  onProject,
  onProjectSaved,
  onChangeIcon,
  onWorkspaceChange,
}: ChatSidebarProps) {
  const t = useT();
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
                  <button type="button" className="chat-row-icon-button" aria-label={t("Change icon of {title}", { title: session.title })} title={t("Change icon")}
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
                  <ReorderRowButton id={session.id} title={session.title} scope="chat" ids={ordered.filter(item=>session.pinned ? item.pinned : !item.pinned && item.projectId===session.projectId).map(item=>item.id)} onMove={onReorder} onOpen={()=>onLoad(session.id)} className="flex min-w-0 flex-1 items-center py-1.5 pr-2 text-left" onMoveProject={async projectId=>{const ok=await onUpdate(session.id,{projectId,pinned:false});if(ok && projectId)setCollapsed(state=>({...state,[projectId]:false}));return ok;}}>
                    <span className="truncate text-sm">{session.title}</span>
                  </ReorderRowButton>
                  <button type="button" className="notion-row-action chat-more-button" aria-label={t("Actions for {title}", { title: session.title })} aria-haspopup="dialog"
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
        <NoteFableLogo />
        <button type="button" className="notion-icon-button grid" onClick={onClose} aria-label={t("Close sidebar")} title={t("Toggle sidebar (Ctrl+B)")}>
          <PanelLeftClose size={17} />
        </button>
      </div>

      <WorkspaceNav view="chat" onChange={onWorkspaceChange} />

      <div className="mt-3 px-2">
        <button type="button" onClick={onCreate} className="sidebar-primary-action">
          <Plus size={16} />
          <span>{t("New chat")}</span>
        </button>
        <button type="button" onClick={onSearch} className="notion-sidebar-action" aria-keyshortcuts="Control+K Meta+K">
          <Search size={16} />
          <span>{t("Search")}</span>
          <kbd className="sidebar-search-hint" aria-hidden="true">{t("Ctrl K")}</kbd>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {ordered.filter(session=>session.pinned).length>0 && <>
          <div className="chat-section-label">{t("Pinned")}</div>
          {ordered.filter(session=>session.pinned).map(renderRow)}
        </>}
        <div className="chat-project-heading"><span>{t("Projects")}</span><button type="button" aria-label={t("New project")} className="notion-icon-button" onClick={()=>setAction({kind:"createProject"})}><Plus size={15}/></button></div>
        {projectError && <p role="alert" className="px-2 text-xs text-[#b91c1c]">{projectError}</p>}
        {projects.map(project=><div key={project.id}>
          <div className="notion-session-row chat-project-row" data-chat-project-drop={project.id}>
            <button type="button" className="chat-project-toggle" aria-expanded={!collapsed[project.id]} title={projectHint(project, t) ? `${project.name} · ${projectHint(project, t)}` : project.name} onClick={()=>setCollapsed(state=>({...state,[project.id]:!state[project.id]}))}>
              {collapsed[project.id] ? <ChevronRight size={13}/> : <ChevronDown size={13}/>}<Folder size={15}/><span className="truncate">{project.name}</span>
              {projectHint(project, t) && <><ScrollText size={12} className="chat-project-hint" aria-hidden="true"/><span className="sr-only">({projectHint(project, t)})</span></>}
            </button>
            <button type="button" className="notion-row-action chat-more-button" aria-label={t("New chat in {name}", { name: project.name })} title={t("New chat in this project")}
              onClick={()=>{setCollapsed(state=>({...state,[project.id]:false}));onCreateInProject(project.id);}}><Plus size={16}/></button>
            <button type="button" className="notion-row-action chat-more-button" aria-label={t("Actions for project {name}", { name: project.name })} onClick={event=>setAction({kind:"projectMenu",project,anchor:event.currentTarget.getBoundingClientRect()})}><MoreHorizontal size={16}/></button>
          </div>
          {!collapsed[project.id] && <div className="pl-3">{ordered.filter(session=>session.projectId===project.id && !session.pinned).map(renderRow)}
            {!ordered.some(session=>session.projectId===project.id && !session.pinned) && <p className="px-2 py-1 text-xs text-[var(--notion-muted)]">{ordered.some(session=>session.projectId===project.id) ? t("All chats pinned") : t("No chats")}</p>}
          </div>}
        </div>)}
        <div className="chat-section-label" data-chat-project-drop="">{t("Chats")}</div>
        {ordered.filter(session=>!session.pinned && (!session.projectId || !known.has(session.projectId))).map(renderRow)}
        {sessions.length===0 && <div className="px-2 py-3 text-xs leading-5 text-[var(--notion-muted)]">{t("Your recent conversations will appear here.")}</div>}
      </div>
      <SidebarFooter />
      {action && <ChatActions key={action.kind+("session" in action ? action.session.id : "project" in action ? action.project.id : "")} action={action} projects={projects} onClose={()=>setAction(null)} onAction={setAction} onUpdate={onUpdate} onDelete={onDelete} onProject={onProject} onProjectSaved={onProjectSaved}/>}
      {picker && pickerSession && (
        <FloatingEmojiPopover position={picker.position} trigger={triggerRef} current={pickerSession.icon ?? null}
          onChange={(icon) => onChangeIcon(pickerSession.id, icon)} onClose={closePicker} />
      )}
    </aside>
  );
}

// プロジェクトの行に添える短い説明（共通指示と参照ノートがあるときだけ）。
function projectHint(project: ChatProject, t: Translate) {
  const parts = [];
  if (project.hasInstructions) parts.push(t("instructions"));
  if (project.noteCount) parts.push(project.noteCount === 1 ? t("1 reference note") : t("{count} reference notes", { count: project.noteCount }));
  return parts.join(" + ");
}

function ChatPinButton({session,onUpdate}:{session:Session;onUpdate:ChatSidebarProps["onUpdate"]}) {
  const t = useT();
  const [busy,setBusy]=useState(false);
  const [failed,setFailed]=useState(false);
  return <button type="button" disabled={busy} className={`notion-row-action chat-pin-button${session.pinned ? " is-pinned" : ""}`} aria-label={session.pinned ? t("Unpin {title}", { title: session.title }) : t("Pin {title}", { title: session.title })} aria-pressed={Boolean(session.pinned)}
    title={failed ? t("Could not save. Try again.") : session.pinned ? t("Unpin chat") : t("Pin chat")}
    onClick={async()=>{setBusy(true);try {setFailed(!await onUpdate(session.id,{pinned:!session.pinned}));}catch{setFailed(true);}finally{setBusy(false);}}}>
    <Pin size={14}/>{failed && <span className="sr-only" role="alert">{t("Could not save pin. Try again.")}</span>}
  </button>;
}
