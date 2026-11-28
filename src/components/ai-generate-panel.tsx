"use client";

import {
  ArrowLeft,
  ArrowUp,
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  FileText,
  Image as ImageIcon,
  LoaderCircle,
  Plus,
  Presentation,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import "@/components/chat-project-settings.css";
import { AppIcon } from "@/components/app-icon";
import { GuestLimitPrompt, StorageLimitPrompt, UpgradePrompt } from "@/components/guest-limit-prompt";
import { useT } from "@/components/i18n-provider";
import { NoteIcon } from "@/components/note-icon";
import { PageKindIcon } from "@/components/page-kind-icon";
import { useAccount } from "@/lib/account-store";
import {
  AI_GENERATE_KINDS,
  MAX_AI_PROMPT_CHARS,
  MAX_AI_SOURCE_NOTES,
  NOTE_GENERATE_STYLES,
  WHITEBOARD_GENERATE_STRUCTURES,
  type AiGenerateKind,
  type NoteGenerateStyle,
  type WhiteboardGenerateStructure,
} from "@/lib/ai-generate";
import { newAiGenerateDraft, type AiGenerateDraft } from "@/lib/ai-generate-draft";
import {
  AI_GENERATE_NOTE_FAILED,
  aiGenerateBack,
  canSubmitAiGenerate,
  canSubmitSlidesDeck,
  canSubmitSlidesOutline,
  closeAiGenerate,
  dismissAiGenerateError,
  getAiGenerate,
  isAiGenerateBusy,
  retryAiGenerateLoad,
  saveAiGenerateLimitDraft,
  setAiGeneratePicker,
  startOverAiGenerate,
  submitAiGenerate,
  subscribeAiGenerate,
  syncAiGenerateNotes,
  updateAiGenerateDraft,
  type AiGenerateJob,
  type AiGenerateView,
} from "@/lib/ai-generate-jobs";
import type { CharacterState } from "@/lib/characters";
import { LOCALE_NAMES, LOCALES, type Locale } from "@/lib/i18n/locale";
import { localizeSystemText, msg, type Translate } from "@/lib/i18n/translate";
import {
  nativeCanOpenPage,
  nativeCanShowAiGenerate,
  nativeCanShowStorageLimit,
  nativeCanShowUsageLimit,
  postToNative,
} from "@/lib/native-bridge";
import { PAGE_KIND_LABELS, pageKindOf, type PageKind } from "@/lib/page-kinds";
import {
  MAX_AUDIENCE_CHARS,
  MAX_OUTLINE_SLIDES,
  MAX_OUTLINE_TITLE_CHARS,
  MAX_PAGE_COUNT,
  MAX_POINT_CHARS,
  MAX_SLIDE_POINTS,
  MAX_SLIDE_TITLE_CHARS,
  MIN_PAGE_COUNT,
  SLIDES_TONES,
  SLIDES_WORDINGS,
  type SlidesOptions,
  type SlidesOutline,
  type SlidesTone,
  type SlidesWording,
} from "@/lib/slides/ai-wizard";
import { SLIDE_THEMES } from "@/lib/slides/themes";
import {
  getSlideImageJob,
  resumeSlideImageJob,
  stopSlideImageJob,
  subscribeSlideImageJobs,
  type SlideImageJob,
} from "@/lib/slides-image-jobs";
import type { WizardNote } from "@/lib/slides-wizard-draft";
import type { SlidesFlush } from "@/lib/slides-wizard-jobs";
import { useBackToClose } from "@/lib/use-back-to-close";

// ワークスペースの統合「AI で生成」スタジオパネル（ノート・ホワイトボード・スライド）とホームの統合入力バー。
// 順序は常に新しい順（ノート → ホワイトボード → スライド）。Sparkles アイコンは使わず、マスコットと種別アイコンで表現する。

const MAX_LISTED_NOTES = 100;

const KIND_SUBTITLES: Record<AiGenerateKind, string> = {
  note: msg("Structured document"),
  whiteboard: msg("Editable mind map or diagram"),
  slides: msg("Outline and slide deck"),
};

const KIND_PLACEHOLDERS: Record<AiGenerateKind, string> = {
  note: msg("What should the note cover? Write a topic, outline, or instructions…"),
  whiteboard: msg("What should the whiteboard map out? Write a topic, process, or structure…"),
  slides: msg("What should the slides be about? Write a topic or key instructions…"),
};

const NOTE_STYLE_LABELS: Record<NoteGenerateStyle, string> = {
  auto: msg("Auto"),
  "study-guide": msg("Study guide"),
  outline: msg("Outline"),
  summary: msg("Summary"),
  checklist: msg("Checklist"),
};

const WHITEBOARD_STRUCTURE_LABELS: Record<WhiteboardGenerateStructure, string> = {
  auto: msg("Auto (mind map)"),
  mindmap: msg("Mind map"),
  flowchart: msg("Flowchart"),
  sequence: msg("Sequence diagram"),
  timeline: msg("Timeline"),
  board: msg("Sticky-note board"),
};

const TONE_LABELS: Record<SlidesTone, string> = {
  auto: msg("Auto"),
  professional: msg("Professional"),
  casual: msg("Casual"),
  academic: msg("Academic"),
  persuasive: msg("Persuasive"),
};

const WORDING_LABELS: Record<SlidesWording, string> = {
  condense: msg("Short bullet points"),
  keep: msg("Keep the original wording"),
};

function orderedCreatableKinds(kinds?: readonly PageKind[]): AiGenerateKind[] {
  if (!kinds?.length) return [...AI_GENERATE_KINDS];
  const allowed = new Set<PageKind>(kinds);
  const ordered = AI_GENERATE_KINDS.filter((kind) => allowed.has(kind));
  return ordered.length ? ordered : ["note"];
}

// ---- ワークスペースホーム / 空状態の統合エントリー ----

export function WorkspaceAiEntry({
  kinds,
  activeFilter,
  busy,
  onOpen,
}: {
  kinds: readonly PageKind[];
  activeFilter?: PageKind | null;
  busy?: boolean;
  onOpen: (opts: { kind: AiGenerateKind; prompt?: string; autoStart?: boolean }) => void;
}) {
  const t = useT();
  const available = orderedCreatableKinds(kinds);
  const [selectedKind, setSelectedKind] = useState<AiGenerateKind>(() =>
    activeFilter && available.includes(activeFilter) ? activeFilter : available[0],
  );
  const [prompt, setPrompt] = useState("");
  const lastFilterRef = useRef<PageKind | null | undefined>(activeFilter);

  // ワークスペースの種別フィルタータブが切り替わったら、生成種別も同期する。
  useEffect(() => {
    if (lastFilterRef.current === activeFilter) return;
    lastFilterRef.current = activeFilter;
    if (activeFilter && available.includes(activeFilter)) {
      queueMicrotask(() => setSelectedKind(activeFilter));
    }
  }, [activeFilter, available]);

  const effectiveKind = available.includes(selectedKind) ? selectedKind : available[0];
  const hasPrompt = prompt.trim().length > 0;

  function launch(autoStart: boolean) {
    if (busy) return;
    const text = prompt.trim();
    if (autoStart && text) {
      setPrompt("");
      onOpen({ kind: effectiveKind, prompt: text, autoStart: true });
      return;
    }
    onOpen({ kind: effectiveKind, prompt: text || undefined, autoStart: false });
  }

  return (
    <section className={`ws-ai-studio is-${effectiveKind}`} aria-label={t("Generate with AI")}>
      <div className="ws-ai-studio-input-row">
        <span className="ws-ai-studio-mascot" aria-hidden="true">
          <AppIcon size={32} animated state={hasPrompt ? "typing" : "idle"} />
        </span>
        <textarea
          className="ws-ai-studio-textarea"
          dir="auto"
          rows={2}
          maxLength={MAX_AI_PROMPT_CHARS}
          disabled={busy}
          value={prompt}
          aria-label={t("Generate with AI")}
          placeholder={t("Ask AI to create a note, whiteboard, or slide deck…")}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              if (!hasPrompt) return;
              event.preventDefault();
              launch(true);
            }
          }}
        />
      </div>
      <div className="ws-ai-studio-footer">
        <div className="ws-ai-studio-kinds" role="radiogroup" aria-label={t("Page type")}>
          {available.map((kind) => {
            const active = effectiveKind === kind;
            return (
              <button
                key={kind}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={busy}
                className={`ws-ai-kind-pill is-${kind}${active ? " is-active" : ""}`}
                onClick={() => setSelectedKind(kind)}
              >
                <PageKindIcon kind={kind} size={13.5} aria-hidden="true" />
                <span>{t(PAGE_KIND_LABELS[kind])}</span>
              </button>
            );
          })}
        </div>
        <div className="ws-ai-studio-actions">
          <button
            type="button"
            className="ws-ai-options-btn"
            disabled={busy}
            aria-haspopup="dialog"
            onClick={() => launch(false)}
          >
            <SlidersHorizontal size={13.5} aria-hidden="true" />
            <span>{t("Options")}</span>
          </button>
          <button
            type="button"
            className={`ws-ai-go-btn is-${effectiveKind}`}
            disabled={busy}
            aria-haspopup="dialog"
            aria-label={t("Generate with AI")}
            title={t("Generate with AI")}
            onClick={() => launch(hasPrompt)}
          >
            <span>{t("Generate")}</span>
            <ArrowUp size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
    </section>
  );
}

// ---- 統合パネル Host（画面に 1 つだけ置く） ----

export function AiGenerateHost({
  embedded = false,
  flush,
  kinds,
}: {
  embedded?: boolean;
  flush?: SlidesFlush;
  kinds?: readonly PageKind[];
}) {
  const view = useSyncExternalStore(subscribeAiGenerate, getAiGenerate, () => null);
  const busy = useSyncExternalStore(subscribeAiGenerate, isAiGenerateBusy, () => false);
  const visible = view !== null;
  const reportedClosedBusy = useRef(false);

  useEffect(() => {
    if (!embedded || !visible || !nativeCanShowAiGenerate()) return;
    reportedClosedBusy.current = false;
    postToNative({ type: "aiGenerate", state: "open" });
    return () => {
      const stillBusy = isAiGenerateBusy();
      reportedClosedBusy.current = stillBusy;
      postToNative({ type: "aiGenerate", state: "closed", busy: stillBusy });
    };
  }, [embedded, visible]);

  useEffect(() => {
    if (!embedded || visible || busy || !reportedClosedBusy.current || !nativeCanShowAiGenerate()) return;
    reportedClosedBusy.current = false;
    postToNative({ type: "aiGenerate", state: "closed", busy: false });
  }, [embedded, visible, busy]);

  if (!view) return null;
  return <AiGenerateDialog key={view.key} view={view} embedded={embedded} flush={flush} kinds={orderedCreatableKinds(kinds)} />;
}

// ---- 統合ダイアログ本体 ----

function screenOf(view: AiGenerateView) {
  if (view.phase !== "ready") return view.phase;
  if (view.job.state === "done") return "done";
  if (view.job.state === "working") {
    return view.job.stage === "slides-outline" ? "working-outline" : "working";
  }
  if (view.job.state === "error" && view.job.stage === "slides-deck") return "failed-deck";
  if (view.picker) return "picker";
  if (view.draft.kind === "slides" && view.draft.slidesStep === "outline" && view.draft.slidesOutline) return "outline";
  return "compose";
}

function mascotStateOf(view: AiGenerateView, screen: string): CharacterState {
  if (view.phase === "failed") return "error";
  if (view.phase === "loading") return "thinking";
  if (view.job.state === "working") return "thinking";
  if (view.job.state === "done") return "completed";
  if (view.job.state === "error") return "error";
  if (screen === "compose" && view.draft.prompt.trim()) return "typing";
  return "idle";
}

function openLabelFor(kind: AiGenerateKind, t: Translate): string {
  if (kind === "note") return t("Open note");
  if (kind === "whiteboard") return t("Open whiteboard");
  return t("Open slides");
}

function workingStatusFor(job: Extract<AiGenerateJob, { state: "working" }>, t: Translate): { title: string; subtitle: string } {
  if (job.stage === "note") {
    return {
      title: t("Writing your note…"),
      subtitle: t("You can close this window; the note will appear in Workspace when it’s ready."),
    };
  }
  if (job.stage === "whiteboard") {
    return {
      title: t("Building your whiteboard…"),
      subtitle: t("Creating editable elements. You can close this window; it will appear in Workspace when it’s ready."),
    };
  }
  if (job.stage === "slides-outline") {
    return {
      title: t("Writing the outline…"),
      subtitle: t("Structuring the slide deck so you can review and edit it first."),
    };
  }
  return {
    title: t("Writing the slides…"),
    subtitle: t("This can take a few minutes. You can close this window; the slides will appear in Workspace when they’re ready."),
  };
}

function AiGenerateDialog({
  view,
  embedded,
  flush,
  kinds,
}: {
  view: AiGenerateView;
  embedded: boolean;
  flush?: SlidesFlush;
  kinds: AiGenerateKind[];
}) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const ready = view.phase === "ready" ? view : null;
  const screen = screenOf(view);
  const mascotState = mascotStateOf(view, screen);
  const activeKind: AiGenerateKind = ready
    ? (kinds.includes(ready.draft.kind) ? ready.draft.kind : kinds[0])
    : kinds[0];

  useBackToClose(true, () => { closeAiGenerate(); });
  useBackToClose(screen === "picker", () => { setAiGeneratePicker(false); });
  useEffect(() => { ref.current?.showModal(); }, []);

  useEffect(() => {
    const target = ref.current?.querySelector<HTMLElement>("[data-autofocus]");
    if (!target || ((target.tagName === "INPUT" || target.tagName === "TEXTAREA") && window.matchMedia("(pointer: coarse)").matches)) return;
    target.focus();
  }, [screen]);

  // 参考ノートの一覧（ピッカーを開いたとき、または既に選択済みがあるときに読み込む）。
  const wantsNotes = Boolean(ready && (ready.picker || ready.draft.notes.length > 0));
  const [notes, setNotes] = useState<WizardNote[] | null>(null);
  const [notesError, setNotesError] = useState("");
  const [notesAttempt, setNotesAttempt] = useState(0);
  useEffect(() => {
    if (!wantsNotes) return;
    const controller = new AbortController();
    void fetch("/api/pages", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const data: unknown = await response.json().catch(() => null);
        const list = data && typeof data === "object" ? (data as { pages?: unknown }).pages : undefined;
        if (!response.ok || !Array.isArray(list)) throw new Error("list failed");
        const live = (list as (WizardNote & { kind?: unknown })[])
          .filter((page) => pageKindOf(page) === "note")
          .map((page) => ({ id: page.id, title: page.title, icon: page.icon ?? null }));
        setNotes(live);
        setNotesError("");
        syncAiGenerateNotes(live);
      })
      .catch(() => {
        if (!controller.signal.aborted) setNotesError(msg("Could not load your notes."));
      });
    return () => controller.abort();
  }, [wantsNotes, notesAttempt]);

  const { account } = useAccount();
  const [closedLimit, setClosedLimit] = useState<AiGenerateJob | SlideImageJob | null>(null);
  const donePageId = ready?.job.state === "done" && ready.job.kind === "slides" ? ready.job.page.id : null;
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

  const persistBeforeRedirect = () => {
    if (ready) saveAiGenerateLimitDraft(ready.draft, true);
  };

  const prompts = (
    <>
      {showGuestPrompt && (
        <div className="mt-3">
          <GuestLimitPrompt kind="chat" onBeforeSignIn={persistBeforeRedirect} onClose={() => setClosedLimit(failed)} />
        </div>
      )}
      {showUpgradePrompt && (
        <div className="mt-3">
          <UpgradePrompt kind="chat" onBeforeUpgrade={persistBeforeRedirect} onClose={() => setClosedLimit(failed)} />
        </div>
      )}
    </>
  );

  const imagePrompts = (
    <>
      {showImageGuestPrompt && (
        <div className="mt-3">
          <GuestLimitPrompt kind="image" onClose={() => setClosedLimit(imageJob)} />
        </div>
      )}
      {showImageUpgradePrompt && (
        <div className="mt-3">
          <UpgradePrompt kind="image" onClose={() => setClosedLimit(imageJob)} />
        </div>
      )}
      {showImageStoragePrompt && imageStorageLimit && (
        <div className="mt-3">
          <StorageLimitPrompt limit={imageStorageLimit} actions={!embedded} className="" onClose={() => setClosedLimit(imageJob)} />
        </div>
      )}
    </>
  );

  const canOpen = !embedded || nativeCanOpenPage();
  function openPage(id: string) {
    if (embedded) postToNative({ type: "openPage", id });
    else window.dispatchEvent(new CustomEvent("notefable:open-note", { detail: { id } }));
    closeAiGenerate();
  }

  const headerTitle = screen === "picker"
    ? t("Choose notes")
    : screen === "outline"
      ? t("Review outline")
      : t("Generate with AI");

  const body = !ready ? (
    <>
      <div className="ai-gen-body">
        {view.phase === "loading" ? (
          <div className="ai-gen-stage">
            <div className="ai-gen-stage-mascot is-working">
              <AppIcon size={44} animated state="thinking" />
            </div>
            <p role="status" className="ai-gen-stage-title">{t("Loading…")}</p>
          </div>
        ) : (
          <p role="alert" className="text-sm text-[#b91c1c]">{t(AI_GENERATE_NOTE_FAILED)}</p>
        )}
      </div>
      {view.phase === "failed" && (
        <div className="ai-gen-footer">
          <button type="button" data-autofocus className="notion-button notion-button-primary" onClick={retryAiGenerateLoad}>
            {t("Try again")}
          </button>
        </div>
      )}
    </>
  ) : screen === "done" && ready.job.state === "done" ? (
    <>
      <div className="ai-gen-body">
        <div className={`ai-gen-stage is-${ready.job.kind}`}>
          <div className={`ai-gen-stage-mascot is-done is-${ready.job.kind}`}>
            <AppIcon size={48} animated state="completed" />
          </div>
          <p role="status" className="ai-gen-stage-title">
            {t("Created “{title}” in Workspace.", { title: ready.job.page.title })}
          </p>
          {ready.job.partial && (
            <p className="ai-gen-stage-sub">{t("Part of the content was too long and was left out.")}</p>
          )}
        </div>
        {imageJob && imageJob.status === "working" && (
          <div className="slides-wizard-image-progress">
            <p role="status" className="flex items-start gap-2 text-sm text-[var(--notion-muted)]">
              <LoaderCircle size={16} className="mt-0.5 shrink-0 animate-spin" aria-hidden="true" />
              <span>{t("Generating slide images… ({done}/{total})", { done: imageJob.completed, total: imageJob.total })}</span>
            </p>
            {imageJob.currentSlideTitle && (
              <p className="mt-1 text-xs text-[var(--notion-muted)]">{t("Current slide: {title}", { title: imageJob.currentSlideTitle })}</p>
            )}
            <div className="slides-wizard-progress-track" aria-hidden="true">
              <div
                className="slides-wizard-progress-fill"
                style={{ width: `${imageJob.total ? Math.round((imageJob.completed / imageJob.total) * 100) : 0}%` }}
              />
            </div>
          </div>
        )}
        {imageJob && imageJob.status === "done" && imageJob.total > 0 && (
          <p role="status" className="mt-3 flex items-center justify-center gap-2 text-sm text-[var(--notion-muted)]">
            <ImageIcon size={15} aria-hidden="true" />
            <span>{t("Generated {total} slide images.", { total: imageJob.completed })}</span>
          </p>
        )}
        {imageJob && (imageJob.status === "stopped" || imageJob.status === "error") && (
          <div className="slides-wizard-image-progress">
            <p role="status" className="text-sm text-[var(--notion-muted)]">
              {t("Generated {done} of {total} slide images. {remaining} remaining.", {
                done: imageJob.completed,
                total: imageJob.total,
                remaining: imageJob.remaining,
              })}
            </p>
            {imageJob.error && <p role="alert" className="mt-2 text-sm text-[#b91c1c]">{localizeSystemText(imageJob.error, t)}</p>}
            {imagePrompts}
          </div>
        )}
      </div>
      <div className="ai-gen-footer">
        {imageJob?.status === "working" && donePageId && (
          <button
            type="button"
            className="notion-button slides-wizard-reset"
            disabled={Boolean(imageJob.stopping)}
            onClick={() => stopSlideImageJob(donePageId)}
          >
            {imageJob.stopping ? t("Stopping after this slide…") : t("Stop")}
          </button>
        )}
        {imageJob && (imageJob.status === "stopped" || imageJob.status === "error") && imageJob.remaining > 0 && donePageId && (
          <button type="button" className="notion-button slides-wizard-reset" onClick={() => void resumeSlideImageJob(donePageId)}>
            {t("Resume")}
          </button>
        )}
        <button type="button" data-autofocus={canOpen ? undefined : true} className="notion-button" onClick={() => closeAiGenerate()}>
          {t("Close")}
        </button>
        {canOpen && (
          <button
            type="button"
            data-autofocus
            className="notion-button notion-button-primary inline-flex items-center gap-1"
            onClick={() => openPage(ready.job.state === "done" ? ready.job.page.id : "")}
          >
            <span>{openLabelFor(ready.job.kind, t)}</span>
            <ArrowUpRight size={15} aria-hidden="true" />
          </button>
        )}
      </div>
    </>
  ) : (screen === "working" || screen === "working-outline") && ready.job.state === "working" ? (() => {
    const status = workingStatusFor(ready.job, t);
    return (
      <>
        <div className="ai-gen-body">
          <div className={`ai-gen-stage is-${activeKind}`}>
            <div className={`ai-gen-stage-mascot is-working is-${activeKind}`}>
              <AppIcon size={52} animated state="thinking" />
            </div>
            <p role="status" className="ai-gen-stage-title">{status.title}</p>
            <p className="ai-gen-stage-sub">{status.subtitle}</p>
            <div className="ai-gen-indeterminate" aria-hidden="true">
              <div className={`ai-gen-indeterminate-bar is-${activeKind}`} />
            </div>
          </div>
        </div>
        <div className="ai-gen-footer">
          <button type="button" data-autofocus className="notion-button" onClick={() => closeAiGenerate()}>
            {t("Close")}
          </button>
        </div>
      </>
    );
  })() : screen === "failed-deck" ? (
    <>
      <div className="ai-gen-body">
        {failed && <p role="alert" className="text-sm text-[#b91c1c]">{localizeSystemText(failed.message, t)}</p>}
        {prompts}
      </div>
      <div className="ai-gen-footer">
        <button type="button" className="notion-button" onClick={dismissAiGenerateError}>{t("Back")}</button>
        <button
          type="button"
          data-autofocus
          className="notion-button notion-button-primary"
          onClick={() => void submitAiGenerate({ flush, stageOverride: "slides-deck", embedded })}
        >
          {t("Try again")}
        </button>
      </div>
    </>
  ) : screen === "picker" ? (
    <NotePickerView
      draft={ready.draft}
      notes={notes}
      error={notesError}
      onRetry={() => { setNotesError(""); setNotesAttempt((count) => count + 1); }}
    />
  ) : screen === "outline" && ready.draft.slidesOutline ? (
    <OutlineView
      draft={ready.draft}
      outline={ready.draft.slidesOutline}
      job={ready.job}
      flush={flush}
      embedded={embedded}
      prompts={prompts}
    />
  ) : (
    <ComposeView
      draft={ready.draft}
      kinds={kinds}
      activeKind={activeKind}
      job={ready.job}
      flush={flush}
      embedded={embedded}
      prompts={prompts}
    />
  );

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={`notes-dialog ai-gen-dialog is-${activeKind}`}
      translate="no"
      onCancel={(event) => {
        event.preventDefault();
        aiGenerateBack();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const r = event.currentTarget.getBoundingClientRect();
          if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) {
            closeAiGenerate();
          }
        }
      }}
    >
      <div className="ai-gen-header">
        <div className="ai-gen-header-lead">
          {screen === "picker" ? (
            <button
              type="button"
              className="notion-icon-button grid"
              aria-label={t("Back")}
              onClick={() => setAiGeneratePicker(false)}
            >
              <ArrowLeft size={16} className="rtl-mirror" />
            </button>
          ) : (
            <span className="ai-gen-header-mascot" aria-hidden="true">
              <AppIcon size={28} animated state={mascotState} />
            </span>
          )}
          <h2 id={titleId} className="ai-gen-title">{headerTitle}</h2>
          {ready && screen !== "compose" && screen !== "picker" && (
            <span className={`ws-kind-badge is-${activeKind}`}>{t(PAGE_KIND_LABELS[activeKind])}</span>
          )}
        </div>
        <button
          type="button"
          className="notion-icon-button grid"
          aria-label={t("Close")}
          title={t("Close")}
          onClick={() => closeAiGenerate()}
        >
          <X size={17} />
        </button>
      </div>
      {body}
    </dialog>
  );
}

// ---- ① メイン入力面（プロンプト主役 + 種別選択 + コンテキスト別オプション） ----

function hasDraftContent(draft: AiGenerateDraft): boolean {
  const fresh = newAiGenerateDraft(draft.kind);
  return Boolean(draft.prompt.trim())
    || draft.notes.length > 0
    || Boolean(draft.slidesOutline)
    || draft.language !== fresh.language
    || draft.noteStyle !== fresh.noteStyle
    || draft.whiteboardStructure !== fresh.whiteboardStructure
    || JSON.stringify(draft.slidesOptions) !== JSON.stringify(fresh.slidesOptions);
}

function setSlidesOptions(patch: Partial<SlidesOptions>) {
  updateAiGenerateDraft((draft) => ({
    ...draft,
    slidesOptions: { ...draft.slidesOptions, ...patch },
  }));
}

function ComposeView({
  draft,
  kinds,
  activeKind,
  job,
  flush,
  embedded,
  prompts,
}: {
  draft: AiGenerateDraft;
  kinds: AiGenerateKind[];
  activeKind: AiGenerateKind;
  job: AiGenerateJob;
  flush?: SlidesFlush;
  embedded: boolean;
  prompts: ReactNode;
}) {
  const t = useT();
  const working = job.state === "working";
  const ready = canSubmitAiGenerate({ ...draft, kind: activeKind, slidesStep: "compose" });

  function submit() {
    if (!ready || working) return;
    if (draft.kind !== activeKind) {
      updateAiGenerateDraft((current) => ({ ...current, kind: activeKind }));
    }
    void submitAiGenerate({ flush, embedded, stageOverride: activeKind === "slides" ? "slides-outline" : undefined });
  }

  const primaryLabel = activeKind === "note"
    ? t("Generate note")
    : activeKind === "whiteboard"
      ? t("Generate whiteboard")
      : t("Create outline");

  return (
    <>
      <div className="ai-gen-body">
        <fieldset disabled={working} className="ai-gen-fields">
          {/* 主役のプロンプト入力カード */}
          <div className={`ai-gen-composer is-${activeKind}`}>
            <textarea
              data-autofocus
              className="ai-gen-textarea"
              dir="auto"
              rows={4}
              maxLength={MAX_AI_PROMPT_CHARS}
              value={draft.prompt}
              aria-label={t("What do you want to create?")}
              placeholder={t(KIND_PLACEHOLDERS[activeKind])}
              onChange={(event) => {
                const value = event.target.value;
                updateAiGenerateDraft((current) => ({ ...current, prompt: value }));
              }}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  submit();
                }
              }}
            />
            <div className="ai-gen-composer-bar">
              <div className="ai-gen-composer-notes">
                {draft.notes.map((note) => (
                  <span key={note.id} className="project-settings-chip">
                    <NoteIcon icon={note.icon} fallback={<FileText size={12.5} aria-hidden="true" />} />
                    <span className="project-settings-chip-title">{note.title || t("Untitled")}</span>
                    <button
                      type="button"
                      aria-label={t("Remove {title}", { title: note.title || t("Untitled") })}
                      onClick={() => updateAiGenerateDraft((current) => ({
                        ...current,
                        notes: current.notes.filter((item) => item.id !== note.id),
                      }))}
                    >
                      <X size={12} aria-hidden="true" />
                    </button>
                  </span>
                ))}
                <button
                  type="button"
                  className="ai-gen-attach-btn"
                  aria-haspopup="dialog"
                  onClick={() => setAiGeneratePicker(true)}
                >
                  <Plus size={13.5} aria-hidden="true" />
                  <span>{draft.notes.length ? t("Notes ({count}/{max})", { count: draft.notes.length, max: MAX_AI_SOURCE_NOTES }) : t("Add notes")}</span>
                </button>
              </div>
              {draft.prompt.length > MAX_AI_PROMPT_CHARS * 0.75 && (
                <span className="ai-gen-char-count" aria-live="polite">
                  {draft.prompt.length}/{MAX_AI_PROMPT_CHARS}
                </span>
              )}
            </div>
          </div>

          {/* 3 種別選択（新順序：ノート → ホワイトボード → スライド） */}
          {kinds.length > 1 && (
            <div className="ai-gen-kind-group">
              <span className="ai-gen-section-label">{t("Output type")}</span>
              <div className="ai-gen-kind-grid" role="radiogroup" aria-label={t("Output type")}>
                {kinds.map((kind) => {
                  const selected = activeKind === kind;
                  return (
                    <button
                      key={kind}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      className={`ai-gen-kind-card is-${kind}${selected ? " is-selected" : ""}`}
                      onClick={() => updateAiGenerateDraft((current) => ({ ...current, kind }))}
                    >
                      <span className={`ai-gen-kind-icon is-${kind}`} aria-hidden="true">
                        <PageKindIcon kind={kind} size={17} strokeWidth={1.9} />
                      </span>
                      <span className="ai-gen-kind-text">
                        <span className="ai-gen-kind-name">{t(PAGE_KIND_LABELS[kind])}</span>
                        <span className="ai-gen-kind-sub">{t(KIND_SUBTITLES[kind])}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* 選んだ種別ごとのコンパクトな設定 */}
          {activeKind === "note" && (
            <div className="ai-gen-options-grid">
              <label className="slides-wizard-field">
                <span className="slides-wizard-label">{t("Style")}</span>
                <select
                  className="notes-dialog-input"
                  value={draft.noteStyle}
                  onChange={(event) => updateAiGenerateDraft((current) => ({
                    ...current,
                    noteStyle: event.target.value as NoteGenerateStyle,
                  }))}
                >
                  {NOTE_GENERATE_STYLES.map((style) => (
                    <option key={style} value={style}>{t(NOTE_STYLE_LABELS[style])}</option>
                  ))}
                </select>
              </label>
              <LanguageSelect
                label={t("Output language")}
                value={draft.language}
                onChange={(language) => updateAiGenerateDraft((current) => ({ ...current, language }))}
              />
            </div>
          )}

          {activeKind === "whiteboard" && (
            <div className="ai-gen-options-grid">
              <label className="slides-wizard-field">
                <span className="slides-wizard-label">{t("Structure")}</span>
                <select
                  className="notes-dialog-input"
                  value={draft.whiteboardStructure}
                  onChange={(event) => updateAiGenerateDraft((current) => ({
                    ...current,
                    whiteboardStructure: event.target.value as WhiteboardGenerateStructure,
                  }))}
                >
                  {WHITEBOARD_GENERATE_STRUCTURES.map((structure) => (
                    <option key={structure} value={structure}>{t(WHITEBOARD_STRUCTURE_LABELS[structure])}</option>
                  ))}
                </select>
              </label>
              <LanguageSelect
                label={t("Output language")}
                value={draft.language}
                onChange={(language) => updateAiGenerateDraft((current) => ({ ...current, language }))}
              />
            </div>
          )}

          {activeKind === "slides" && (
            <div className="ai-gen-slides-options">
              <div className="ai-gen-options-grid">
                <label className="slides-wizard-field">
                  <span className="slides-wizard-label">{t("Number of slides")}</span>
                  <select
                    className="notes-dialog-input"
                    value={String(draft.slidesOptions.pageCount)}
                    onChange={(event) => setSlidesOptions({
                      pageCount: event.target.value === "auto" ? "auto" : Number(event.target.value),
                    })}
                  >
                    <option value="auto">{t("Auto")}</option>
                    {Array.from({ length: MAX_PAGE_COUNT - MIN_PAGE_COUNT + 1 }, (_, index) => index + MIN_PAGE_COUNT).map((count) => (
                      <option key={count} value={count}>{t("{count} slides", { count })}</option>
                    ))}
                  </select>
                </label>
                <label className="slides-wizard-field">
                  <span className="slides-wizard-label">{t("Tone")}</span>
                  <select
                    className="notes-dialog-input"
                    value={draft.slidesOptions.tone}
                    onChange={(event) => setSlidesOptions({ tone: event.target.value as SlidesTone })}
                  >
                    {SLIDES_TONES.map((tone) => (
                      <option key={tone} value={tone}>{t(TONE_LABELS[tone])}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="slides-wizard-toggle-card">
                <label className="slides-wizard-toggle">
                  <input
                    type="checkbox"
                    checked={draft.slidesOptions.generateImages === true}
                    onChange={(event) => setSlidesOptions({ generateImages: event.target.checked })}
                  />
                  <span className="slides-wizard-toggle-text">
                    <span className="slides-wizard-toggle-title">{t("Generate images for slides")}</span>
                    {draft.slidesOptions.generateImages === true && (
                      <span className="slides-wizard-toggle-hint">
                        {t("Adds AI illustrations to key slides. Uses 1 image credit per illustrated slide (up to {count} image credits).", {
                          count: draft.slidesOptions.pageCount === "auto" ? MAX_OUTLINE_SLIDES : draft.slidesOptions.pageCount - 1,
                        })}
                      </span>
                    )}
                  </span>
                </label>
              </div>

              <details className="slides-wizard-advanced">
                <summary>{t("Advanced")}</summary>
                <div className="ai-gen-options-grid mt-2.5">
                  <LanguageSelect
                    label={t("Slide language")}
                    value={draft.language}
                    onChange={(language) => updateAiGenerateDraft((current) => ({ ...current, language }))}
                  />
                  <label className="slides-wizard-field">
                    <span className="slides-wizard-label">{t("Wording")}</span>
                    <select
                      className="notes-dialog-input"
                      value={draft.slidesOptions.wording}
                      onChange={(event) => setSlidesOptions({ wording: event.target.value as SlidesWording })}
                    >
                      {SLIDES_WORDINGS.map((wording) => (
                        <option key={wording} value={wording}>{t(WORDING_LABELS[wording])}</option>
                      ))}
                    </select>
                  </label>
                  <label className="slides-wizard-field">
                    <span className="slides-wizard-label">{t("Theme")}</span>
                    <select
                      className="notes-dialog-input"
                      value={draft.slidesOptions.theme.id}
                      onChange={(event) => setSlidesOptions({ theme: { ...draft.slidesOptions.theme, id: event.target.value } })}
                    >
                      {SLIDE_THEMES.map((theme) => (
                        <option key={theme.id} value={theme.id}>{t(theme.name)}</option>
                      ))}
                    </select>
                  </label>
                  <label className="slides-wizard-field">
                    <span className="slides-wizard-label">{t("Appearance")}</span>
                    <select
                      className="notes-dialog-input"
                      value={draft.slidesOptions.theme.mode}
                      onChange={(event) => setSlidesOptions({
                        theme: { ...draft.slidesOptions.theme, mode: event.target.value === "dark" ? "dark" : "light" },
                      })}
                    >
                      <option value="light">{t("Light")}</option>
                      <option value="dark">{t("Dark")}</option>
                    </select>
                  </label>
                </div>
                <label className="slides-wizard-field mt-2.5">
                  <span className="slides-wizard-label">{t("Audience")}</span>
                  <input
                    className="notes-dialog-input"
                    dir="auto"
                    value={draft.slidesOptions.audience}
                    maxLength={MAX_AUDIENCE_CHARS}
                    placeholder={t("Who is it for?")}
                    onChange={(event) => setSlidesOptions({ audience: event.target.value })}
                  />
                </label>
              </details>
            </div>
          )}
        </fieldset>

        {job.state === "error" && (
          <p role="alert" className="mt-3 text-sm text-[#b91c1c]">{localizeSystemText(job.message, t)}</p>
        )}
        {prompts}
      </div>

      <div className="ai-gen-footer">
        <p className="slides-wizard-note">{t("This counts as 1 chat message.")}</p>
        {hasDraftContent(draft) && (
          <button type="button" className="notion-button slides-wizard-reset" disabled={working} onClick={startOverAiGenerate}>
            {t("Start over")}
          </button>
        )}
        {activeKind === "slides" && draft.slidesOutline && (
          <button
            type="button"
            className="notion-button"
            disabled={working}
            onClick={() => updateAiGenerateDraft((current) => ({ ...current, slidesStep: "outline" }))}
          >
            {t("Back to outline")}
          </button>
        )}
        <button
          type="button"
          className="notion-button notion-button-primary"
          disabled={!ready || working}
          onClick={submit}
        >
          {primaryLabel}
        </button>
      </div>
    </>
  );
}

function LanguageSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: "auto" | Locale;
  onChange: (next: "auto" | Locale) => void;
}) {
  const t = useT();
  return (
    <label className="slides-wizard-field">
      <span className="slides-wizard-label">{label}</span>
      <select
        className="notes-dialog-input"
        value={value}
        onChange={(event) => onChange(event.target.value as "auto" | Locale)}
      >
        <option value="auto">{t("Same as the material")}</option>
        {LOCALES.map((locale) => (
          <option key={locale} value={locale} lang={locale}>{LOCALE_NAMES[locale]}</option>
        ))}
      </select>
    </label>
  );
}

// ---- ② スライドの大綱編集面（同じ統合パネルの中で引き継ぐ） ----

function setOutline(change: (outline: SlidesOutline) => SlidesOutline) {
  updateAiGenerateDraft((draft) => (draft.slidesOutline ? { ...draft, slidesOutline: change(draft.slidesOutline) } : draft));
}

function setSlide(index: number, change: (slide: SlidesOutline["slides"][number]) => SlidesOutline["slides"][number]) {
  setOutline((outline) => ({
    ...outline,
    slides: outline.slides.map((slide, at) => (at === index ? change(slide) : slide)),
  }));
}

function moveSlide(index: number, to: number) {
  setOutline((outline) => {
    if (to < 0 || to >= outline.slides.length) return outline;
    const slides = [...outline.slides];
    [slides[index], slides[to]] = [slides[to], slides[index]];
    return { ...outline, slides };
  });
}

function OutlineView({
  draft,
  outline,
  job,
  flush,
  embedded,
  prompts,
}: {
  draft: AiGenerateDraft;
  outline: SlidesOutline;
  job: AiGenerateJob;
  flush?: SlidesFlush;
  embedded: boolean;
  prompts: ReactNode;
}) {
  const t = useT();
  const listRef = useRef<HTMLOListElement>(null);
  const working = job.state === "working";
  const ready = canSubmitSlidesDeck(draft);

  function move(index: number, step: -1 | 1) {
    const to = index + step;
    moveSlide(index, to);
    requestAnimationFrame(() => {
      const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>(`[data-move^="${to}:"]`);
      const same = listRef.current?.querySelector<HTMLButtonElement>(`[data-move="${to}:${step}"]`);
      (same && !same.disabled ? same : Array.from(buttons ?? []).find((button) => !button.disabled))?.focus();
    });
  }

  return (
    <>
      <div className="ai-gen-body">
        <p className="text-sm text-[var(--notion-muted)]">{t("Review the outline, then generate the slides.")}</p>
        {draft.slidesPartial && (
          <p className="mt-1 text-sm text-[var(--notion-muted)]">
            {t("Part of the material was too long, so only the first part was used.")}
          </p>
        )}
        {job.state === "error" && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <p role="alert" className="min-w-0 flex-1 text-sm text-[#b91c1c]">{localizeSystemText(job.message, t)}</p>
            <button
              type="button"
              className="notion-button"
              onClick={() => void submitAiGenerate({ flush, embedded, stageOverride: "slides-outline" })}
            >
              {t("Try again")}
            </button>
          </div>
        )}
        {prompts}
        <fieldset disabled={working} className="slides-wizard-fields slides-wizard-outline">
          <label className="slides-wizard-field">
            <span className="slides-wizard-label">{t("Title slide")}</span>
            <input
              className="notes-dialog-input"
              dir="auto"
              value={outline.title}
              maxLength={MAX_OUTLINE_TITLE_CHARS}
              aria-invalid={!outline.title.trim() || undefined}
              onChange={(event) => {
                const title = event.target.value;
                setOutline((current) => ({ ...current, title }));
              }}
            />
          </label>
          <ol ref={listRef} className="slides-wizard-slides">
            {outline.slides.map((slide, index) => {
              const number = index + 2;
              return (
                <li key={index} className="slides-wizard-slide">
                  <div className="slides-wizard-slide-head">
                    <span className="slides-wizard-label">{t("Slide {number}", { number })}</span>
                    <button
                      type="button"
                      data-move={`${index}:-1`}
                      className="notion-icon-button grid"
                      disabled={index === 0}
                      aria-label={t("Move up")}
                      title={t("Move up")}
                      onClick={() => move(index, -1)}
                    >
                      <ChevronUp size={15} />
                    </button>
                    <button
                      type="button"
                      data-move={`${index}:1`}
                      className="notion-icon-button grid"
                      disabled={index === outline.slides.length - 1}
                      aria-label={t("Move down")}
                      title={t("Move down")}
                      onClick={() => move(index, 1)}
                    >
                      <ChevronDown size={15} />
                    </button>
                    <button
                      type="button"
                      className="notion-icon-button grid"
                      disabled={outline.slides.length === 1}
                      aria-label={t("Delete slide")}
                      title={t("Delete slide")}
                      onClick={() => setOutline((current) => ({ ...current, slides: current.slides.filter((_, at) => at !== index) }))}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                  <input
                    className="notes-dialog-input slides-wizard-slide-title"
                    dir="auto"
                    value={slide.title}
                    maxLength={MAX_SLIDE_TITLE_CHARS}
                    aria-label={t("Slide title")}
                    placeholder={t("Slide title")}
                    aria-invalid={!slide.title.trim() || undefined}
                    onChange={(event) => {
                      const title = event.target.value;
                      setSlide(index, (current) => ({ ...current, title }));
                    }}
                  />
                  {slide.points.length > 0 && (
                    <ul className="slides-wizard-points">
                      {slide.points.map((point, at) => (
                        <li key={at}>
                          <input
                            className="notes-dialog-input"
                            dir="auto"
                            value={point}
                            maxLength={MAX_POINT_CHARS}
                            aria-label={t("Point {number}", { number: at + 1 })}
                            onChange={(event) => {
                              const value = event.target.value;
                              setSlide(index, (current) => ({
                                ...current,
                                points: current.points.map((item, i) => (i === at ? value : item)),
                              }));
                            }}
                          />
                          <button
                            type="button"
                            className="notion-icon-button grid"
                            aria-label={t("Delete point")}
                            title={t("Delete point")}
                            onClick={() => setSlide(index, (current) => ({
                              ...current,
                              points: current.points.filter((_, i) => i !== at),
                            }))}
                          >
                            <X size={14} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <button
                    type="button"
                    className="slides-wizard-add"
                    disabled={slide.points.length >= MAX_SLIDE_POINTS}
                    onClick={() => setSlide(index, (current) => ({ ...current, points: [...current.points, ""] }))}
                  >
                    <Plus size={13} aria-hidden="true" />{t("Add point")}
                  </button>
                </li>
              );
            })}
          </ol>
          <button
            type="button"
            className="ws-util-pill"
            disabled={outline.slides.length >= MAX_OUTLINE_SLIDES}
            onClick={() => setOutline((current) => ({ ...current, slides: [...current.slides, { title: "", points: [] }] }))}
          >
            <Presentation size={14} aria-hidden="true" /><span>{t("Add slide")}</span>
          </button>
          <div className="slides-wizard-toggle-card">
            <label className="slides-wizard-toggle">
              <input
                type="checkbox"
                checked={draft.slidesOptions.generateImages === true}
                onChange={(event) => setSlidesOptions({ generateImages: event.target.checked })}
              />
              <span className="slides-wizard-toggle-text">
                <span className="slides-wizard-toggle-title">{t("Generate images for slides")}</span>
                {draft.slidesOptions.generateImages === true && (
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
      <div className="ai-gen-footer">
        <p className="slides-wizard-note">
          {!ready
            ? t("Give the title slide and every slide a title.")
            : draft.slidesOptions.generateImages === true
              ? t("This counts as 1 chat message, plus up to {count} image credits.", { count: outline.slides.length })
              : t("This counts as 1 chat message.")}
        </p>
        <button type="button" className="notion-button slides-wizard-reset" disabled={working} onClick={startOverAiGenerate}>
          {t("Start over")}
        </button>
        <button
          type="button"
          className="notion-button"
          disabled={working}
          onClick={() => updateAiGenerateDraft((current) => ({ ...current, slidesStep: "compose" }))}
        >
          {t("Back")}
        </button>
        <button
          type="button"
          className="notion-button"
          disabled={working || !canSubmitSlidesOutline(draft)}
          onClick={() => void submitAiGenerate({ flush, fresh: true, embedded, stageOverride: "slides-outline" })}
        >
          {t("Regenerate outline")}
        </button>
        <button
          type="button"
          data-autofocus
          className="notion-button notion-button-primary"
          disabled={!ready || working}
          onClick={() => void submitAiGenerate({ flush, embedded, stageOverride: "slides-deck" })}
        >
          {t("Generate slides")}
        </button>
      </div>
    </>
  );
}

// ---- 参考ノート選択面（最大 5 件） ----

function NotePickerView({
  draft,
  notes,
  error,
  onRetry,
}: {
  draft: AiGenerateDraft;
  notes: WizardNote[] | null;
  error: string;
  onRetry: () => void;
}) {
  const t = useT();
  const [filter, setFilter] = useState("");
  const selected = draft.notes;
  const selectedIds = new Set(selected.map((note) => note.id));
  const full = selected.length >= MAX_AI_SOURCE_NOTES;
  const query = filter.trim().toLowerCase();
  const listed = (notes ?? []).filter((note) => !query || (note.title || t("Untitled")).toLowerCase().includes(query));

  function toggle(note: WizardNote) {
    updateAiGenerateDraft((current) => {
      const chosen = current.notes;
      const next = chosen.some((item) => item.id === note.id)
        ? chosen.filter((item) => item.id !== note.id)
        : chosen.length >= MAX_AI_SOURCE_NOTES
          ? chosen
          : [...chosen, note];
      return { ...current, notes: next };
    });
  }

  return (
    <>
      <div className="ai-gen-body">
        <p className="project-settings-label">
          {t("Your notes")}
          <span className={`project-settings-count${full ? " is-full" : ""}`} aria-live="polite">
            {selected.length}/{MAX_AI_SOURCE_NOTES}
          </span>
        </p>
        {!notes && !error && (
          <p className="project-settings-empty" role="status">
            <LoaderCircle size={14} className="me-1 inline animate-spin" aria-hidden="true" />{t("Loading…")}
          </p>
        )}
        {error && (
          <>
            <p role="alert" className="project-settings-error">{t(error)}</p>
            <button type="button" className="notion-button mt-2" onClick={onRetry}>{t("Try again")}</button>
          </>
        )}
        {notes && (
          <>
            <label className="project-settings-search">
              <Search size={14} aria-hidden="true" />
              <input
                type="search"
                data-autofocus
                value={filter}
                placeholder={t("Filter your notes")}
                aria-label={t("Filter your notes")}
                onChange={(event) => setFilter(event.target.value)}
              />
            </label>
            {listed.length > 0 && (
              <ul className="project-settings-list slides-wizard-notes" aria-label={t("Your notes")}>
                {listed.slice(0, MAX_LISTED_NOTES).map((note) => {
                  const checked = selectedIds.has(note.id);
                  const blocked = !checked && full;
                  return (
                    <li key={note.id}>
                      <label className={`project-settings-option${checked ? " is-selected" : ""}${blocked ? " is-disabled" : ""}`}>
                        <input type="checkbox" checked={checked} disabled={blocked} onChange={() => toggle(note)} />
                        <span className="project-settings-note-icon" aria-hidden="true">
                          <NoteIcon icon={note.icon} fallback={<PageKindIcon kind="note" size={14} />} />
                        </span>
                        <span className="project-settings-note-title">{note.title || t("Untitled")}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
            {!listed.length && (
              <p className="project-settings-empty">{notes.length ? t("No notes match.") : t("You don’t have any notes yet.")}</p>
            )}
            {listed.length > MAX_LISTED_NOTES && (
              <p className="project-settings-empty">
                {t("Showing the first {count} notes. Type in the filter to find others.", { count: MAX_LISTED_NOTES })}
              </p>
            )}
            {full && (
              <p className="project-settings-empty">
                {t("You can choose up to {count} notes. Remove one to pick another.", { count: MAX_AI_SOURCE_NOTES })}
              </p>
            )}
          </>
        )}
      </div>
      <div className="ai-gen-footer">
        <button type="button" className="notion-button notion-button-primary" onClick={() => setAiGeneratePicker(false)}>
          {t("Done")}
        </button>
      </div>
    </>
  );
}
