"use client";

import { ArrowUpRight, Check, Copy, Download, FilePlus2, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore, type MouseEvent } from "react";
import "@/components/answer-actions.css";
import { answerConversationUrl, answerFileName, answerTitle, answerToMarkdownFile, answerToNoteContent, type AnswerSource } from "@/lib/answer-export";
import { writeClipboardText } from "@/lib/clipboard";
import { isNativeApp } from "@/lib/native-app";

type Props = {
  messageId: string;
  // 回答の Markdown。保存されている文字列のまま、コピー・ダウンロード・ノートへ渡す。
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

const noSubscription = () => () => {};

const SAVE_FAILED = "Could not save to Notes. Try again.";

function saveErrorMessage(status: number, data: Record<string, unknown>) {
  if (status === 413) return "This answer is too large to save as a note.";
  if (status === 400 && typeof data.error === "string" && data.error) return data.error;
  return SAVE_FAILED;
}

// 回答から新しいノートを 1 つ作る。サーバーが本文を検証し直す。成功したら一覧に加わるよう "studymate:page-created" を投げる。
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
    window.dispatchEvent(new CustomEvent("studymate:page-created", { detail: page }));
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

// 完了した回答の下に出す操作の行: コピー、ノートに保存、Markdown でダウンロード。
export function AnswerActions({ messageId, content, sessionId, conversationTitle }: Props) {
  const key = `${sessionId}\n${messageId}`;
  const save = useSyncExternalStore(subscribe, () => saves.get(key), () => undefined);
  // 押した直後だけアイコンを ✓ にする操作と、スクリーンリーダー向けの通知。
  const [done, setDone] = useState<"copy" | "download" | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<{ action: "copy" | "download" | "save"; message: string } | null>(null);
  const alive = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Android アプリでは Markdown のダウンロードが動かないので出さない（サーバー描画と合わせるため、マウント後に判定する）。
  const native = useSyncExternalStore(noSubscription, isNativeApp, () => false);

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
    if (copied) announce("Copied", "copy");
    else setError({ action: "copy", message: "Could not copy. Select the text and copy it instead." });
  }

  function download() {
    setError(null);
    try {
      downloadText(answerFileName(answerTitle(content, conversationTitle)), answerToMarkdownFile(content, source()));
      announce("Downloaded", "download");
    } catch {
      setError({ action: "download", message: "Could not download the file. Try again." });
    }
  }

  async function saveToNotes() {
    // 保存中・保存済みは押しても何もしない（同じ回答から重複してノートを作らない）。
    if (save) return;
    setError(null);
    const result = await saveAnswer(key, content, source());
    if (!alive.current) return;
    if (result.ok === "pending") return;
    if (result.ok) announce("Saved to Notes");
    else setError({ action: "save", message: result.message });
  }

  function openNote(event: MouseEvent<HTMLAnchorElement>, pageId: string) {
    // 修飾キー付きや中ボタンは、リンクとして新しいタブで開かせる。
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    window.dispatchEvent(new CustomEvent("studymate:open-note", { detail: { id: pageId } }));
  }

  return (
    <div className="answer-actions" role="group" aria-label="Answer actions">
      <button type="button" className="answer-action" onClick={() => void copy()} aria-label="Copy answer" title="Copy answer">
        {done === "copy" ? <Check size={15} strokeWidth={2} /> : <Copy size={15} strokeWidth={1.9} />}
        <span className="answer-action-label">{done === "copy" ? "Copied" : "Copy"}</span>
      </button>
      {/* 保存中・保存済みも同じボタンのまま（フォーカスを失わない）。押しても何もしないので aria-disabled にする。 */}
      <button type="button" className={`answer-action${save?.status === "saved" ? " is-done" : ""}`} onClick={() => void saveToNotes()}
        aria-disabled={!!save} aria-busy={save?.status === "saving"} title={save?.status === "saved" ? "Saved to Notes" : "Save to Notes"}>
        {save?.status === "saving" ? <LoaderCircle size={15} className="animate-spin" aria-hidden="true" />
          : save?.status === "saved" ? <Check size={15} strokeWidth={2} aria-hidden="true" />
            : <FilePlus2 size={15} strokeWidth={1.9} aria-hidden="true" />}
        <span className="answer-action-label">{save?.status === "saving" ? "Saving…" : save?.status === "saved" ? "Saved to Notes" : error?.action === "save" ? "Retry" : "Save to Notes"}</span>
      </button>
      {save?.status === "saved" && (
        <a className="answer-action" href={`/?view=pages&page=${encodeURIComponent(save.pageId)}`} onClick={(event) => openNote(event, save.pageId)}
          aria-label="Open the saved note" title="Open the saved note">
          <ArrowUpRight size={15} strokeWidth={1.9} aria-hidden="true" />
          <span>Open</span>
        </a>
      )}
      {!native && (
        <button type="button" className="answer-action" onClick={download} aria-label="Download as Markdown" title="Download as Markdown">
          {done === "download" ? <Check size={15} strokeWidth={2} /> : <Download size={15} strokeWidth={1.9} />}
          <span className="answer-action-label">{done === "download" ? "Downloaded" : "Markdown"}</span>
        </button>
      )}
      <span role="status" aria-live="polite" className="sr-only">{status}</span>
      {error && <span role="alert" className="answer-actions-error">{error.message}</span>}
    </div>
  );
}
