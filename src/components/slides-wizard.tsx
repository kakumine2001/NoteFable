"use client";

import {
  ArrowUpRight, ChevronDown, ChevronUp, FileText, Image as ImageIcon, LoaderCircle, MessageSquare, Plus, Presentation, Search, Trash2, X,
} from "lucide-react";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import "@/components/chat-project-settings.css";
import { GuestLimitPrompt, StorageLimitPrompt, UpgradePrompt } from "@/components/guest-limit-prompt";
import { useT } from "@/components/i18n-provider";
import { NoteIcon } from "@/components/note-icon";
import { PageKindIcon } from "@/components/page-kind-icon";
import { useAccount } from "@/lib/account-store";
import { LOCALE_NAMES, LOCALES } from "@/lib/i18n/locale";
import { localizeSystemText, msg, type Translate } from "@/lib/i18n/translate";
import { nativeCanOpenPage, nativeCanShowSlidesWizard, nativeCanShowStorageLimit, nativeCanShowUsageLimit, postToNative } from "@/lib/native-bridge";
import { pageKindOf } from "@/lib/page-kinds";
import {
  MAX_AUDIENCE_CHARS, MAX_OUTLINE_SLIDES, MAX_OUTLINE_TITLE_CHARS, MAX_PAGE_COUNT, MAX_POINT_CHARS, MAX_SLIDE_POINTS,
  MAX_SLIDE_TITLE_CHARS, MAX_SLIDES_SOURCE_NOTES, MAX_TOPIC_CHARS, MIN_PAGE_COUNT, SLIDES_TONES, SLIDES_WORDINGS,
  type SlidesOptions, type SlidesOutline, type SlidesTone, type SlidesWording,
} from "@/lib/slides/ai-wizard";
import { SLIDE_THEMES } from "@/lib/slides/themes";
import { newSlidesDraft, type SlidesDraft, type SlidesEntry, type WizardNote } from "@/lib/slides-wizard-draft";
import {
  getSlideImageJob, resumeSlideImageJob, stopSlideImageJob, subscribeSlideImageJobs, type SlideImageJob,
} from "@/lib/slides-image-jobs";
import {
  closeSlidesWizard, dismissSlidesError, getSlidesJobState, getSlidesWizard, isSlidesWizardBusy, requestSlides, retrySlidesWizardLoad,
  setSlidesPicker, SLIDES_FAILED, slidesRequestInput, slidesWizardBack, startOverSlides, subscribeSlidesWizard, syncSlidesNotes,
  updateSlidesDraft, workingSlidesNoteIds, type SlidesFlush, type SlidesJob, type SlidesWizardView,
} from "@/lib/slides-wizard-jobs";
import { useBackToClose } from "@/lib/use-back-to-close";

// 「AI でスライドを作る」の窓（docs/architecture/slides.md の「AI 生成幻灯片」）。状態と要求は src/lib/slides-wizard-jobs.ts、
// 下書きは src/lib/slides-wizard-draft.ts。手順は ①材料と設定 → ②編集できる大綱 → ③生成 → 「Open slides」。
// スライドができるまでページは作らない。web とアプリの WebView（/note-embed）で同じ部品を使い、パソコンは小窓、スマホは全画面。

// 一覧に出すノートの上限。多いときは絞り込みで探す（ノートの添付の窓と同じ）。
const MAX_LISTED = 100;

const TONE_LABELS: Record<SlidesTone, string> = {
  auto: msg("Auto"), professional: msg("Professional"), casual: msg("Casual"), academic: msg("Academic"), persuasive: msg("Persuasive"),
};
const WORDING_LABELS: Record<SlidesWording, string> = { condense: msg("Short bullet points"), keep: msg("Keep the original wording") };
const SOURCE_LABELS = { topic: msg("A topic"), notes: msg("Your notes"), chat: msg("This chat") };

// 入口（ノート・チャット・新規作成の場所）の要求の状態。メニューの項目が「作成中」を出すのに使う。
export function useSlidesJobState(key: string | null): SlidesJob["state"] {
  return useSyncExternalStore(subscribeSlidesWizard, () => (key ? getSlidesJobState(key) : "idle"), () => "idle");
}

// 画面に 1 つだけ置く。どの入口から開いても、ここに窓を出す。
// embedded: アプリの WebView（/note-embed）。窓が出た・消えたことをアプリに知らせ、「Open slides」はアプリにページを開いてもらう。
// flush: 材料のノートのうち開いているものの入力中の内容を、要求の前に保存する。
export function SlidesWizardHost({ embedded = false, flush }: { embedded?: boolean; flush?: SlidesFlush }) {
  const view = useSyncExternalStore(subscribeSlidesWizard, getSlidesWizard, () => null);
  const busy = useSyncExternalStore(subscribeSlidesWizard, isSlidesWizardBusy, () => false);
  const visible = view !== null;
  const reportedClosedBusy = useRef(false);
  useEffect(() => {
    if (!embedded || !visible || !nativeCanShowSlidesWizard()) return;
    reportedClosedBusy.current = false;
    postToNative({ type: "slidesWizard", state: "open" });
    return () => {
      const stillBusy = isSlidesWizardBusy();
      reportedClosedBusy.current = stillBusy;
      postToNative({ type: "slidesWizard", state: "closed", busy: stillBusy });
    };
  }, [embedded, visible]);
  // 作成中に閉じたあと、裏で動いていた要求が全部終わった（成功・失敗・アウトライン完了とも）らアプリに知らせる。
  useEffect(() => {
    if (!embedded || visible || busy || !reportedClosedBusy.current || !nativeCanShowSlidesWizard()) return;
    reportedClosedBusy.current = false;
    postToNative({ type: "slidesWizard", state: "closed", busy: false });
  }, [embedded, visible, busy]);
  // アプリのノートの「…」メニューが「Generating slides…」を出せるように、作っている最中のノートを知らせる（読み込み直しでは空を送る）。
  useEffect(() => {
    if (!embedded || !nativeCanShowSlidesWizard()) return;
    let reported = "";
    const report = () => {
      const pageIds = workingSlidesNoteIds();
      const next = JSON.stringify(pageIds);
      if (next === reported) return;
      reported = next;
      postToNative({ type: "slidesJobs", pageIds });
    };
    report();
    return subscribeSlidesWizard(report);
  }, [embedded]);
  if (!view) return null;
  return <SlidesWizardDialog key={view.key} view={view} embedded={embedded} flush={flush} />;
}

// いま出している面。面が替わるたびに主な操作へフォーカスを移す。
function screenOf(view: SlidesWizardView) {
  if (view.phase !== "ready") return view.phase;
  if (view.job.state === "done") return "done";
  if (view.job.state !== "idle" && view.job.stage === "deck") return view.job.state === "working" ? "writing" : "failed-deck";
  if (view.picker) return "picker";
  return view.draft.step;
}

function SlidesWizardDialog({ view, embedded, flush }: { view: SlidesWizardView; embedded: boolean; flush?: SlidesFlush }) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const ready = view.phase === "ready" ? view : null;
  const screen = screenOf(view);
  // 「戻る」と Esc は一番上の面から閉じる（ノートを選ぶ面、次に窓。下書きは残る）。
  useBackToClose(true, () => { closeSlidesWizard(); });
  useBackToClose(screen === "picker", () => { setSlidesPicker(false); });
  useEffect(() => { ref.current?.showModal(); }, []);
  // showModal() の後に、面ごとの主な操作へ。指で使う端末では、入力欄に合わせてキーボードを出さない。
  useEffect(() => {
    const target = ref.current?.querySelector<HTMLElement>("[data-autofocus]");
    if (!target || (target.tagName === "INPUT" && window.matchMedia("(pointer: coarse)").matches)) return;
    target.focus();
  }, [screen]);

  // 材料のノートの一覧。ノートを材料にする間だけ読む（本体は読まない）。
  const wantsNotes = ready?.draft.source.type === "notes";
  const [notes, setNotes] = useState<WizardNote[] | null>(null);
  const [notesError, setNotesError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!wantsNotes) return;
    const controller = new AbortController();
    void fetch("/api/pages", { signal: controller.signal, cache: "no-store" }).then(async (response) => {
      const data: unknown = await response.json().catch(() => null);
      const list = data && typeof data === "object" ? (data as { pages?: unknown }).pages : undefined;
      if (!response.ok || !Array.isArray(list)) throw new Error("list failed");
      const live = (list as (WizardNote & { kind?: unknown })[]).filter((page) => pageKindOf(page) === "note")
        .map((page) => ({ id: page.id, title: page.title, icon: page.icon ?? null }));
      setNotes(live);
      setNotesError("");
      syncSlidesNotes(live);
    }).catch(() => {
      if (!controller.signal.aborted) setNotesError(msg("Could not load your notes."));
    });
    return () => controller.abort();
  }, [wantsNotes, attempt]);

  // 使用回数の上限（429）・容量の上限（413）：ウェブではログイン（未ログイン）・アップグレード（無料会員）・容量の案内を窓の中に出す。
  // アプリの WebView では、案内を出せるアプリに任せる（ウェブのログイン画面や Stripe を WebView で開かない）。理由の文はどちらでも出す。
  const { account } = useAccount();
  const [closedLimit, setClosedLimit] = useState<SlidesJob | SlideImageJob | null>(null);
  const donePageId = ready?.job.state === "done" ? ready.job.page.id : null;
  const imageJob = useSyncExternalStore(subscribeSlideImageJobs, () => getSlideImageJob(donePageId), () => null);
  const failed = ready?.job.state === "error" ? ready.job : null;
  const limit = failed?.limit ?? null;
  const imageUsageLimit = imageJob?.usageLimit ?? null;
  const imageStorageLimit = imageJob?.storageLimit ?? null;
  const showGuestPrompt = !embedded && failed !== closedLimit && limit?.tier === "guest" && Boolean(account?.configured && !account.user);
  const showUpgradePrompt = !embedded && failed !== closedLimit && limit?.tier === "member" && Boolean(account?.billing && account.user);
  const showImageGuestPrompt = !embedded && imageJob !== closedLimit && imageUsageLimit?.tier === "guest" && Boolean(account?.configured && !account.user);
  const showImageUpgradePrompt = !embedded && imageJob !== closedLimit && imageUsageLimit?.tier === "member" && Boolean(account?.billing && account.user);
  const showImageStoragePrompt = imageJob !== closedLimit && Boolean(imageStorageLimit) && (!embedded || !nativeCanShowStorageLimit());
  useEffect(() => {
    if (!embedded || !limit || !nativeCanShowUsageLimit()) return;
    postToNative({ type: "usageLimit", tier: limit.tier, kind: "chat" });
  }, [embedded, limit]);
  useEffect(() => {
    if (!embedded || !imageUsageLimit || !nativeCanShowUsageLimit()) return;
    postToNative({ type: "usageLimit", tier: imageUsageLimit.tier, kind: "image" });
  }, [embedded, imageUsageLimit]);
  useEffect(() => {
    if (!embedded || !imageStorageLimit || !nativeCanShowStorageLimit()) return;
    postToNative({ type: "storageLimit", tier: imageStorageLimit.tier, used: imageStorageLimit.used, limit: imageStorageLimit.limit });
  }, [embedded, imageStorageLimit]);
  const prompts = <>
    {showGuestPrompt && <div className="mt-3"><GuestLimitPrompt kind="chat" onClose={() => setClosedLimit(failed)} /></div>}
    {showUpgradePrompt && <div className="mt-3"><UpgradePrompt kind="chat" onClose={() => setClosedLimit(failed)} /></div>}
  </>;
  const imagePrompts = <>
    {showImageGuestPrompt && <div className="mt-3"><GuestLimitPrompt kind="image" onClose={() => setClosedLimit(imageJob)} /></div>}
    {showImageUpgradePrompt && <div className="mt-3"><UpgradePrompt kind="image" onClose={() => setClosedLimit(imageJob)} /></div>}
    {showImageStoragePrompt && imageStorageLimit && (
      <div className="mt-3"><StorageLimitPrompt limit={imageStorageLimit} actions={!embedded} className="" onClose={() => setClosedLimit(imageJob)} /></div>
    )}
  </>;

  // アプリの中では、ページを開けるアプリにだけ「開く」を出す（開けない古いアプリでは、出来たことだけを知らせる）。
  const canOpen = !embedded || nativeCanOpenPage();
  // 先に開く（窓が積んだ履歴の目印をページの URL に置き換える。アプリには窓を閉じる知らせより先に届く）、それから閉じる。
  function openPage(id: string) {
    if (embedded) postToNative({ type: "openPage", id });
    else window.dispatchEvent(new CustomEvent("notefable:open-note", { detail: { id } }));
    closeSlidesWizard();
  }

  const body = !ready ? (
    <>
      <div className="slides-wizard-body">
        {view.phase === "loading"
          ? <Progress text={t("Loading…")} />
          : <p role="alert" className="text-sm text-[#b91c1c]">{t(SLIDES_FAILED)}</p>}
      </div>
      {view.phase === "failed" && <div className="slides-wizard-footer">
        <button type="button" data-autofocus className="notion-button notion-button-primary" onClick={retrySlidesWizardLoad}>{t("Try again")}</button>
      </div>}
    </>
  ) : screen === "done" && ready.job.state === "done" ? (
    <>
      <div className="slides-wizard-body">
        <p role="status" className="text-sm text-[var(--notion-muted)]">
          {t("Created “{title}” in Workspace.", { title: ready.job.page.title })}
          {ready.job.partial && <> {t("Part of the content was too long and was left out.")}</>}
        </p>
        {imageJob && imageJob.status === "working" && (
          <div className="slides-wizard-image-progress">
            <Progress text={t("Generating slide images… ({done}/{total})", { done: imageJob.completed, total: imageJob.total })} />
            {imageJob.currentSlideTitle && (
              <p className="mt-1 text-xs text-[var(--notion-muted)]">{t("Current slide: {title}", { title: imageJob.currentSlideTitle })}</p>
            )}
            <div className="slides-wizard-progress-track" aria-hidden="true">
              <div className="slides-wizard-progress-fill" style={{ width: `${imageJob.total ? Math.round((imageJob.completed / imageJob.total) * 100) : 0}%` }} />
            </div>
          </div>
        )}
        {imageJob && imageJob.status === "done" && imageJob.total > 0 && (
          <p role="status" className="mt-3 flex items-center gap-2 text-sm text-[var(--notion-muted)]">
            <ImageIcon size={15} aria-hidden="true" />
            <span>{t("Generated {total} slide images.", { total: imageJob.completed })}</span>
          </p>
        )}
        {imageJob && (imageJob.status === "stopped" || imageJob.status === "error") && (
          <div className="slides-wizard-image-progress">
            <p role="status" className="text-sm text-[var(--notion-muted)]">
              {t("Generated {done} of {total} slide images. {remaining} remaining.", { done: imageJob.completed, total: imageJob.total, remaining: imageJob.remaining })}
            </p>
            {imageJob.error && <p role="alert" className="mt-2 text-sm text-[#b91c1c]">{localizeSystemText(imageJob.error, t)}</p>}
            {imagePrompts}
          </div>
        )}
      </div>
      <div className="slides-wizard-footer">
        {imageJob?.status === "working" && donePageId && (
          <button type="button" className="notion-button slides-wizard-reset" disabled={Boolean(imageJob.stopping)} onClick={() => stopSlideImageJob(donePageId)}>
            {imageJob.stopping ? t("Stopping after this slide…") : t("Stop")}
          </button>
        )}
        {imageJob && (imageJob.status === "stopped" || imageJob.status === "error") && imageJob.remaining > 0 && donePageId && (
          <button type="button" className="notion-button slides-wizard-reset" onClick={() => void resumeSlideImageJob(donePageId)}>{t("Resume")}</button>
        )}
        <button type="button" data-autofocus={canOpen ? undefined : true} className="notion-button" onClick={() => closeSlidesWizard()}>{t("Close")}</button>
        {canOpen && <OpenButton id={ready.job.page.id} label={t("Open slides")} onOpen={openPage} />}
      </div>
    </>
  ) : screen === "writing" ? (
    <>
      <div className="slides-wizard-body">
        <Progress text={t("Writing the slides… This can take a few minutes. You can close this window; the slides will appear in Workspace when they’re ready.")} />
      </div>
      <div className="slides-wizard-footer">
        <button type="button" data-autofocus className="notion-button" onClick={() => closeSlidesWizard()}>{t("Close")}</button>
      </div>
    </>
  ) : screen === "failed-deck" ? (
    <>
      <div className="slides-wizard-body">
        {failed && <p role="alert" className="text-sm text-[#b91c1c]">{localizeSystemText(failed.message, t)}</p>}
        {prompts}
      </div>
      <div className="slides-wizard-footer">
        <button type="button" className="notion-button" onClick={dismissSlidesError}>{t("Back")}</button>
        <button type="button" data-autofocus className="notion-button notion-button-primary" onClick={() => void requestSlides("deck", { flush })}>{t("Try again")}</button>
      </div>
    </>
  ) : screen === "picker" ? (
    <NotePicker draft={ready.draft} entry={ready.entry} notes={notes} error={notesError} onRetry={() => { setNotesError(""); setAttempt((count) => count + 1); }} />
  ) : screen === "outline" && ready.draft.outline ? (
    <OutlineStep draft={ready.draft} outline={ready.draft.outline} entry={ready.entry} job={ready.job} flush={flush} prompts={prompts} />
  ) : (
    <SourceStep draft={ready.draft} entry={ready.entry} job={ready.job} flush={flush} prompts={prompts} />
  );

  return <dialog ref={ref} aria-labelledby={titleId} className="notes-dialog slides-wizard" translate="no"
    onCancel={(event) => { event.preventDefault(); slidesWizardBack(); }}
    onClick={(event) => { if (event.target === event.currentTarget) { const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) closeSlidesWizard(); } }}>
    <div className="slides-wizard-header">
      <h2 id={titleId} className="flex min-w-0 items-center gap-2 text-base font-semibold">
        <Presentation size={18} aria-hidden="true" />{screen === "picker" ? t("Choose notes") : t("Generate slides")}
      </h2>
      <button type="button" className="notion-icon-button grid" aria-label={t("Close")} title={t("Close")} onClick={() => closeSlidesWizard()}><X size={17} /></button>
    </div>
    {body}
  </dialog>;
}

function OpenButton({ id, label, onOpen }: { id: string; label: string; onOpen: (id: string) => void }) {
  return <button type="button" data-autofocus className="notion-button notion-button-primary inline-flex items-center gap-1" onClick={() => onOpen(id)}>
    {label}<ArrowUpRight size={15} aria-hidden="true" />
  </button>;
}

function Progress({ text }: { text: string }) {
  return <p role="status" className="flex items-start gap-2 text-sm text-[var(--notion-muted)]">
    <LoaderCircle size={16} className="mt-0.5 shrink-0 animate-spin" aria-hidden="true" /><span>{text}</span>
  </p>;
}

// 下書きに何か入っているか（「Start over」を出す）。
function hasContent(draft: SlidesDraft, entry: SlidesEntry) {
  const fresh = newSlidesDraft(entry);
  return Boolean(draft.outline) || draft.source.topic !== "" || draft.source.notes.length > fresh.source.notes.length
    || JSON.stringify(draft.options) !== JSON.stringify(fresh.options);
}

type StepProps = { draft: SlidesDraft; entry: SlidesEntry; job: SlidesJob; flush?: SlidesFlush; prompts: ReactNode };

// 大綱の要求の失敗。retry は大綱の面（作り直し）だけが出す。最初の面は下の「Create outline」がそのまま送り直しになる。
function OutlineError({ job, flush, retry, t }: { job: SlidesJob; flush?: SlidesFlush; retry: boolean; t: Translate }) {
  if (job.state !== "error") return null;
  return <div className="mt-3 flex flex-wrap items-center gap-2">
    <p role="alert" className="min-w-0 flex-1 text-sm text-[#b91c1c]">{localizeSystemText(job.message, t)}</p>
    {retry && <button type="button" className="notion-button" onClick={() => void requestSlides("outline", { flush })}>{t("Try again")}</button>}
  </div>;
}

function setOptions(patch: Partial<SlidesOptions>) {
  updateSlidesDraft((draft) => ({ ...draft, options: { ...draft.options, ...patch } }));
}

function removeNote(id: string) {
  updateSlidesDraft((draft) => ({ ...draft, source: { ...draft.source, notes: draft.source.notes.filter((note) => note.id !== id) } }));
}

// ① 材料と設定。
function SourceStep({ draft, entry, job, flush, prompts }: StepProps) {
  const t = useT();
  const id = useId();
  const working = job.state === "working";
  const { source, options } = draft;
  const ready = slidesRequestInput("outline", draft, entry) !== null;
  const submit = () => { if (ready && !working) void requestSlides("outline", { flush }); };
  return <>
    <div className="slides-wizard-body">
      <fieldset disabled={working} className="slides-wizard-fields">
        <div className="slides-wizard-field">
          <span id={`${id}-source`} className="slides-wizard-label">{t("Make slides from")}</span>
          {entry.type === "new" && <div className="ws-filter-bar mt-1.5" role="group" aria-labelledby={`${id}-source`}>
            {(["topic", "notes"] as const).map((type) => <button key={type} type="button" aria-pressed={source.type === type}
              className={`ws-filter-pill${source.type === type ? " is-active" : ""}`}
              onClick={() => updateSlidesDraft((current) => ({ ...current, source: { ...current.source, type } }))}>{t(SOURCE_LABELS[type])}</button>)}
          </div>}
          {source.type === "chat" && <p className="slides-wizard-chat">
            <MessageSquare size={15} aria-hidden="true" /><span>{source.chat?.title || t(SOURCE_LABELS.chat)}</span>
          </p>}
          {source.type === "topic" && <input data-autofocus className="notes-dialog-input" value={source.topic} maxLength={MAX_TOPIC_CHARS} aria-label={t("Topic")}
            placeholder={t("What should the slides be about?")}
            onChange={(event) => { const topic = event.target.value; updateSlidesDraft((current) => ({ ...current, source: { ...current.source, topic } })); }}
            onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); } }} />}
          {source.type === "notes" && <>
            {source.notes.length > 0 && <ul className="project-settings-chips" aria-label={t("Selected notes")}>
              {source.notes.map((note) => <li key={note.id} className="project-settings-chip">
                <NoteIcon icon={note.icon} fallback={<FileText size={13} aria-hidden="true" />} />
                <span className="project-settings-chip-title">{note.title || t("Untitled")}</span>
                {/* ノートから開いた窓では、そのノートは外せない。 */}
                {entry.type === "note" && entry.pageId === note.id ? <span aria-hidden="true" className="w-1" />
                  : <button type="button" aria-label={t("Remove {title}", { title: note.title || t("Untitled") })} onClick={() => removeNote(note.id)}><X size={12} aria-hidden="true" /></button>}
              </li>)}
            </ul>}
            <button type="button" className="ws-util-pill mt-2" aria-haspopup="dialog" onClick={() => setSlidesPicker(true)}>
              <Plus size={14} aria-hidden="true" /><span>{t("Choose notes")}</span>
            </button>
          </>}
        </div>

        <div className="slides-wizard-grid">
          <label className="slides-wizard-field">
            <span className="slides-wizard-label">{t("Number of slides")}</span>
            <select className="notes-dialog-input" value={String(options.pageCount)}
              onChange={(event) => setOptions({ pageCount: event.target.value === "auto" ? "auto" : Number(event.target.value) })}>
              <option value="auto">{t("Auto")}</option>
              {Array.from({ length: MAX_PAGE_COUNT - MIN_PAGE_COUNT + 1 }, (_, index) => index + MIN_PAGE_COUNT).map((count) => (
                <option key={count} value={count}>{t("{count} slides", { count })}</option>
              ))}
            </select>
          </label>
          <label className="slides-wizard-field">
            <span className="slides-wizard-label">{t("Tone")}</span>
            <select className="notes-dialog-input" value={options.tone} onChange={(event) => setOptions({ tone: event.target.value as SlidesTone })}>
              {SLIDES_TONES.map((tone) => <option key={tone} value={tone}>{t(TONE_LABELS[tone])}</option>)}
            </select>
          </label>
          <label className="slides-wizard-field">
            <span className="slides-wizard-label">{t("Slide language")}</span>
            <select className="notes-dialog-input" value={options.language}
              onChange={(event) => setOptions({ language: event.target.value as SlidesOptions["language"] })}>
              <option value="auto">{t("Same as the material")}</option>
              {LOCALES.map((locale) => <option key={locale} value={locale} lang={locale}>{LOCALE_NAMES[locale]}</option>)}
            </select>
          </label>
          <label className="slides-wizard-field">
            <span className="slides-wizard-label">{t("Wording")}</span>
            <select className="notes-dialog-input" value={options.wording} onChange={(event) => setOptions({ wording: event.target.value as SlidesWording })}>
              {SLIDES_WORDINGS.map((wording) => <option key={wording} value={wording}>{t(WORDING_LABELS[wording])}</option>)}
            </select>
          </label>
        </div>
        <label className="slides-wizard-field">
          <span className="slides-wizard-label">{t("Audience")}</span>
          <input className="notes-dialog-input" value={options.audience} maxLength={MAX_AUDIENCE_CHARS} placeholder={t("Who is it for?")}
            onChange={(event) => setOptions({ audience: event.target.value })}
            onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); } }} />
        </label>

        <div className="slides-wizard-toggle-card">
          <label className="slides-wizard-toggle">
            <input type="checkbox" checked={options.generateImages === true}
              onChange={(event) => setOptions({ generateImages: event.target.checked })} />
            <span className="slides-wizard-toggle-text">
              <span className="slides-wizard-toggle-title">{t("Generate images for slides")}</span>
              {options.generateImages === true && (
                <span className="slides-wizard-toggle-hint">
                  {t("Adds AI illustrations to key slides. Uses 1 image credit per illustrated slide (up to {count} image credits).", {
                    count: options.pageCount === "auto" ? MAX_OUTLINE_SLIDES : options.pageCount - 1,
                  })}
                </span>
              )}
            </span>
          </label>
        </div>

        <details className="slides-wizard-advanced">
          <summary>{t("Advanced")}</summary>
          <div className="slides-wizard-grid">
            <label className="slides-wizard-field">
              <span className="slides-wizard-label">{t("Theme")}</span>
              <select className="notes-dialog-input" value={options.theme.id} onChange={(event) => setOptions({ theme: { ...options.theme, id: event.target.value } })}>
                {SLIDE_THEMES.map((theme) => <option key={theme.id} value={theme.id}>{t(theme.name)}</option>)}
              </select>
            </label>
            <label className="slides-wizard-field">
              <span className="slides-wizard-label">{t("Appearance")}</span>
              <select className="notes-dialog-input" value={options.theme.mode}
                onChange={(event) => setOptions({ theme: { ...options.theme, mode: event.target.value === "dark" ? "dark" : "light" } })}>
                <option value="light">{t("Light")}</option>
                <option value="dark">{t("Dark")}</option>
              </select>
            </label>
          </div>
        </details>
      </fieldset>
      {working && <div className="mt-3"><Progress text={t("Writing the outline…")} /></div>}
      <OutlineError job={job} flush={flush} retry={false} t={t} />
      {prompts}
    </div>
    <div className="slides-wizard-footer">
      <p className="slides-wizard-note">{t("This counts as 1 chat message.")}</p>
      {hasContent(draft, entry) && <button type="button" className="notion-button slides-wizard-reset" disabled={working} onClick={startOverSlides}>{t("Start over")}</button>}
      {draft.outline && <button type="button" className="notion-button" disabled={working}
        onClick={() => updateSlidesDraft((current) => ({ ...current, step: "outline" }))}>{t("Back to outline")}</button>}
      <button type="button" data-autofocus={source.type === "topic" ? undefined : true} className="notion-button notion-button-primary" disabled={!ready || working} onClick={submit}>
        {t("Create outline")}
      </button>
    </div>
  </>;
}

function setOutline(change: (outline: SlidesOutline) => SlidesOutline) {
  updateSlidesDraft((draft) => (draft.outline ? { ...draft, outline: change(draft.outline) } : draft));
}

function setSlide(index: number, change: (slide: SlidesOutline["slides"][number]) => SlidesOutline["slides"][number]) {
  setOutline((outline) => ({ ...outline, slides: outline.slides.map((slide, at) => (at === index ? change(slide) : slide)) }));
}

function moveSlide(index: number, to: number) {
  setOutline((outline) => {
    if (to < 0 || to >= outline.slides.length) return outline;
    const slides = [...outline.slides];
    [slides[index], slides[to]] = [slides[to], slides[index]];
    return { ...outline, slides };
  });
}

// ② 大綱。表紙は題名から作るので、中身のスライドは 2 枚目から数える。
function OutlineStep({ draft, outline, entry, job, flush, prompts }: StepProps & { outline: SlidesOutline }) {
  const t = useT();
  const listRef = useRef<HTMLOListElement>(null);
  const working = job.state === "working";
  const ready = slidesRequestInput("deck", draft, entry) !== null;
  // 動かしたスライドの同じ向きのボタンへフォーカスを移す（端まで来たら反対向き）。
  function move(index: number, step: -1 | 1) {
    const to = index + step;
    moveSlide(index, to);
    requestAnimationFrame(() => {
      const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>(`[data-move^="${to}:"]`);
      const same = listRef.current?.querySelector<HTMLButtonElement>(`[data-move="${to}:${step}"]`);
      (same && !same.disabled ? same : Array.from(buttons ?? []).find((button) => !button.disabled))?.focus();
    });
  }
  return <>
    <div className="slides-wizard-body">
      <p className="text-sm text-[var(--notion-muted)]">{t("Review the outline, then generate the slides.")}</p>
      {draft.partial && <p className="mt-1 text-sm text-[var(--notion-muted)]">{t("Part of the material was too long, so only the first part was used.")}</p>}
      {working && <div className="mt-3"><Progress text={t("Writing the outline…")} /></div>}
      <OutlineError job={job} flush={flush} retry t={t} />
      {prompts}
      <fieldset disabled={working} className="slides-wizard-fields slides-wizard-outline">
        <label className="slides-wizard-field">
          <span className="slides-wizard-label">{t("Title slide")}</span>
          <input className="notes-dialog-input" dir="auto" value={outline.title} maxLength={MAX_OUTLINE_TITLE_CHARS} aria-invalid={!outline.title.trim() || undefined}
            onChange={(event) => { const title = event.target.value; setOutline((current) => ({ ...current, title })); }} />
        </label>
        <ol ref={listRef} className="slides-wizard-slides">
          {outline.slides.map((slide, index) => {
            const number = index + 2;
            return <li key={index} className="slides-wizard-slide">
              <div className="slides-wizard-slide-head">
                <span className="slides-wizard-label">{t("Slide {number}", { number })}</span>
                <button type="button" data-move={`${index}:-1`} className="notion-icon-button grid" disabled={index === 0} aria-label={t("Move up")} title={t("Move up")}
                  onClick={() => move(index, -1)}><ChevronUp size={15} /></button>
                <button type="button" data-move={`${index}:1`} className="notion-icon-button grid" disabled={index === outline.slides.length - 1} aria-label={t("Move down")} title={t("Move down")}
                  onClick={() => move(index, 1)}><ChevronDown size={15} /></button>
                <button type="button" className="notion-icon-button grid" disabled={outline.slides.length === 1} aria-label={t("Delete slide")} title={t("Delete slide")}
                  onClick={() => setOutline((current) => ({ ...current, slides: current.slides.filter((_, at) => at !== index) }))}><Trash2 size={15} /></button>
              </div>
              <input className="notes-dialog-input slides-wizard-slide-title" dir="auto" value={slide.title} maxLength={MAX_SLIDE_TITLE_CHARS}
                aria-label={t("Slide title")} placeholder={t("Slide title")} aria-invalid={!slide.title.trim() || undefined}
                onChange={(event) => { const title = event.target.value; setSlide(index, (current) => ({ ...current, title })); }} />
              {slide.points.length > 0 && <ul className="slides-wizard-points">
                {slide.points.map((point, at) => <li key={at}>
                  <input className="notes-dialog-input" dir="auto" value={point} maxLength={MAX_POINT_CHARS} aria-label={t("Point {number}", { number: at + 1 })}
                    onChange={(event) => { const value = event.target.value; setSlide(index, (current) => ({ ...current, points: current.points.map((item, i) => (i === at ? value : item)) })); }} />
                  <button type="button" className="notion-icon-button grid" aria-label={t("Delete point")} title={t("Delete point")}
                    onClick={() => setSlide(index, (current) => ({ ...current, points: current.points.filter((_, i) => i !== at) }))}><X size={14} /></button>
                </li>)}
              </ul>}
              <button type="button" className="slides-wizard-add" disabled={slide.points.length >= MAX_SLIDE_POINTS}
                onClick={() => setSlide(index, (current) => ({ ...current, points: [...current.points, ""] }))}>
                <Plus size={13} aria-hidden="true" />{t("Add point")}
              </button>
            </li>;
          })}
        </ol>
        <button type="button" className="ws-util-pill" disabled={outline.slides.length >= MAX_OUTLINE_SLIDES}
          onClick={() => setOutline((current) => ({ ...current, slides: [...current.slides, { title: "", points: [] }] }))}>
          <Presentation size={14} aria-hidden="true" /><span>{t("Add slide")}</span>
        </button>
        <div className="slides-wizard-toggle-card">
          <label className="slides-wizard-toggle">
            <input type="checkbox" checked={draft.options.generateImages === true}
              onChange={(event) => setOptions({ generateImages: event.target.checked })} />
            <span className="slides-wizard-toggle-text">
              <span className="slides-wizard-toggle-title">{t("Generate images for slides")}</span>
              {draft.options.generateImages === true && (
                <span className="slides-wizard-toggle-hint">
                  {t("Adds AI illustrations to key slides. Uses 1 image credit per illustrated slide (up to {count} image credits).", {
                    count: outline.slides.length,
                  })}
                </span>
              )}
            </span>
          </label>
        </div>
      </fieldset>
    </div>
    <div className="slides-wizard-footer">
      <p className="slides-wizard-note">
        {!ready
          ? t("Give the title slide and every slide a title.")
          : draft.options.generateImages === true
            ? t("This counts as 1 chat message, plus up to {count} image credits.", { count: outline.slides.length })
            : t("This counts as 1 chat message.")}
      </p>
      <button type="button" className="notion-button slides-wizard-reset" disabled={working} onClick={startOverSlides}>{t("Start over")}</button>
      <button type="button" className="notion-button" disabled={working}
        onClick={() => updateSlidesDraft((current) => ({ ...current, step: "source" }))}>{t("Back")}</button>
      <button type="button" className="notion-button" disabled={working || slidesRequestInput("outline", draft, entry) === null}
        onClick={() => void requestSlides("outline", { flush, fresh: true })}>{t("Regenerate outline")}</button>
      <button type="button" data-autofocus className="notion-button notion-button-primary" disabled={!ready || working}
        onClick={() => void requestSlides("deck", { flush })}>{t("Generate slides")}</button>
    </div>
  </>;
}

// 材料のノートを選ぶ面（5 件まで）。
function NotePicker({ draft, entry, notes, error, onRetry }: { draft: SlidesDraft; entry: SlidesEntry; notes: WizardNote[] | null; error: string; onRetry: () => void }) {
  const t = useT();
  const [filter, setFilter] = useState("");
  const selected = draft.source.notes;
  const selectedIds = new Set(selected.map((note) => note.id));
  const full = selected.length >= MAX_SLIDES_SOURCE_NOTES;
  const query = filter.trim().toLowerCase();
  const listed = (notes ?? []).filter((note) => !query || (note.title || t("Untitled")).toLowerCase().includes(query));
  function toggle(note: WizardNote) {
    updateSlidesDraft((current) => {
      const chosen = current.source.notes;
      const next = chosen.some((item) => item.id === note.id) ? chosen.filter((item) => item.id !== note.id)
        : chosen.length >= MAX_SLIDES_SOURCE_NOTES ? chosen : [...chosen, note];
      return { ...current, source: { ...current.source, notes: next } };
    });
  }
  return <>
    <div className="slides-wizard-body">
      <p className="project-settings-label">{t("Your notes")}<span className={`project-settings-count${full ? " is-full" : ""}`} aria-live="polite">{selected.length}/{MAX_SLIDES_SOURCE_NOTES}</span></p>
      {!notes && !error && <p className="project-settings-empty" role="status"><LoaderCircle size={14} className="mr-1 inline animate-spin" aria-hidden="true" />{t("Loading…")}</p>}
      {error && <>
        <p role="alert" className="project-settings-error">{t(error)}</p>
        <button type="button" className="notion-button mt-2" onClick={onRetry}>{t("Try again")}</button>
      </>}
      {notes && <>
        <label className="project-settings-search">
          <Search size={14} aria-hidden="true" />
          <input type="search" data-autofocus value={filter} placeholder={t("Filter your notes")} aria-label={t("Filter your notes")} onChange={(event) => setFilter(event.target.value)} />
        </label>
        {listed.length > 0 && <ul className="project-settings-list slides-wizard-notes" aria-label={t("Your notes")}>
          {listed.slice(0, MAX_LISTED).map((note) => {
            const checked = selectedIds.has(note.id);
            const fixed = entry.type === "note" && entry.pageId === note.id;
            const blocked = fixed || (!checked && full);
            return <li key={note.id}>
              <label className={`project-settings-option${checked ? " is-selected" : ""}${blocked ? " is-disabled" : ""}`}>
                <input type="checkbox" checked={checked} disabled={blocked} onChange={() => toggle(note)} />
                <span className="project-settings-note-icon" aria-hidden="true"><NoteIcon icon={note.icon} fallback={<PageKindIcon kind="note" size={14} />} /></span>
                <span className="project-settings-note-title">{note.title || t("Untitled")}</span>
              </label>
            </li>;
          })}
        </ul>}
        {!listed.length && <p className="project-settings-empty">{notes.length ? t("No notes match.") : t("You don’t have any notes yet.")}</p>}
        {listed.length > MAX_LISTED && <p className="project-settings-empty">{t("Showing the first {count} notes. Type in the filter to find others.", { count: MAX_LISTED })}</p>}
        {full && <p className="project-settings-empty">{t("You can choose up to {count} notes. Remove one to pick another.", { count: MAX_SLIDES_SOURCE_NOTES })}</p>}
      </>}
    </div>
    <div className="slides-wizard-footer">
      <button type="button" className="notion-button notion-button-primary" onClick={() => setSlidesPicker(false)}>{t("Done")}</button>
    </div>
  </>;
}
