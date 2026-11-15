"use client";

import { ArrowUpRight, FilePlus, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { useT } from "@/components/i18n-provider";
import { localizeSystemText, msg } from "@/lib/i18n/translate";
import { useBackToClose } from "@/lib/use-back-to-close";

// 「Create page」：会話全体を AI が 1 つのノートに書き直す（POST /api/sessions/:id/page）。
// 生成には時間がかかるので、窓を閉じても要求は続け、出来たページは "notefable:page-created" で一覧に加わる。
// 状態は会話ごとに部品の外に持つ。窓を開き直しても進行中なら同じ表示に戻り、同じ会話で二重に作らない。

export type CreatePageJob =
  | { status: "working" }
  // partial: 長い会話で、古い発言を使わずに作った。
  | { status: "done"; page: { id: string; title: string }; partial: boolean }
  | { status: "error"; message: string };

const FAILED = msg("Could not create a page from this chat. Try again.");
const jobs = new Map<string, CreatePageJob>();
const listeners = new Set<() => void>();

function setJob(sessionId: string, job: CreatePageJob | null) {
  if (job) jobs.set(sessionId, job);
  else jobs.delete(sessionId);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

// サーバーの理由をそのまま見せるのは、上限（429）と検証（400 / 413）と空の会話だけ。会話が無い（404）はその旨、他は共通の文。
export function createPageErrorMessage(status: number, data: Record<string, unknown>) {
  if ([400, 413, 429].includes(status) && typeof data.error === "string" && data.error) return data.error;
  if (status === 404) return msg("Session not found.");
  return FAILED;
}

export async function createPageFromChat(sessionId: string, model: string) {
  if (jobs.get(sessionId)?.status === "working") return;
  setJob(sessionId, { status: "working" });
  try {
    const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/page`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, savedOn: today() }),
    });
    const data: unknown = await response.json().catch(() => null);
    const body = data && typeof data === "object" ? data as Record<string, unknown> : {};
    const page = body.page as { id?: unknown; title?: unknown } | undefined;
    if (!response.ok || typeof page?.id !== "string") {
      setJob(sessionId, { status: "error", message: createPageErrorMessage(response.status, body) });
      return;
    }
    window.dispatchEvent(new CustomEvent("notefable:page-created", { detail: page }));
    setJob(sessionId, { status: "done", page: { id: page.id, title: typeof page.title === "string" ? page.title : "" }, partial: body.partial === true });
  } catch {
    setJob(sessionId, { status: "error", message: FAILED });
  }
}

// busy: この会話で送信・アップロード・返答が進行中。最後の回答がまだ保存されていないので作らない。
export function CreatePageDialog({ sessionId, model, busy, onClose }: { sessionId: string; model: string; busy: boolean; onClose: () => void }) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const job = useSyncExternalStore(subscribe, () => jobs.get(sessionId) ?? null, () => null);
  // 閉じたら、終わった結果は忘れる（次に開いたときは、続けた会話から新しく作れる）。進行中のものは残す。
  const close = () => {
    const current = jobs.get(sessionId);
    if (current && current.status !== "working") setJob(sessionId, null);
    onClose();
  };
  useBackToClose(true, close);
  useEffect(() => { ref.current?.showModal(); }, []);

  // 検索から開くときと同じ順：先に開く（窓が積んだ履歴の目印をページの URL に置き換える）、それから閉じる。
  function openPage(id: string) {
    window.dispatchEvent(new CustomEvent("notefable:open-note", { detail: { id } }));
    close();
  }

  return <dialog ref={ref} aria-labelledby="create-page-title" className="notes-dialog create-page-dialog"
    onCancel={(event) => { event.preventDefault(); close(); }}
    onClick={(event) => { if (event.target === event.currentTarget) { const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close(); } }}>
    <h2 id="create-page-title" className="flex items-center gap-2 text-base font-semibold"><FilePlus size={18} aria-hidden="true" />{t("Create a page from this chat")}</h2>
    {job?.status === "working" ? (
      <p role="status" className="mt-3 flex items-start gap-2 text-sm text-[var(--notion-muted)]">
        <LoaderCircle size={16} className="mt-0.5 shrink-0 animate-spin" aria-hidden="true" />
        <span>{t("Writing the page… This can take a minute. You can close this window; the page will appear in Notes when it’s ready.")}</span>
      </p>
    ) : job?.status === "done" ? (
      <p role="status" className="mt-3 text-sm text-[var(--notion-muted)]">
        {t("Created “{title}” in Notes.", { title: job.page.title })}
        {job.partial && <> {t("This chat is long, so only the most recent messages were used.")}</>}
      </p>
    ) : (
      <p className="mt-3 text-sm text-[var(--notion-muted)]">{t("NoteFable rewrites this conversation into an organized note in Notes, using the selected model. In a very long chat, only the most recent messages are used. It counts as one message toward today’s limit.")}</p>
    )}
    {job?.status === "error" && <p role="alert" className="mt-2 text-sm text-[#b91c1c]">{localizeSystemText(job.message, t)}</p>}
    <div className="mt-5 flex justify-end gap-2">
      <button type="button" className="notion-button" onClick={close}>{job?.status === "working" || job?.status === "done" ? t("Close") : t("Cancel")}</button>
      {job?.status === "done" ? (
        <button type="button" autoFocus className="notion-button notion-button-primary inline-flex items-center gap-1" onClick={() => openPage(job.page.id)}>
          {t("Open page")}<ArrowUpRight size={15} aria-hidden="true" />
        </button>
      ) : (
        <button type="button" autoFocus disabled={job?.status === "working" || busy} className="notion-button notion-button-primary"
          onClick={() => void createPageFromChat(sessionId, model)}>
          {job?.status === "error" ? t("Try again") : t("Create page")}
        </button>
      )}
    </div>
  </dialog>;
}
