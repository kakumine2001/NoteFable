"use client";

import { FileText, LoaderCircle, Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import "@/components/chat-project-settings.css";
import type { ChatProject } from "@/components/chat-actions";
import { useBackToClose } from "@/lib/use-back-to-close";
import { MAX_PROJECT_INSTRUCTIONS, MAX_PROJECT_NOTES, type ChatProjectDetail, type ChatProjectSummary } from "@/types/chat";

type NoteRef = ChatProjectDetail["notes"][number];
// 一覧に出すノートの上限。多いときは絞り込みで探す。
const MAX_LISTED = 100;
const SAVE_FAILED = "Could not save the project settings. Please try again.";

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const data: unknown = await response.json().catch(() => null);
  return data && typeof data === "object" ? data as Record<string, unknown> : {};
}
const errorOf = (data: Record<string, unknown>, fallback: string) => typeof data.error === "string" ? data.error : fallback;

// プロジェクトの共通指示と参照ノートを編集するダイアログ。参照ノートは手動で選んだものだけが使われる。
export function ChatProjectSettings({ project, onClose, onSaved }: {
  project: ChatProject; onClose: () => void; onSaved: (project: ChatProject) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const locked = useRef(false);
  const titleId = useId();
  const helpId = useId();
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ initial: ChatProjectDetail; pages: NoteRef[] } | null>(null);
  const [loadError, setLoadError] = useState("");
  const [instructions, setInstructions] = useState("");
  const [selected, setSelected] = useState<NoteRef[]>([]);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useBackToClose(true, onClose);
  useEffect(() => { ref.current?.showModal(); }, []);

  useEffect(() => {
    const controller = new AbortController();
    const get = (url: string) => fetch(url, { signal: controller.signal, cache: "no-store" });
    void Promise.all([get(`/api/chat-projects/${project.id}`), get("/api/pages")]).then(async ([detailResponse, pagesResponse]) => {
      const [detailData, pagesData] = await Promise.all([readJson(detailResponse), readJson(pagesResponse)]);
      if (!detailResponse.ok) throw new Error(errorOf(detailData, "Could not load the project settings."));
      if (!pagesResponse.ok || !Array.isArray(pagesData.pages)) throw new Error(errorOf(pagesData, "Could not load your notes."));
      const initial = detailData.project as ChatProjectDetail;
      setLoaded({ initial, pages: (pagesData.pages as NoteRef[]).map(({ id, title, icon }) => ({ id, title, icon })) });
      setInstructions(initial.instructions ?? "");
      setSelected(initial.notes);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setLoadError(reason instanceof Error && reason.message ? reason.message : "Could not load the project settings.");
    });
    return () => controller.abort();
  }, [project.id, attempt]);

  const selectedIds = useMemo(() => new Set(selected.map((note) => note.id)), [selected]);
  const full = selected.length >= MAX_PROJECT_NOTES;
  const listed = useMemo(() => {
    const query = filter.trim().toLowerCase();
    const pages = loaded?.pages ?? [];
    return query ? pages.filter((page) => (page.title || "Untitled").toLowerCase().includes(query)) : pages;
  }, [loaded, filter]);

  function toggle(note: NoteRef) {
    setSelected((list) => list.some((item) => item.id === note.id) ? list.filter((item) => item.id !== note.id)
      : list.length >= MAX_PROJECT_NOTES ? list : [...list, note]);
  }

  async function save() {
    if (!loaded || locked.current) return;
    // 変えた項目だけ送る。参照ノートは全置き換えなので、触っていなければ送らない。
    const body: { instructions?: string; noteIds?: string[] } = {};
    const text = instructions.trim();
    if (text !== (loaded.initial.instructions ?? "")) body.instructions = text;
    const ids = selected.map((note) => note.id);
    if (ids.join("\n") !== loaded.initial.notes.map((note) => note.id).join("\n")) body.noteIds = ids;
    if (!Object.keys(body).length) { onClose(); return; }
    locked.current = true; setBusy(true); setError("");
    try {
      const response = await fetch(`/api/chat-projects/${project.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await readJson(response);
      if (!response.ok) throw new Error(errorOf(data, SAVE_FAILED));
      const saved = data.project as ChatProjectSummary | undefined;
      onSaved(saved && typeof saved.id === "string" ? saved : { ...project, noteCount: ids.length, hasInstructions: !!text });
      onClose();
    } catch (reason) {
      setError(reason instanceof Error && reason.message ? reason.message : SAVE_FAILED);
    } finally { locked.current = false; setBusy(false); }
  }

  return <dialog ref={ref} aria-labelledby={titleId} className="notes-dialog chat-project-settings"
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => { if (event.target === event.currentTarget) { const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) onClose(); } }}>
    <form className="project-settings-shell" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <div className="project-settings-header">
        <h2 id={titleId}>Project settings</h2>
        <p className="project-settings-subtitle">{project.name}</p>
      </div>
      <div className="project-settings-body">
        {!loaded && !loadError && <p className="project-settings-empty" role="status"><LoaderCircle size={14} className="mr-1 inline animate-spin" aria-hidden="true" />Loading…</p>}
        {loadError && <>
          <p role="alert" className="project-settings-error">{loadError}</p>
          <button type="button" className="notion-button mt-2" onClick={() => { setLoadError(""); setAttempt((count) => count + 1); }}>Try again</button>
        </>}
        {loaded && <>
          <section className="project-settings-section">
            <label htmlFor={`${titleId}-instructions`} className="project-settings-label">
              Instructions
              <span className="project-settings-count" aria-live="polite">{instructions.length}/{MAX_PROJECT_INSTRUCTIONS}</span>
            </label>
            <p id={helpId} className="project-settings-help">
              Applied to every chat in this project. Say what the project is for, which language to answer in, and how to format answers.
            </p>
            <textarea id={`${titleId}-instructions`} autoFocus className="project-settings-textarea" value={instructions} disabled={busy}
              maxLength={MAX_PROJECT_INSTRUCTIONS} aria-describedby={helpId}
              placeholder="Example: Help me write Japanese business emails. Keep a polite tone and answer with a short draft first."
              onChange={(event) => setInstructions(event.target.value)} />
          </section>
          <section className="project-settings-section" aria-labelledby={`${titleId}-notes`}>
            <h3 id={`${titleId}-notes`} className="project-settings-label">
              Reference notes
              <span className={`project-settings-count${full ? " is-full" : ""}`} aria-live="polite">{selected.length}/{MAX_PROJECT_NOTES}</span>
            </h3>
            <p className="project-settings-help">
              Only the notes you choose here are shared with the AI in this project’s chats. They are read live, so your latest edits apply from the next message.
            </p>
            {selected.length > 0 && <ul className="project-settings-chips" aria-label="Selected notes">
              {selected.map((note) => <li key={note.id} className="project-settings-chip">
                <FileText size={13} aria-hidden="true" className="flex-none" />
                <span className="project-settings-chip-title">{note.title || "Untitled"}</span>
                <button type="button" disabled={busy} aria-label={`Remove ${note.title || "Untitled"}`} onClick={() => toggle(note)}><X size={12} aria-hidden="true" /></button>
              </li>)}
            </ul>}
            <label className="project-settings-search">
              <Search size={14} aria-hidden="true" />
              <input type="search" value={filter} placeholder="Filter your notes" aria-label="Filter your notes" onChange={(event) => setFilter(event.target.value)}
                // Enter は絞り込みの確定だけで、フォームの保存にはしない。
                onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }} />
            </label>
            {listed.length > 0 && <ul className="project-settings-list" aria-label="Your notes">
              {listed.slice(0, MAX_LISTED).map((page) => {
                const checked = selectedIds.has(page.id);
                const blocked = !checked && full;
                return <li key={page.id}>
                  <label className={`project-settings-option${checked ? " is-selected" : ""}${blocked ? " is-disabled" : ""}`}>
                    <input type="checkbox" checked={checked} disabled={busy || blocked} onChange={() => toggle(page)} />
                    <span className="project-settings-note-icon" aria-hidden="true">{page.icon ?? <FileText size={14} />}</span>
                    <span className="project-settings-note-title">{page.title || "Untitled"}</span>
                  </label>
                </li>;
              })}
            </ul>}
            {!listed.length && <p className="project-settings-empty">{loaded.pages.length ? "No notes match." : "You don’t have any notes yet."}</p>}
            {listed.length > MAX_LISTED && <p className="project-settings-empty">Showing the first {MAX_LISTED} notes. Type in the filter to find others.</p>}
            {full && <p className="project-settings-empty">You can choose up to {MAX_PROJECT_NOTES} notes. Remove one to pick another.</p>}
          </section>
        </>}
        {error && <p role="alert" className="project-settings-error">{error}</p>}
      </div>
      <div className="project-settings-footer">
        <button type="button" disabled={busy} className="notion-button" onClick={onClose}>Cancel</button>
        <button type="submit" disabled={busy || !loaded} className="notion-button notion-button-primary">{busy ? "Saving…" : "Save"}</button>
      </div>
    </form>
  </dialog>;
}
