"use client";

import { ArrowUpRight, Check, Copy, Download, Ellipsis, FilePlus2, Flag, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import "@/components/answer-actions.css";
import { answerConversationUrl, answerFileName, answerToNoteContent, conversationToMarkdownFile, type AnswerSource, type ConversationMessage } from "@/lib/answer-export";
import { writeClipboardText } from "@/lib/clipboard";
import { useBackToClose } from "@/lib/use-back-to-close";
import { useT } from "@/components/i18n-provider";
import { localizeSystemText, msg } from "@/lib/i18n/translate";

type Props = {
  messageId: string;
  // この回答の Markdown。コピーとノート保存に使い、ダウンロードは会話全体を別途読み込む。
  content: string;
  sessionId: string;
  conversationTitle: string;
};

// ノートへの保存の状態。保存中や保存済みの回答がまた描画されても（会話を行き来しても）「Save」に戻って二重に作らないよう、画面の外で持つ。
type SaveState = { status: "saving" } | { status: "saved"; pageId: string };
const saves = new Map<string, SaveState>();
const listeners = new Set<() => void>();

function setSave(key: string, next: SaveState | null) {
  if (next) saves.set(key, next);
  else saves.delete(key);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}


const SAVE_FAILED = msg("Could not save to Notes. Try again.");

function saveErrorMessage(status: number, data: Record<string, unknown>) {
  if (status === 413) return msg("This answer is too large to save as a note.");
  if (status === 400 && typeof data.error === "string" && data.error) return data.error;
  return SAVE_FAILED;
}

// 回答から新しいノートを 1 つ作る。サーバーが本文を検証し直す。成功したら一覧に加わるよう "notefable:page-created" を投げる。
async function saveAnswer(key: string, content: string, source: AnswerSource): Promise<{ ok: true | "pending" } | { ok: false; message: string }> {
  // 同じ回答の保存がすでに進行中なら、何もしない（成功とは扱わない）。
  if (saves.has(key)) return { ok: "pending" };
  setSave(key, { status: "saving" });
  try {
    const { title, blocks } = answerToNoteContent(content, source);
    const response = await fetch("/api/pages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, icon: null, cover: null, coverPosition: null, blocks }),
      // 応答が来ないまま「保存中」で止まらないよう、時間で打ち切って再試行できる状態に戻す。
      signal: AbortSignal.timeout(30000),
    });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const page = data.page as { id?: unknown } | undefined;
    if (!response.ok || typeof page?.id !== "string") {
      setSave(key, null);
      return { ok: false, message: saveErrorMessage(response.status, data) };
    }
    setSave(key, { status: "saved", pageId: page.id });
    window.dispatchEvent(new CustomEvent("notefable:page-created", { detail: page }));
    return { ok: true };
  } catch {
    setSave(key, null);
    return { ok: false, message: SAVE_FAILED };
  }
}

// Blob の object URL から .md をダウンロードさせる。ダウンロードが始まったあとで URL を解放する。
function downloadText(fileName: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}

const STATUS_MS = 2000;

// サイドバーと同じメニューの見た目と、Android の「戻る」で閉じる挙動を使う。
// 「…」ボタンから開くメニュー。回答の操作とノートのページメニューが同じものを使う。
export function AnswerMenu({ id, anchor, trigger, focusLast, onClose, children, label, className = "" }: {
  id: string; anchor: DOMRect; trigger: HTMLButtonElement; focusLast: boolean; onClose: () => void; children: ReactNode; label?: string; className?: string;
}) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  useBackToClose(true, onClose);
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    const position = () => {
      const bounds = dialog.getBoundingClientRect();
      const below = anchor.bottom + 4;
      dialog.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - bounds.width - 8))}px`;
      dialog.style.top = `${Math.max(8, below + bounds.height <= window.innerHeight - 8 ? below : anchor.top - bounds.height - 4)}px`;
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(dialog);
    const items = dialog.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])');
    items[focusLast ? items.length - 1 : 0]?.focus({ preventScroll: true });
    const dismissOnScroll = (event: Event) => { if (!(event.target instanceof Node) || !dialog.contains(event.target)) onClose(); };
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", dismissOnScroll, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", dismissOnScroll, true);
      dialog.close();
      if (trigger.isConnected) trigger.focus({ preventScroll: true });
    };
  }, [anchor, trigger, focusLast, onClose]);

  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])'));
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
      : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  }

  return <dialog ref={ref} id={id} aria-label={label ?? t("Answer options")} className={`chat-actions-menu answer-actions-menu ${className}`}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    }}>
    <div role="menu" aria-label={label ?? t("Answer options")} onKeyDown={keyboard}>{children}</div>
  </dialog>;
}

// 完了した回答の下はコピーと「…」だけにし、保存・ダウンロードはメニューにまとめる。
// AI の回答を開発者に通報する（Google Play の AI 生成コンテンツのポリシー）。理由は任意。送った内容は運営者のメールに届く。
function ReportAnswerDialog({ messageId, onClose }: { messageId: string; onClose: () => void }) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const close = () => { if (busy) return false; onClose(); };
  useBackToClose(true, close);
  useEffect(() => { ref.current?.showModal(); }, []);

  async function send() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/reports", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messageId, reason: reason.trim() }),
      });
      const data = await response.json().catch(() => null) as { error?: unknown } | null;
      if (!response.ok) throw new Error(typeof data?.error === "string" && data.error ? data.error : msg("Could not send the report."));
      setSent(true); setBusy(false);
    } catch (reason) {
      setError(reason instanceof Error && reason.message ? reason.message : msg("Could not send the report."));
      setBusy(false);
    }
  }

  return <dialog ref={ref} aria-labelledby={titleId} className="notes-dialog answer-report-dialog"
    onCancel={(event) => { event.preventDefault(); close(); }}>
    {sent ? <div role="status">
      <h2 id={titleId} className="text-base font-semibold">{t("Report this answer")}</h2>
      <p className="mt-2 text-sm text-[var(--notion-muted)]">{t("Report sent. Thank you.")}</p>
      <div className="mt-5 flex justify-end">
        <button type="button" autoFocus className="notion-button notion-button-primary" onClick={onClose}>{t("Done")}</button>
      </div>
    </div> : <form onSubmit={(event) => { event.preventDefault(); void send(); }}>
      <h2 id={titleId} className="text-base font-semibold">{t("Report this answer")}</h2>
      <p className="mt-2 text-sm text-[var(--notion-muted)]">{t("Tell us what’s wrong with this answer. It is sent to the NoteFable team together with your question.")}</p>
      <textarea autoFocus value={reason} maxLength={1000} disabled={busy} onChange={(event) => setReason(event.target.value)}
        placeholder={t("What’s wrong? (optional)")} aria-label={t("What’s wrong? (optional)")} className="notes-dialog-input answer-report-reason" />
      {error && <p role="alert" className="mt-2 text-sm text-[#b91c1c]">{localizeSystemText(error, t)}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className="notion-button" disabled={busy} onClick={onClose}>{t("Cancel")}</button>
        <button type="submit" disabled={busy} className="notion-button notion-button-primary">{busy ? t("Sending…") : t("Send report")}</button>
      </div>
    </form>}
  </dialog>;
}

export function AnswerActions({ messageId, content, sessionId, conversationTitle }: Props) {
  const t = useT();
  const key = `${sessionId}\n${messageId}`;
  const save = useSyncExternalStore(subscribe, () => saves.get(key), () => undefined);
  // 押した直後だけアイコンを ✓ にする操作と、スクリーンリーダー向けの通知。
  const [done, setDone] = useState<"copy" | "download" | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<{ action: "copy" | "download" | "save"; message: string } | null>(null);
  const [downloading, setDownloading] = useState(false);
  const downloadLock = useRef(false);
  const [menu, setMenu] = useState<{ anchor: DOMRect; trigger: HTMLButtonElement; focusLast: boolean } | null>(null);
  const [reporting, setReporting] = useState(false);
  const menuId = useId();
  const closeMenu = useCallback(() => setMenu(null), []);
  const alive = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clearTimeout(timer.current);
    };
  }, []);

  function announce(message: string, action: "copy" | "download" | null = null) {
    clearTimeout(timer.current);
    setStatus(message);
    setDone(action);
    timer.current = setTimeout(() => {
      setStatus("");
      setDone(null);
    }, STATUS_MS);
  }

  // ボタンを押した時点の会話のタイトルと日時で、どこから保存したかを残す。
  function source(): AnswerSource {
    return { conversationTitle, conversationUrl: answerConversationUrl(window.location.origin, sessionId, messageId), savedAt: new Date() };
  }

  async function copy() {
    setError(null);
    const copied = await writeClipboardText(content);
    if (!alive.current) return;
    if (copied) announce(t("Copied"), "copy");
    else setError({ action: "copy", message: t("Could not copy. Select the text and copy it instead.") });
  }

  async function download() {
    if (downloadLock.current) return;
    downloadLock.current = true;
    setDownloading(true);
    setError(null);
    try {
      // 押した回答の位置や画面内のキャッシュによらず、この会話の保存済み履歴を全部取得する。
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/messages`, {
        cache: "no-store", signal: AbortSignal.timeout(30000),
      });
      const data = await response.json() as { messages?: ConversationMessage[] };
      if (!response.ok || !Array.isArray(data.messages) || !data.messages.length) throw new Error(t("Conversation unavailable"));
      if (!alive.current) return;
      const exportSource = { conversationTitle, conversationUrl: answerConversationUrl(window.location.origin, sessionId), savedAt: new Date() };
      downloadText(answerFileName(conversationTitle.trim() || "conversation"), conversationToMarkdownFile(data.messages, exportSource));
      closeMenu();
      announce(t("Conversation downloaded"), "download");
    } catch {
      if (alive.current) setError({ action: "download", message: t("Could not download the conversation. Try again.") });
    } finally {
      downloadLock.current = false;
      if (alive.current) setDownloading(false);
    }
  }

  async function saveToNotes() {
    // 保存中・保存済みは押しても何もしない（同じ回答から重複してノートを作らない）。
    if (save) return;
    setError(null);
    const result = await saveAnswer(key, content, source());
    if (!alive.current) return;
    if (result.ok === "pending") return;
    if (result.ok) announce(t("Saved to page"));
    else setError({ action: "save", message: result.message });
  }

  function openNote(event: MouseEvent<HTMLAnchorElement>, pageId: string) {
    closeMenu();
    // 修飾キー付きや中ボタンは、リンクとして新しいタブで開かせる。
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    window.dispatchEvent(new CustomEvent("notefable:open-note", { detail: { id: pageId } }));
  }

  return (
    <div className="answer-actions" role="group" aria-label={t("Answer actions")}>
      <button type="button" className="answer-action" onClick={() => void copy()} aria-label={t("Copy answer")} title={t("Copy answer")}>
        {done === "copy" ? <Check size={16} strokeWidth={2} /> : <Copy size={16} strokeWidth={1.9} />}
      </button>
      <button type="button" className="answer-action" aria-label={t("More answer options")} title={t("More options")}
        aria-haspopup="menu" aria-expanded={!!menu} aria-controls={menuId}
        onClick={event => setMenu({ anchor: event.currentTarget.getBoundingClientRect(), trigger: event.currentTarget, focusLast: false })}
        onKeyDown={event => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          setMenu({ anchor: event.currentTarget.getBoundingClientRect(), trigger: event.currentTarget, focusLast: event.key === "ArrowUp" });
        }}>
        <Ellipsis size={18} strokeWidth={1.9} />
      </button>
      {menu && <AnswerMenu id={menuId} anchor={menu.anchor} trigger={menu.trigger} focusLast={menu.focusLast} onClose={closeMenu}>
        {/* 保存中もメニューを保ち、同じ項目で進捗と成功を表示する。 */}
        <button type="button" role="menuitem" className="chat-menu-item" onClick={() => void saveToNotes()}
          aria-disabled={!!save} aria-busy={save?.status === "saving"}>
          {save?.status === "saving" ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />
            : save?.status === "saved" ? <Check size={16} aria-hidden="true" /> : <FilePlus2 size={16} aria-hidden="true" />}
          {save?.status === "saving" ? t("Saving…") : save?.status === "saved" ? t("Saved to page") : error?.action === "save" ? t("Retry saving to page") : t("Save to page")}
        </button>
        {save?.status === "saved" && <a role="menuitem" className="chat-menu-item"
          href={`/?view=pages&page=${encodeURIComponent(save.pageId)}`} onClick={event => openNote(event, save.pageId)}>
          <ArrowUpRight size={16} aria-hidden="true" />{t("Open saved page")}
        </a>}
        <button type="button" role="menuitem" className="chat-menu-item" aria-disabled={downloading} aria-busy={downloading} onClick={() => void download()}>
          {downloading ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : <Download size={16} aria-hidden="true" />}
          {downloading ? t("Downloading…") : t("Download conversation")}
        </button>
        <button type="button" role="menuitem" className="chat-menu-item" onClick={() => { closeMenu(); setReporting(true); }}>
          <Flag size={16} aria-hidden="true" />{t("Report answer")}
        </button>
        <span role="status" aria-live="polite" className="sr-only">{status}</span>
        {error && <p role="alert" className="answer-menu-error">{localizeSystemText(error.message, t)}</p>}
      </AnswerMenu>}
      {!menu && <span role="status" aria-live="polite" className="sr-only">{status}</span>}
      {!menu && error && <span role="alert" className="answer-actions-error">{localizeSystemText(error.message, t)}</span>}
      {reporting && <ReportAnswerDialog messageId={messageId} onClose={() => setReporting(false)} />}
    </div>
  );
}
