"use client";

import { FileText, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useBackToClose } from "@/lib/use-back-to-close";
import { TRASH_RETENTION_DAYS, type NotePageSummary, type NoteTrashItem } from "@/types/notes";
import "@/components/note-trash-history.css";

const DAY_MS = 24 * 60 * 60 * 1000;

// 「Deleted 3 days ago · 27 days left」。経過日は切り捨て、残り日数は切り上げる（残り 0 日とは言わない）。
export function trashTimeLabel(item: Pick<NoteTrashItem, "deletedAt" | "purgeAt">, now = Date.now()) {
  const ago = Math.max(0, Math.floor((now - new Date(item.deletedAt).getTime()) / DAY_MS));
  const left = Math.ceil((new Date(item.purgeAt).getTime() - now) / DAY_MS);
  const deleted = ago === 0 ? "Deleted today" : `Deleted ${ago} day${ago === 1 ? "" : "s"} ago`;
  return `${deleted} · ${left <= 0 ? "removing soon" : `${left} day${left === 1 ? "" : "s"} left`}`;
}

async function trashRequest(url: string, method = "GET") {
  const response = await fetch(url, { method, cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.error === "string" && data.error ? data.error : "Trash request failed. Please try again.");
  return data;
}

type Confirm = { kind: "one"; id: string } | { kind: "all" };

// ゴミ箱の一覧。戻す・完全に削除・ゴミ箱を空にする。復元したノートは "studymate:page-created" で Notes の一覧へ加わる。
export function NoteTrashDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const locked = useRef(false);
  const [items, setItems] = useState<NoteTrashItem[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [attempt, setAttempt] = useState(0);
  useBackToClose(true, onClose);

  useEffect(() => { ref.current?.showModal(); }, []);
  useEffect(() => {
    let cancelled = false;
    trashRequest("/api/pages/trash")
      .then((data) => { if (!cancelled) { setItems(data.pages as NoteTrashItem[]); setLoadError(""); } })
      .catch((caught) => { if (!cancelled) setLoadError(caught instanceof Error ? caught.message : "Could not load the trash."); });
    return () => { cancelled = true; };
  }, [attempt]);

  async function run(work: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try { await work(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Something went wrong. Please try again."); }
    finally { locked.current = false; setBusy(false); }
  }

  const restore = (item: NoteTrashItem) => run(async () => {
    const data = await trashRequest(`/api/pages/trash/${item.id}`, "POST");
    // 一覧（サイドバー）へ加える。ここで外すのは、戻した 1 件だけ。
    window.dispatchEvent(new CustomEvent<NotePageSummary>("studymate:page-created", { detail: data.page as NotePageSummary }));
    setItems((current) => current?.filter((entry) => entry.id !== item.id) ?? current);
  });

  const deleteForever = (item: NoteTrashItem) => run(async () => {
    await trashRequest(`/api/pages/trash/${item.id}`, "DELETE");
    setConfirm(null);
    setItems((current) => current?.filter((entry) => entry.id !== item.id) ?? current);
  });

  const emptyTrash = () => run(async () => {
    // 確認で見せた一覧（新しい順）の最後に捨てたものまで。確認の間に別のタブが捨てたノートは消さない。
    const newest = items?.[0]?.deletedAt;
    if (!newest) return;
    await trashRequest(`/api/pages/trash?before=${encodeURIComponent(newest)}`, "DELETE");
    setConfirm(null);
    setItems([]);
  });

  const loading = items === null && !loadError;

  return <dialog ref={ref} aria-labelledby="note-trash-title" aria-busy={loading || busy} className="notes-dialog note-th-dialog note-trash-dialog"
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => {
      if (event.target !== event.currentTarget) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
    }}>
    <div className="note-th-header">
      <h2 id="note-trash-title" className="note-th-title"><Trash2 size={16} aria-hidden="true" />Trash</h2>
      <button type="button" className="notion-button notes-delete" disabled={busy || !items?.length} onClick={() => setConfirm({ kind: "all" })}>Empty trash</button>
      <button type="button" className="notion-icon-button" aria-label="Close trash" title="Close" onClick={onClose}><X size={16} /></button>
    </div>
    <p className="note-th-hint">Notes in the trash can be restored for {TRASH_RETENTION_DAYS} days. After that they are deleted for good.</p>
    {confirm?.kind === "all" && <div className="note-th-confirm" role="group" aria-label="Empty trash confirmation">
      <span className="note-th-confirm-text">Permanently delete {items?.length === 1 ? "this note" : `all ${items?.length ?? 0} notes`} in the trash? This cannot be undone.</span>
      <span className="note-th-confirm-actions">
        <button autoFocus type="button" className="notion-button" disabled={busy} onClick={() => setConfirm(null)}>Cancel</button>
        <button type="button" className="notion-button notes-delete" disabled={busy} onClick={() => void emptyTrash()}>Empty trash</button>
      </span>
    </div>}
    {error && <p role="alert" className="note-th-error">{error}</p>}
    <div className="note-th-body">
      {loading && <p role="status" className="note-th-status">Loading trash…</p>}
      {loadError && <p role="alert" className="note-th-status">{loadError}<br /><button type="button" className="notion-button" onClick={() => { setLoadError(""); setAttempt((value) => value + 1); }}>Try again</button></p>}
      {items && !items.length && <p role="status" className="note-th-status">The trash is empty.</p>}
      {!!items?.length && <ul className="note-trash-list" aria-label="Notes in the trash">
        {items.map((item) => <li key={item.id} className="note-trash-row">
          <span className="note-th-icon" aria-hidden="true">{item.icon ?? <FileText size={16} />}</span>
          <span className="note-trash-text">
            <span className="note-th-row-title" title={item.title}>{item.title}</span>
            <span className="note-th-row-meta">{trashTimeLabel(item)}</span>
          </span>
          {confirm?.kind === "one" && confirm.id === item.id
            ? <span className="note-trash-confirm" role="group" aria-label={`Delete “${item.title}” forever?`}>
              <span className="note-trash-confirm-text">Delete forever?</span>
              <button autoFocus type="button" className="notion-button" disabled={busy} onClick={() => setConfirm(null)}>Cancel</button>
              <button type="button" className="notion-button notes-delete" disabled={busy} onClick={() => void deleteForever(item)}>Delete forever</button>
            </span>
            : <span className="note-trash-actions">
              <button type="button" className="notion-button" disabled={busy} aria-label={`Restore “${item.title}”`} onClick={() => void restore(item)}>Restore</button>
              <button type="button" className="notion-button notes-delete" disabled={busy} aria-label={`Delete “${item.title}” forever`} onClick={() => setConfirm({ kind: "one", id: item.id })}>Delete forever</button>
            </span>}
        </li>)}
      </ul>}
    </div>
  </dialog>;
}
