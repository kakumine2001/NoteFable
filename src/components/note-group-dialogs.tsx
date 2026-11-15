"use client";

import { Check, FileText, FolderPlus } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { NoteGroupSummary, NotePageSummary } from "@/types/notes";
import { useT } from "@/components/i18n-provider";
import { localizeSystemText } from "@/lib/i18n/translate";
import { canMoveInto, childrenByParent } from "@/lib/note-tree";

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
  const t = useT();
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
      <input autoFocus value={name} maxLength={60} onChange={(event) => setName(event.target.value)} placeholder={t("Project name")}
        className="notes-dialog-input" aria-label={t("Project name")} />
      {tried && error && <p role="alert" className="mt-2 text-sm text-[#b91c1c]">{localizeSystemText(error, t)}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className="notion-button" onClick={onClose}>{t("Cancel")}</button>
        <button type="submit" disabled={busy || !name.trim()} className="notion-button notion-button-primary">{submitLabel}</button>
      </div>
    </form>
  </Modal>;
}

export function ConfirmDialog({ title, body, confirmLabel, error, onConfirm, onClose }: {
  title: string; body: string; confirmLabel: string; error: string; onConfirm: () => Promise<boolean>; onClose: () => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  return <Modal label={title} onClose={onClose}>
    <h2 className="text-base font-semibold">{title}</h2>
    <p className="mt-2 text-sm text-[var(--notion-muted)]">{body}</p>
    {tried && error && <p role="alert" className="mt-2 text-sm text-[#b91c1c]">{localizeSystemText(error, t)}</p>}
    <div className="mt-5 flex justify-end gap-2">
      <button autoFocus type="button" className="notion-button" onClick={onClose}>{t("Cancel")}</button>
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

// ノートの移動先を選ぶ。「グループなし」か既存のグループ（その最上位へ）、その場で作った新しいグループ、
// または別のページの中（Notion の「Move to」）。自分自身と自分のサブページの中へは移せないので候補に出さない。
export function MoveNoteDialog({ page, groups, error, onMove, onCreateGroup, onClose, pages = [], onMoveToPage }: {
  page: NotePageSummary; groups: NoteGroupSummary[]; error: string;
  onMove: (pageId: string, groupId: string | null) => Promise<unknown>;
  onCreateGroup: (name: string) => Promise<NoteGroupSummary | null>; onClose: () => void;
  pages?: NotePageSummary[];
  onMoveToPage?: (pageId: string, parentId: string) => Promise<unknown>;
}) {
  const t = useT();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const [filter, setFilter] = useState("");
  async function moveInto(parentId: string) {
    if (!onMoveToPage) return;
    setBusy(true);
    setTried(true);
    const ok = await onMoveToPage(page.id, parentId);
    setBusy(false);
    if (ok) onClose();
  }
  // 木の順（親の直後に子）で、深さ付きの候補を作る。絞り込み中は一致したページだけを平らに出す。
  const children = childrenByParent(pages);
  const targets: { page: NotePageSummary; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const entry of children.get(parent) ?? []) {
      if (!canMoveInto(pages, page.id, entry.id)) continue;
      targets.push({ page: entry, depth });
      walk(entry.id, depth + 1);
    }
  };
  walk(null, 0);
  const query = filter.trim().toLocaleLowerCase();
  const shown = query ? targets.filter((target) => target.page.title.toLocaleLowerCase().includes(query)).map((target) => ({ ...target, depth: 0 })) : targets;
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
  const options: { id: string | null; label: string }[] = [{ id: null, label: t("No project") }, ...groups.map((group) => ({ id: group.id, label: group.name }))];
  return <Modal label={t("Move note")} onClose={onClose}>
    <h2 className="text-base font-semibold">{t("Move “{title}” to", { title: page.title })}</h2>
    <div className="mt-3 grid gap-0.5" role="radiogroup" aria-label={t("Project")}>
      {options.map((option) => <button key={option.id ?? "none"} type="button" role="radio" aria-checked={!page.parentId && page.groupId === option.id}
        disabled={busy} className="notes-dialog-option" onClick={() => void move(option.id)}>
        <span className="truncate">{option.label}</span>{!page.parentId && page.groupId === option.id && <Check size={16} />}
      </button>)}
    </div>
    {creating ? <form className="mt-3" onSubmit={(event) => { event.preventDefault(); void createAndMove(); }}>
      <input autoFocus value={name} maxLength={60} onChange={(event) => setName(event.target.value)} placeholder={t("New project name")}
        className="notes-dialog-input" aria-label={t("New project name")} />
      <button type="submit" disabled={busy || !name.trim()} className="notion-button notion-button-primary mt-2">{t("Create and move")}</button>
    </form> : <button type="button" className="notes-dialog-option mt-1" disabled={busy} onClick={() => setCreating(true)}>
      <span className="flex items-center gap-2"><FolderPlus size={16} />{t("New project…")}</span>
    </button>}
    {onMoveToPage && targets.length > 0 && <>
      <h3 className="notes-dialog-subtitle">{t("Pages")}</h3>
      <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder={t("Search pages")} aria-label={t("Search pages")} className="notes-dialog-input notes-move-filter" />
      <div className="notes-move-pages" role="radiogroup" aria-label={t("Pages")}>
        {shown.map(({ page: target, depth }) => <button key={target.id} type="button" role="radio" aria-checked={page.parentId === target.id}
          disabled={busy} className="notes-dialog-option" style={{ paddingLeft: `${0.75 + depth * 1}rem` }} onClick={() => void moveInto(target.id)}>
          <span className="flex min-w-0 items-center gap-2">
            <span className="notes-move-icon" aria-hidden="true">{target.icon ?? <FileText size={15} />}</span><span className="truncate">{target.title}</span>
          </span>{page.parentId === target.id && <Check size={16} />}
        </button>)}
        {!shown.length && <p className="px-3 py-2 text-sm text-[var(--notion-muted)]">{t("No matching pages.")}</p>}
      </div>
    </>}
    {tried && error && <p role="alert" className="mt-2 text-sm text-[#b91c1c]">{localizeSystemText(error, t)}</p>}
    <div className="mt-4 flex justify-end"><button type="button" className="notion-button" onClick={onClose}>{t("Close")}</button></div>
  </Modal>;
}
