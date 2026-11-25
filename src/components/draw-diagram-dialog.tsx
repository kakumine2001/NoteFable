"use client";

import { ArrowUpRight, Check, Copy, LoaderCircle, Workflow } from "lucide-react";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { useT } from "@/components/i18n-provider";
import { writeClipboardText } from "@/lib/clipboard";
import { closeDiagramDialog, dismissDiagramJob, getDiagramDialog, getDiagramJob, retryDiagramJob, subscribeDiagramJobs, type DiagramJob } from "@/lib/draw-diagram-jobs";
import { localizeSystemText } from "@/lib/i18n/translate";
import { nativeCanOpenPage, postToNative } from "@/lib/native-bridge";
import { useBackToClose } from "@/lib/use-back-to-close";

// 「画成図」の進み具合と結果の窓（要求と状態は src/lib/draw-diagram-jobs.ts）。見た目と閉じ方は Create page の窓と同じ。

// 元（回答・ノート）の要求の状態。メニューの項目が「作成中」を出すのに使う。
export function useDiagramJob(key: string | null): DiagramJob | null {
  return useSyncExternalStore(subscribeDiagramJobs, () => (key ? getDiagramJob(key) : null), () => null);
}

// 画面に 1 つだけ置く。どの入口から開いても、ここに窓を出す。
// embedded: アプリの WebView（/note-embed）。「Open whiteboard」はアプリにページを開いてもらい、WebView の中では移動しない。
export function DrawDiagramHost({ embedded = false }: { embedded?: boolean }) {
  const dialog = useSyncExternalStore(subscribeDiagramJobs, getDiagramDialog, () => null);
  if (!dialog) return null;
  return <DrawDiagramDialog key={dialog.key} jobKey={dialog.key} notice={dialog.notice} embedded={embedded} />;
}

const COPIED_MS = 2000;

function DrawDiagramDialog({ jobKey, notice, embedded }: { jobKey: string; notice?: string; embedded: boolean }) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const job = useDiagramJob(jobKey);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // 閉じたら、終わった結果は忘れる（次に選んだら新しく作る）。進行中のものは残す。
  const close = () => {
    dismissDiagramJob(jobKey);
    closeDiagramDialog();
  };
  useBackToClose(true, close);
  useEffect(() => { ref.current?.showModal(); }, []);
  useEffect(() => () => clearTimeout(timer.current), []);

  // アプリの中では、ページを開けるアプリにだけ「開く」を出す（開けない古いアプリでは、出来たことだけを知らせる）。
  const canOpen = !embedded || nativeCanOpenPage();
  // Create page と同じ順：先に開く（窓が積んだ履歴の目印をページの URL に置き換える）、それから閉じる。
  function openPage(id: string) {
    if (embedded) postToNative({ type: "openPage", id });
    else window.dispatchEvent(new CustomEvent("notefable:open-note", { detail: { id } }));
    close();
  }

  // 同じ clientRequestId で送り直す（応答だけが失われていたら、作ってあるページが返り、数え直さない）。
  function retry() {
    setCopied(false);
    setCopyFailed(false);
    retryDiagramJob(jobKey);
  }

  async function copySource(source: string) {
    const ok = await writeClipboardText(source);
    setCopyFailed(!ok);
    if (!ok) return;
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_MS);
  }

  const working = !notice && job?.status === "working";
  const done = !notice && job?.status === "done" ? job : null;
  const failed = !notice && job?.status === "error" ? job : null;
  const source = failed?.source ?? null;

  return <dialog ref={ref} aria-labelledby={titleId} className="notes-dialog draw-diagram-dialog"
    onCancel={(event) => { event.preventDefault(); close(); }}
    onClick={(event) => { if (event.target === event.currentTarget) { const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close(); } }}>
    <h2 id={titleId} className="flex items-center gap-2 text-base font-semibold"><Workflow size={18} aria-hidden="true" />{t("Draw as diagram")}</h2>
    {done ? (
      <p role="status" className="mt-3 text-sm text-[var(--notion-muted)]">
        {t("The diagram is ready.")}
        {done.partial && <> {t("Part of the material was too long, so only the first part was drawn.")}</>}
      </p>
    ) : <>
      <p className="mt-3 text-sm text-[var(--notion-muted)]">{t("AI turns this into an editable diagram on a new whiteboard. This counts as 1 chat message.")}</p>
      {working && <p role="status" className="mt-3 flex items-start gap-2 text-sm text-[var(--notion-muted)]">
        <LoaderCircle size={16} className="mt-0.5 shrink-0 animate-spin" aria-hidden="true" />
        <span>{t("Drawing a diagram…")}</span>
      </p>}
    </>}
    {notice && <p role="alert" className="mt-2 text-sm text-[#b91c1c]">{t(notice)}</p>}
    {failed && <p role="alert" className="mt-2 text-sm text-[#b91c1c]">{localizeSystemText(failed.message, t)}</p>}
    {/* クリップボードに書けなかったときは、原文を選んでコピーできるように出す。 */}
    {source && copyFailed && <>
      <p role="alert" className="mt-2 text-sm text-[#b91c1c]">{t("Could not copy. Select the text and copy it instead.")}</p>
      <textarea readOnly value={source} aria-label={t("Copy diagram source")} className="notes-dialog-input h-32 resize-y font-mono"
        onFocus={(event) => event.currentTarget.select()} />
    </>}
    <span role="status" aria-live="polite" className="sr-only">{copied ? t("Copied") : ""}</span>
    <div className="mt-5 flex flex-wrap justify-end gap-2">
      <button type="button" className="notion-button" autoFocus={!failed && !(done && canOpen)} onClick={close}>{t("Close")}</button>
      {source && (
        <button type="button" className="notion-button inline-flex items-center gap-1" onClick={() => void copySource(source)}>
          {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}{copied ? t("Copied") : t("Copy diagram source")}
        </button>
      )}
      {failed && (
        <button type="button" autoFocus className="notion-button notion-button-primary" onClick={retry}>{t("Try again")}</button>
      )}
      {done && canOpen && (
        <button type="button" autoFocus className="notion-button notion-button-primary inline-flex items-center gap-1" onClick={() => openPage(done.page.id)}>
          {t("Open whiteboard")}<ArrowUpRight size={15} aria-hidden="true" />
        </button>
      )}
    </div>
  </dialog>;
}
