"use client";

import { Check, FolderPlus } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { NoteGroupSummary, NotePageSummary } from "@/types/notes";

// 開いた瞬間にモーダルとして表示する <dialog>。Esc で閉じる。
function Modal({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} onCancel={onClose} aria-label={label} className="notes-dialog">{children}</dialog>;
}

export function GroupNameDialog({ title, initial = "", submitLabel, error, onSubmit, onClose }: {
  title: string; initial?: string; submitLabel: string; error: string;
  onSubmit: (name: string) => Promise<boolean>; onClose: () => void;
}) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  async function submit() {
    setBusy(true);
    setTried(true);
    const ok = await onSubmit(name);
    setBusy(false);
    if (ok) onClose();
  }
  return <Modal label={title} onClose={onClose}>
    <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <h2 className="text-base font-semibold">{title}</h2>
      <input autoFocus value={name} maxLength={60} onChange={(event) => setName(event.target.value)} placeholder="Project name"
        className="notes-dialog-input" aria-label="Project name" />
      {tried && error && <p role="alert" className="mt-2 text-sm text-[#b91c1c]">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className="notion-button" onClick={onClose}>Cancel</button>
        <button type="submit" disabled={busy || !name.trim()} className="notion-button notion-button-primary">{submitLabel}</button>
      </div>
    </form>
  </Modal>;
}

export function ConfirmDialog({ title, body, confirmLabel, error, onConfirm, onClose }: {
  title: string; body: string; confirmLabel: string; error: string; onConfirm: () => Promise<boolean>; onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  return <Modal label={title} onClose={onClose}>
    <h2 className="text-base font-semibold">{title}</h2>
    <p className="mt-2 text-sm text-[var(--notion-muted)]">{body}</p>
    {tried && error && <p role="alert" className="mt-2 text-sm text-[#b91c1c]">{error}</p>}
    <div className="mt-5 flex justify-end gap-2">
      <button autoFocus type="button" className="notion-button" onClick={onClose}>Cancel</button>
      <button type="button" disabled={busy} className="notion-button notes-delete" onClick={async () => {
        setBusy(true);
        setTried(true);
        const ok = await onConfirm();
        setBusy(false);
        if (ok) onClose();
      }}>{confirmLabel}</button>
    </div>
  </Modal>;
}

// ノートの移動先を選ぶ。「グループなし」か既存のグループ、またはその場で新しいグループを作って移す。
export function MoveNoteDialog({ page, groups, error, onMove, onCreateGroup, onClose }: {
  page: NotePageSummary; groups: NoteGroupSummary[]; error: string;
  onMove: (pageId: string, groupId: string | null) => Promise<unknown>;
  onCreateGroup: (name: string) => Promise<NoteGroupSummary | null>; onClose: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  async function move(groupId: string | null) {
    setBusy(true);
    setTried(true);
    const ok = await onMove(page.id, groupId);
    setBusy(false);
    if (ok) onClose();
  }
  async function createAndMove() {
    setBusy(true);
    setTried(true);
    const group = await onCreateGroup(name);
    setBusy(false);
    if (group) await move(group.id);
  }
  const options: { id: string | null; label: string }[] = [{ id: null, label: "No project" }, ...groups.map((group) => ({ id: group.id, label: group.name }))];
  return <Modal label="Move note" onClose={onClose}>
    <h2 className="text-base font-semibold">Move “{page.title}” to</h2>
    <div className="mt-3 grid gap-0.5" role="radiogroup" aria-label="Project">
      {options.map((option) => <button key={option.id ?? "none"} type="button" role="radio" aria-checked={page.groupId === option.id}
        disabled={busy} className="notes-dialog-option" onClick={() => void move(option.id)}>
        <span className="truncate">{option.label}</span>{page.groupId === option.id && <Check size={16} />}
      </button>)}
    </div>
    {creating ? <form className="mt-3" onSubmit={(event) => { event.preventDefault(); void createAndMove(); }}>
      <input autoFocus value={name} maxLength={60} onChange={(event) => setName(event.target.value)} placeholder="New project name"
        className="notes-dialog-input" aria-label="New project name" />
      <button type="submit" disabled={busy || !name.trim()} className="notion-button notion-button-primary mt-2">Create and move</button>
    </form> : <button type="button" className="notes-dialog-option mt-1" disabled={busy} onClick={() => setCreating(true)}>
      <span className="flex items-center gap-2"><FolderPlus size={16} />New project…</span>
    </button>}
    {tried && error && <p role="alert" className="mt-2 text-sm text-[#b91c1c]">{error}</p>}
    <div className="mt-4 flex justify-end"><button type="button" className="notion-button" onClick={onClose}>Close</button></div>
  </Modal>;
}
