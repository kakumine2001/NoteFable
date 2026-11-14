"use client";

import { ArrowLeft, History, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { AssistantMarkdown } from "@/components/assistant-markdown";
import { blocksToMarkdown } from "@/lib/note-markdown";
import { useBackToClose } from "@/lib/use-back-to-close";
import type { NotePage, NoteRevisionDetail, NoteRevisionReason, NoteRevisionSummary } from "@/types/notes";
import "@/components/note-trash-history.css";
import { useNow } from "@/lib/use-now";
import { useI18n } from "@/components/i18n-provider";
import { createTranslator, localizeSystemText, msg, type Translate } from "@/lib/i18n/translate";

const english = createTranslator({});

export const REVISION_REASON_LABELS: Record<NoteRevisionReason, string> = { AUTO: msg("Auto-saved"), AI_EDIT: msg("Before AI edit"), RESTORE: msg("Before restore") };

// 「5 min ago」「Yesterday」。1 週間を超えたら日付。経過は切り捨て、実際より新しいとは言わない。
export function relativeTime(iso: string, now = Date.now(), t: Translate = english, tag?: string) {
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return "";
  const seconds = Math.floor((now - time) / 1000);
  if (seconds < 45) return t("Just now");
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t("{count} min ago", { count: Math.max(1, minutes) });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? t("1 hour ago") : t("{count} hours ago", { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return days === 1 ? t("Yesterday") : t("{count} days ago", { count: days });
  return new Date(time).toLocaleDateString(tag, { month: "short", day: "numeric", year: new Date(now).getFullYear() === new Date(time).getFullYear() ? undefined : "numeric" });
}

const LIST_ITEM = /^\s*(?:[-+*]|\d+[.)])\s/;

// プレビュー用の Markdown。blocksToMarkdown は 1 行が 1 ブロックなので、そのままだと連続した段落が 1 つに繋がる。
// コードの囲みの外では行の間に空行を入れて段落を分け、連続する箇条書きだけは詰めたままにする（4 つ以上の字下げがコード扱いにならないよう、箇条書き以外は字下げを外す）。
export function previewMarkdown(blocks: unknown) {
  const out: string[] = [];
  let fence: string | null = null;
  let previousItem = false;
  // 表の行（| で始まる行）は詰めたままにする。空行が入ると表として描かれない。表と表の間の空行は元のまま残る。
  let previousRow = false;
  for (const line of blocksToMarkdown(blocks).split("\n")) {
    if (fence) {
      out.push(line);
      if (line.trim() === fence) fence = null;
      continue;
    }
    if (!line.trim()) { previousItem = previousRow = false; continue; }
    const opening = /^\s*(`{3,})/.exec(line);
    const item = !opening && LIST_ITEM.test(line);
    const row = !opening && !item && line.trimStart().startsWith("|");
    if (out.length && !(item && previousItem) && !(row && previousRow)) out.push("");
    out.push(item ? line : line.trimStart());
    previousItem = item;
    previousRow = row;
    if (opening) fence = opening[1];
  }
  return out.join("\n");
}

type ListState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; revisions: NoteRevisionSummary[] };
type DetailState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; revision: NoteRevisionDetail };

async function jsonRequest(url: string, init?: RequestInit) {
  const response = await fetch(url, { cache: "no-store", ...init });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}
const failure = (data: { error?: unknown }, fallback: string) => typeof data.error === "string" && data.error ? data.error : fallback;

// ノートの編集履歴。一覧から選んで中身を確かめ、その版へ戻す。戻す前の状態は履歴に残るので、戻した操作も取り消せる。
// getVersion は呼ぶたびにエディターが持つ現在の版を返し、flush は未保存の編集を送り切る（false なら戻さない）。
export function NoteHistoryDialog({ noteId, getVersion, flush, onRestored, onClose }: {
  noteId: string;
  getVersion: () => number;
  flush: () => Promise<boolean>;
  onRestored: (page: NotePage) => void;
  onClose: () => void;
}) {
  const { t, tag } = useI18n();
  const now = useNow();
  const ref = useRef<HTMLDialogElement>(null);
  const locked = useRef(false);
  const details = useRef(new Map<string, NoteRevisionDetail>());
  const requested = useRef(0);
  const [list, setList] = useState<ListState>({ status: "loading" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailState | null>(null);
  const [busy, setBusy] = useState(false);
  const [restoreError, setRestoreError] = useState("");
  const [outdated, setOutdated] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useBackToClose(true, onClose);

  useEffect(() => { ref.current?.showModal(); }, []);

  const select = useCallback((id: string) => {
    setSelectedId(id);
    setRestoreError("");
    const cached = details.current.get(id);
    const request = ++requested.current;
    if (cached) { setDetail({ status: "ready", revision: cached }); return; }
    setDetail({ status: "loading" });
    jsonRequest(`/api/pages/${noteId}/revisions/${id}`)
      .then(({ response, data }) => {
        if (request !== requested.current) return;
        if (!response.ok) { setDetail({ status: "error", message: failure(data, msg("Could not load this version.")) }); return; }
        details.current.set(id, data.revision);
        setDetail({ status: "ready", revision: data.revision as NoteRevisionDetail });
      })
      .catch(() => { if (request === requested.current) setDetail({ status: "error", message: msg("Could not load this version.") }); });
  }, [noteId]);

  useEffect(() => {
    let cancelled = false;
    jsonRequest(`/api/pages/${noteId}/revisions`)
      .then(({ response, data }) => {
        if (cancelled) return;
        if (!response.ok) { setList({ status: "error", message: failure(data, msg("Could not load the history.")) }); return; }
        const revisions = data.revisions as NoteRevisionSummary[];
        setList({ status: "ready", revisions });
        // 横に並べられる広さなら、いちばん新しい版を先に見せる（スマホでは一覧から選ぶ）。
        if (revisions[0] && window.matchMedia("(min-width: 640px)").matches) select(revisions[0].id);
      })
      .catch(() => { if (!cancelled) setList({ status: "error", message: msg("Could not load the history.") }); });
    return () => { cancelled = true; };
  }, [noteId, attempt, select]);

  async function restore() {
    if (!selectedId || locked.current) return;
    locked.current = true;
    setBusy(true);
    setRestoreError("");
    try {
      // 未保存の編集を先に保存する。保存できなければ、その編集を失わないよう戻さない。
      if (!(await flush())) { setRestoreError(msg("Your latest edits could not be saved, so nothing was restored. Resolve the save problem in the note, then try again.")); return; }
      const { response, data } = await jsonRequest(`/api/pages/${noteId}/revisions/${selectedId}/restore`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: getVersion() }),
      });
      if (response.status === 409) {
        setOutdated(true);
        setRestoreError(msg("This note was changed in another tab, so nothing was restored. Close this window and reopen the history to see the latest versions."));
        // 開いているノートを最新の版にそろえる（そうしないと次の保存も 409 になる）。
        if (data.page) window.dispatchEvent(new CustomEvent("studymate:page-updated", { detail: data.page }));
        return;
      }
      if (!response.ok) { setRestoreError(failure(data, msg("Could not restore this version. Please try again."))); return; }
      const page = data.page as NotePage;
      window.dispatchEvent(new CustomEvent("studymate:page-updated", { detail: page }));
      onRestored(page);
      onClose();
    } catch { setRestoreError(msg("Could not restore this version. Check your connection and try again.")); }
    finally { locked.current = false; setBusy(false); }
  }

  // 一覧は上下キーで項目間を移動できる（選択は Enter / クリック）。
  function onListKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : Math.min(buttons.length - 1, Math.max(0, at + (event.key === "ArrowDown" ? 1 : -1)));
    buttons[next]?.focus();
  }

  const revision = detail?.status === "ready" ? detail.revision : null;
  return <dialog ref={ref} aria-labelledby="note-history-title" aria-busy={list.status === "loading" || busy} className="notes-dialog note-th-dialog note-history-dialog"
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => {
      if (event.target !== event.currentTarget) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
    }}>
    <div className="note-th-header">
      <h2 id="note-history-title" className="note-th-title"><History size={16} aria-hidden="true" />{t("Version history")}</h2>
      <button type="button" className="notion-icon-button" aria-label={t("Close version history")} title={t("Close")} onClick={onClose}><X size={16} /></button>
    </div>
    <div className="note-history-layout" data-view={selectedId ? "detail" : "list"}>
      <div className="note-history-list-pane">
        {list.status === "loading" && <p role="status" className="note-th-status">{t("Loading history…")}</p>}
        {list.status === "error" && <p role="alert" className="note-th-status">{t(list.message)}<br />
          <button type="button" className="notion-button" onClick={() => { setList({ status: "loading" }); setAttempt((value) => value + 1); }}>{t("Try again")}</button></p>}
        {list.status === "ready" && !list.revisions.length && <p role="status" className="note-th-status">{t("No earlier versions yet. Versions are saved automatically while you edit, and before an AI edit is applied.")}</p>}
        {list.status === "ready" && !!list.revisions.length && <ul className="note-history-list" aria-label={t("Saved versions")} onKeyDown={onListKeyDown}>
          {list.revisions.map((entry) => <li key={entry.id}>
            <button type="button" className="note-history-item" aria-current={selectedId === entry.id} onClick={() => select(entry.id)}
              title={new Date(entry.createdAt).toLocaleString(tag)}>
              <span className="note-history-when"><span>{relativeTime(entry.createdAt, now, t, tag)}</span><span className="note-history-reason" data-reason={entry.reason}>{t(REVISION_REASON_LABELS[entry.reason])}</span></span>
              <span className="note-th-row-meta">{entry.title}</span>
            </button>
          </li>)}
        </ul>}
      </div>
      <section className="note-history-preview" aria-label={t("Version preview")}>
        <div className="note-history-preview-body">
          <button type="button" className="notion-button note-history-back" onClick={() => { requested.current += 1; setSelectedId(null); setDetail(null); setRestoreError(""); }}><ArrowLeft size={15} aria-hidden="true" />{t("All versions")}</button>
          {!detail && <p className="note-history-preview-empty">{t("Select a version to preview it.")}</p>}
          {detail?.status === "loading" && <p role="status" className="note-history-preview-empty">{t("Loading version…")}</p>}
          {detail?.status === "error" && <p role="alert" className="note-history-footer-error">{t(detail.message)}</p>}
          {revision && <>
            <h3 className="note-history-preview-title">{revision.icon && <span aria-hidden="true">{revision.icon}</span>}{revision.title}</h3>
            <div className="markdown-body"><AssistantMarkdown content={previewMarkdown(revision.blocks) || t("_This version has no text._")} /></div>
          </>}
        </div>
        {revision && <div className="note-history-preview-footer">
          <span className="note-history-footer-text">
            {t("{reason} · {time}. Restoring keeps your current version in the history.", { reason: t(REVISION_REASON_LABELS[revision.reason]), time: new Date(revision.createdAt).toLocaleString(tag) })}
          </span>
          <button type="button" className="notion-button notion-button-primary" disabled={busy || outdated} onClick={() => void restore()}><RotateCcw size={14} aria-hidden="true" />{busy ? t("Restoring…") : t("Restore this version")}</button>
          {restoreError && <p role="alert" className="note-history-footer-error">{localizeSystemText(restoreError, t)}</p>}
        </div>}
      </section>
    </div>
  </dialog>;
}
