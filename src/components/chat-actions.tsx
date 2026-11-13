"use client";

import { Check, FolderInput, Pencil, Settings2, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChatProjectSettings } from "@/components/chat-project-settings";
import { useBackToClose } from "@/lib/use-back-to-close";
import type { Session } from "@/types/chat";
import { useT } from "@/components/i18n-provider";
import { msg } from "@/lib/i18n/translate";

// noteCount と hasInstructions はサーバーの一覧・保存応答が返す。{ id, name } だけの呼び出しも受け付ける。
export type ChatProject = { id: string; name: string; noteCount?: number; hasInstructions?: boolean };
export type ChatAction =
  | { kind: "menu" | "rename" | "delete" | "move"; session: Session; anchor?: DOMRect }
  | { kind: "createProject" }
  | { kind: "projectMenu" | "projectSettings" | "renameProject" | "deleteProject"; project: ChatProject; anchor?: DOMRect };

function Dialog({ title, onClose, anchor, children }: { title: string; onClose: () => void; anchor?: DOMRect; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useBackToClose(true, onClose);
  useEffect(() => { ref.current?.showModal(); ref.current?.querySelector<HTMLButtonElement>('button[role="menuitem"]')?.focus(); }, []);
  const position = anchor ? {
    top: Math.max(8, Math.min(anchor.bottom + 4, window.innerHeight - 250)),
    left: Math.max(8, Math.min(anchor.right - 228, window.innerWidth - 236)),
  } : undefined;
  return <dialog ref={ref} aria-label={title} className={anchor ? "chat-actions-menu" : "notes-dialog"} style={position}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) { const r=event.currentTarget.getBoundingClientRect(); if(event.clientX<r.left || event.clientX>r.right || event.clientY<r.top || event.clientY>r.bottom) onClose(); } }}>
    {children}
  </dialog>;
}

export function ChatActions({ action, projects, onClose, onAction, onUpdate, onDelete, onProject, onProjectSaved }: {
  action: ChatAction; projects: ChatProject[]; onClose: () => void; onAction: (action: ChatAction) => void;
  // 設定画面で共通指示・参照ノートを保存したあと、サーバーが返した最新のプロジェクトを渡す。
  onProjectSaved?: (project: ChatProject) => void;
  onUpdate: (id: string, changes: Partial<Pick<Session, "title" | "pinned" | "projectId">>) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
  onProject: (method: "POST" | "PATCH" | "DELETE", name?: string, id?: string) => Promise<ChatProject | boolean | null>;
}) {
  const t = useT();
  const [value, setValue] = useState("session" in action ? action.session.title : "project" in action ? action.project.name : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const locked = useRef(false);
  async function run(work: () => Promise<unknown>) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError("");
    try { if (await work()) onClose(); else setError(msg("Could not save the change. Please try again.")); }
    catch (error) { setError(error instanceof Error ? error.message : msg("Could not save the change. Please try again.")); }
    finally { locked.current=false; setBusy(false); }
  }
  const cancel = <button type="button" disabled={busy} className="notion-button" onClick={onClose}>{t("Cancel")}</button>;
  const feedback = error && <p role="alert" className="mt-2 text-sm text-[#b91c1c]">{t(error)}</p>;
  const menuItem = (label: string, icon: ReactNode, click: () => void, danger=false) => <button type="button" role="menuitem" disabled={busy}
    className={`chat-menu-item${danger ? " is-danger" : ""}`} onClick={click}>{icon}{label}</button>;
  function keyboard(event: React.KeyboardEvent) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const items=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)'));
    const current=items.indexOf(document.activeElement as HTMLButtonElement);
    const next=event.key==="Home" ? 0 : event.key==="End" ? items.length-1 : (current+(event.key==="ArrowDown" ? 1 : -1)+items.length)%items.length;
    items[next]?.focus();
  }
  if (action.kind === "menu" && "session" in action) {
    const session=action.session;
    return <Dialog title={t("Actions for {title}", { title: session.title })} onClose={onClose} anchor={action.anchor}>
      <div role="menu" onKeyDown={keyboard}>
        {menuItem(t("Rename"), <Pencil size={16}/>, () => onAction({kind:"rename",session}))}
        {menuItem(t("Move to project"), <FolderInput size={16}/>, () => onAction({kind:"move",session}))}
        <hr className="chat-menu-divider"/>
        {menuItem(t("Delete"), <Trash2 size={16}/>, () => onAction({kind:"delete",session}), true)}
      </div>{feedback}
    </Dialog>;
  }
  if (action.kind === "projectMenu" && "project" in action) return <Dialog title={t("Actions for {name}", { name: action.project.name })} onClose={onClose} anchor={action.anchor}>
    <div role="menu" onKeyDown={keyboard}>
      {menuItem(t("Project settings"), <Settings2 size={16}/>,()=>onAction({kind:"projectSettings",project:action.project}))}
      {menuItem(t("Rename project"), <Pencil size={16}/>,()=>onAction({kind:"renameProject",project:action.project}))}
      {menuItem(t("Delete project"), <Trash2 size={16}/>,()=>onAction({kind:"deleteProject",project:action.project}),true)}
    </div>
  </Dialog>;
  if (action.kind === "projectSettings" && "project" in action) return <ChatProjectSettings project={action.project} onClose={onClose} onSaved={project=>onProjectSaved?.(project)}/>;
  if (action.kind === "move" && "session" in action) return <Dialog title={t("Move to project")} onClose={onClose}>
    <h2 className="text-base font-semibold">{t("Move “{title}” to", { title: action.session.title })}</h2>
    <div className="chat-project-options">
      {[{id:null,name:t("No project")},...projects].map(project=><button type="button" key={project.id ?? "none"} disabled={busy} className="notes-dialog-option"
        onClick={()=>void run(()=>onUpdate(action.session.id,{projectId:project.id}))}>
        <span className="truncate">{project.name}</span>{(action.session.projectId ?? null)===project.id && <Check size={16}/>}
      </button>)}
    </div>
    {creating ? <form onSubmit={event=>{event.preventDefault(); void run(async()=>{
      const project=await onProject("POST",value);
      if (!project || typeof project!=="object") return false;
      // Retain the created project if moving fails; retry via the existing-project list.
      setCreating(false);
      return onUpdate(action.session.id,{projectId:project.id});
    });}}>
      <input autoFocus value={value} maxLength={60} aria-label={t("New project name")} placeholder={t("Project name")} className="notes-dialog-input" onChange={e=>setValue(e.target.value)}/>
      <button disabled={busy || !value.trim()} className="notion-button notion-button-primary mt-2">{t("Create and move")}</button>
    </form> : <button disabled={busy} className="notes-dialog-option" onClick={()=>{setValue("");setCreating(true);}}>{t("＋ New project")}</button>}
    {feedback}<div className="mt-4 flex justify-end">{cancel}</div>
  </Dialog>;
  if (action.kind === "delete" || action.kind === "deleteProject") {
    const project="project" in action ? action.project : null;
    const session="session" in action ? action.session : null;
    return <Dialog title={project ? t("Delete project") : t("Delete chat")} onClose={onClose}>
      <h2 className="text-base font-semibold">{t("Delete “{name}”?", { name: project?.name ?? session?.title ?? "" })}</h2>
      <p className="mt-2 text-sm text-[var(--notion-muted)]">{project ? t("Your chats will be kept and moved to Chats.") : t("This will permanently delete this conversation.")}</p>
      {feedback}<div className="mt-5 flex justify-end gap-2">{cancel}<button disabled={busy} className="notion-button notes-delete" onClick={()=>void run(()=>project ? onProject("DELETE",undefined,project.id) : onDelete(session!.id))}>{t("Delete")}</button></div>
    </Dialog>;
  }
  const title=action.kind==="rename" ? t("Rename chat") : action.kind==="renameProject" ? t("Rename project") : t("New project");
  return <Dialog title={title} onClose={onClose}>
    <form onSubmit={event=>{event.preventDefault();void run(()=>action.kind==="rename" && "session" in action ? onUpdate(action.session.id,{title:value.trim()}) : onProject(action.kind==="renameProject" ? "PATCH" : "POST",value,"project" in action ? action.project.id : undefined));}}>
      <h2 className="text-base font-semibold">{title}</h2>
      <input autoFocus value={value} maxLength={action.kind==="rename" ? 120 : 60} aria-label={action.kind==="rename" ? t("Chat name") : t("Project name")} className="notes-dialog-input" onChange={e=>setValue(e.target.value)}/>
      {feedback}<div className="mt-5 flex justify-end gap-2">{cancel}<button disabled={busy || !value.trim()} className="notion-button notion-button-primary">{action.kind==="createProject" ? t("Create") : t("Save")}</button></div>
    </form>
  </Dialog>;
}
