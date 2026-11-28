import {
  cleanPromptText,
  MAX_AI_PROMPT_CHARS,
  type AiGenerateKind,
} from "@/lib/ai-generate";
import {
  aiGeneratePlacementKey,
  newAiGenerateDraft,
  parseAiGenerateDraft,
  readAiGenerateDraft,
  removeAiGenerateDraft,
  writeAiGenerateDraft,
  type AiGenerateDraft,
  type AiGeneratePlacement,
  type AiGenerateStage,
} from "@/lib/ai-generate-draft";
import { UNSAVED_NOTE } from "@/lib/draw-diagram-jobs";
import { msg } from "@/lib/i18n/translate";
import { postToNative } from "@/lib/native-bridge";
import { savePendingDraft, takePendingDraft } from "@/lib/pending-draft";
import {
  parseOptions,
  parseOutline,
  parseSource,
  type SlidesOptions,
  type SlidesSource,
} from "@/lib/slides/ai-wizard";
import {
  isAnySlideImageJobWorking,
  isSlideImageJobWorking,
  parseSlideImageTasks,
  startSlideImageJob,
  subscribeSlideImageJobs,
} from "@/lib/slides-image-jobs";
import type { WizardNote } from "@/lib/slides-wizard-draft";
import type { SlidesFlush } from "@/lib/slides-wizard-jobs";
import { usageLimitErrorFrom, type UsageTier } from "@/lib/usage-plans";
import type { NotePageSummary } from "@/types/notes";

// 統合「AI で生成」パネル（ノート・ホワイトボード・スライド）の画面外状態と要求。
// パネルを閉じても裏で生成を続け、完了したら "notefable:page-created" と native pagesChanged を送る。
// スライド生成は既存の /api/pages/slides/outline と /api/pages/slides/deck、slides-image-jobs.ts をそのまま使う。

export type AiGenerateJob =
  | { state: "idle" }
  | { state: "working"; stage: AiGenerateStage }
  | { state: "done"; kind: AiGenerateKind; page: NotePageSummary; partial: boolean }
  | { state: "error"; stage: AiGenerateStage; message: string; status: number; limit?: { tier: UsageTier } };

export type AiGenerateView =
  | { key: string; phase: "loading" | "failed" }
  | { key: string; phase: "ready"; placement: AiGeneratePlacement; draft: AiGenerateDraft; job: AiGenerateJob; picker: boolean };

export const AI_GENERATE_NOTE_FAILED = msg("Could not generate the note. Try again.");
export const AI_GENERATE_WHITEBOARD_FAILED = msg("Could not generate the whiteboard. Try again.");
export const AI_GENERATE_SLIDES_FAILED = msg("Could not generate slides. Try again.");
export const AI_GENERATE_LIMIT_DRAFT_SCOPE = "ai-generate-panel";

const SCOPE_URL = "/api/pages/generate";
const SERVER_REASONS = new Set([400, 404, 409, 413, 422, 429]);

type Session = {
  placement: AiGeneratePlacement;
  draft: AiGenerateDraft;
  job: AiGenerateJob;
};

type ShownState = {
  key: string;
  placement: AiGeneratePlacement;
  initialKind: AiGenerateKind | null;
  initialPrompt: string | null;
  autoStart: boolean;
  model: string;
  picker: boolean;
  failed: boolean;
};

const sessions = new Map<string, Session>();
let scope: string | null = null;
let scopeRequest = 0;
let shown: ShownState | null = null;
let view: AiGenerateView | null = null;
let generation = 0;
const listeners = new Set<() => void>();

function emit() {
  if (!shown) {
    view = null;
  } else {
    const session = sessions.get(shown.key);
    view = session
      ? { key: shown.key, phase: "ready", placement: session.placement, draft: session.draft, job: session.job, picker: shown.picker }
      : { key: shown.key, phase: shown.failed ? "failed" : "loading" };
  }
  listeners.forEach((listener) => listener());
}

export function subscribeAiGenerate(listener: () => void) {
  listeners.add(listener);
  const stopImages = subscribeSlideImageJobs(listener);
  return () => {
    listeners.delete(listener);
    stopImages();
  };
}

export function getAiGenerate(): AiGenerateView | null {
  return view;
}

export function isAiGenerateBusy(): boolean {
  return [...sessions.values()].some((session) => session.job.state === "working") || isAnySlideImageJobWorking();
}

function applyInitialToSession(session: Session, target: ShownState, preserveRecoveredKind = false) {
  if (session.job.state === "working") return;
  if (session.job.state === "done" && isSlideImageJobWorking(session.job.page.id)) return;
  let changed = false;
  if (session.job.state === "done" && (target.initialPrompt || target.initialKind)) {
    // 前の生成が完了したあと、新しい内容または別種別で開かれた場合は新しい下書きへ切り替える。
    session.draft = newAiGenerateDraft(target.initialKind ?? session.draft.kind);
    session.job = { state: "idle" };
    changed = true;
  }
  if (target.initialKind && !preserveRecoveredKind && session.draft.kind !== target.initialKind) {
    session.draft = { ...session.draft, kind: target.initialKind };
    if (session.job.state === "error") session.job = { state: "idle" };
    changed = true;
  }
  if (target.initialPrompt !== null) {
    const trimmed = target.initialPrompt.slice(0, MAX_AI_PROMPT_CHARS);
    if (trimmed && trimmed !== session.draft.prompt) {
      session.draft = {
        ...session.draft,
        prompt: trimmed,
        slidesStep: "compose",
        slidesOutline: null,
        slidesPartial: undefined,
      };
      if (session.job.state === "error") session.job = { state: "idle" };
      changed = true;
    }
  }
  if (changed && scope) writeAiGenerateDraft(scope, target.key, session.draft);
}

function restoreLimitDraft(): AiGenerateDraft | null {
  const raw = takePendingDraft(AI_GENERATE_LIMIT_DRAFT_SCOPE);
  if (!raw) return null;
  return parseAiGenerateDraft(raw);
}

export function saveAiGenerateLimitDraft(draft: AiGenerateDraft, persistent = false) {
  savePendingDraft(AI_GENERATE_LIMIT_DRAFT_SCOPE, JSON.stringify({ ...draft, updatedAt: Date.now() }), { persistent });
}

async function loadScope() {
  const token = ++scopeRequest;
  const started = generation;
  let next: string | null = null;
  try {
    const response = await fetch(SCOPE_URL, { cache: "no-store" });
    const data: unknown = await response.json().catch(() => null);
    const value = data && typeof data === "object" ? (data as { scope?: unknown }).scope : null;
    if (response.ok && typeof value === "string" && value) next = value;
  } catch {
    next = null;
  }
  if (started !== generation || token !== scopeRequest || !shown) return;
  if (!next) {
    if (!sessions.has(shown.key)) {
      shown = { ...shown, failed: true };
      emit();
    }
    return;
  }
  if (scope !== null && scope !== next) sessions.clear();
  scope = next;
  let session = sessions.get(shown.key);
  if (!session) {
    const limitDraft = restoreLimitDraft();
    const recovered = limitDraft
      ?? readAiGenerateDraft(next, shown.key)
      ?? newAiGenerateDraft(shown.initialKind ?? "note");
    session = { placement: shown.placement, draft: recovered, job: { state: "idle" } };
    sessions.set(shown.key, session);
    applyInitialToSession(session, shown, Boolean(limitDraft && !shown.initialPrompt));
  }
  const shouldAutoStart = shown.autoStart;
  shown = { ...shown, initialKind: null, initialPrompt: null, autoStart: false };
  emit();
  if (shouldAutoStart && session.job.state === "idle" && canSubmitAiGenerate(session.draft)) {
    void submitAiGenerate();
  }
}

function dismissFinished(key: string) {
  const session = sessions.get(key);
  if (session?.job.state === "done") {
    if (!isSlideImageJobWorking(session.job.page.id)) sessions.delete(key);
  } else if (session?.job.state === "error") {
    session.job = { state: "idle" };
  }
}

export function openAiGenerate({
  kind = null,
  groupId = null,
  parentId = null,
  prompt = null,
  autoStart = false,
  model = "",
}: {
  kind?: AiGenerateKind | null;
  groupId?: string | null;
  parentId?: string | null;
  prompt?: string | null;
  autoStart?: boolean;
  model?: string;
} = {}) {
  const placement: AiGeneratePlacement = { groupId: groupId ?? null, parentId: parentId ?? null };
  const key = aiGeneratePlacementKey(placement);
  if (shown && shown.key !== key) dismissFinished(shown.key);
  const nextShown: ShownState = {
    key,
    placement,
    initialKind: kind,
    initialPrompt: prompt && prompt.trim() ? prompt : null,
    autoStart: Boolean(autoStart),
    model,
    picker: false,
    failed: false,
  };
  shown = nextShown;
  const session = sessions.get(key);
  if (session) {
    session.placement = placement;
    applyInitialToSession(session, nextShown);
    const shouldStart = nextShown.autoStart && session.job.state === "idle" && canSubmitAiGenerate(session.draft);
    shown = { ...nextShown, initialKind: null, initialPrompt: null, autoStart: false };
    emit();
    if (shouldStart) void submitAiGenerate();
    void loadScope();
    return;
  }
  emit();
  void loadScope();
}

export function retryAiGenerateLoad() {
  if (!shown?.failed) return;
  shown = { ...shown, failed: false };
  emit();
  void loadScope();
}

export function closeAiGenerate(): boolean {
  if (!shown) return false;
  dismissFinished(shown.key);
  shown = null;
  emit();
  return true;
}

export function hideAiGenerate(): boolean {
  if (!shown) return false;
  shown = null;
  emit();
  return true;
}

export function setAiGeneratePicker(open: boolean) {
  if (!shown || shown.picker === open) return;
  shown = { ...shown, picker: open };
  emit();
}

export function aiGenerateBack(): boolean {
  if (!shown) return false;
  if (shown.picker) {
    setAiGeneratePicker(false);
    return true;
  }
  const open = current();
  if (open && open.session.job.state !== "working" && open.session.draft.kind === "slides" && open.session.draft.slidesStep === "outline") {
    updateAiGenerateDraft((draft) => ({ ...draft, slidesStep: "compose" }));
    return true;
  }
  return closeAiGenerate();
}

function persist(key: string, session: Session) {
  if (scope) writeAiGenerateDraft(scope, key, session.draft);
}

function current() {
  const session = shown ? sessions.get(shown.key) : undefined;
  return shown && session ? { key: shown.key, session } : null;
}

export function updateAiGenerateDraft(change: (draft: AiGenerateDraft) => AiGenerateDraft) {
  const open = current();
  if (!open || open.session.job.state === "working" || open.session.job.state === "done") return;
  open.session.draft = change(open.session.draft);
  if (open.session.job.state === "error") open.session.job = { state: "idle" };
  persist(open.key, open.session);
  emit();
}

export function syncAiGenerateNotes(pages: WizardNote[]) {
  const open = current();
  if (!open || open.session.job.state === "working") return;
  const byId = new Map(pages.map((page) => [page.id, page]));
  const notes = open.session.draft.notes.flatMap((note) => {
    const page = byId.get(note.id);
    return page ? [{ id: page.id, title: page.title, icon: page.icon }] : [];
  });
  if (JSON.stringify(notes) === JSON.stringify(open.session.draft.notes)) return;
  open.session.draft = { ...open.session.draft, notes };
  persist(open.key, open.session);
  emit();
}

export function startOverAiGenerate() {
  const open = current();
  if (!open || open.session.job.state === "working") return;
  if (scope) removeAiGenerateDraft(scope, open.key);
  open.session.draft = newAiGenerateDraft(open.session.draft.kind);
  open.session.job = { state: "idle" };
  if (shown) shown = { ...shown, picker: false };
  emit();
}

export function dismissAiGenerateError() {
  const open = current();
  if (open?.session.job.state !== "error") return;
  open.session.job = { state: "idle" };
  emit();
}

function slidesSourceFrom(draft: AiGenerateDraft): SlidesSource | null {
  const cleaned = cleanPromptText(draft.prompt);
  if (draft.notes.length > 0) {
    return parseSource({
      type: "notes",
      pageIds: draft.notes.map((note) => note.id),
      ...(cleaned ? { instructions: cleaned } : {}),
    });
  }
  return parseSource({ type: "topic", topic: cleaned });
}

function slidesOptionsFrom(draft: AiGenerateDraft): SlidesOptions | null {
  return parseOptions({ ...draft.slidesOptions, language: draft.language });
}

export function canSubmitAiGenerate(draft: AiGenerateDraft): boolean {
  const cleaned = cleanPromptText(draft.prompt);
  if (cleaned.length > MAX_AI_PROMPT_CHARS) return false;
  if (draft.kind === "slides") {
    const source = slidesSourceFrom(draft);
    const options = slidesOptionsFrom(draft);
    if (!source || !options) return false;
    if (draft.slidesStep === "outline") return parseOutline(draft.slidesOutline) !== null;
    return true;
  }
  return Boolean(cleaned || draft.notes.length > 0);
}

export function canSubmitSlidesOutline(draft: AiGenerateDraft): boolean {
  return slidesSourceFrom(draft) !== null && slidesOptionsFrom(draft) !== null;
}

export function canSubmitSlidesDeck(draft: AiGenerateDraft): boolean {
  return canSubmitSlidesOutline(draft) && parseOutline(draft.slidesOutline) !== null;
}

function failedMessageFor(stage: AiGenerateStage): string {
  if (stage === "note") return AI_GENERATE_NOTE_FAILED;
  if (stage === "whiteboard") return AI_GENERATE_WHITEBOARD_FAILED;
  return AI_GENERATE_SLIDES_FAILED;
}

export async function submitAiGenerate({
  flush,
  fresh = false,
  stageOverride,
  embedded = false,
}: {
  flush?: SlidesFlush;
  fresh?: boolean;
  stageOverride?: "slides-outline" | "slides-deck";
  embedded?: boolean;
} = {}) {
  const open = current();
  if (!open || !shown) return;
  const { key, session } = open;
  if (session.job.state === "working" || session.job.state === "done") return;

  const { draft, placement } = session;
  const model = shown.model;
  const stage: AiGenerateStage = stageOverride
    ?? (draft.kind === "note"
      ? "note"
      : draft.kind === "whiteboard"
        ? "whiteboard"
        : draft.slidesStep === "outline"
          ? "slides-deck"
          : "slides-outline");

  let url = "/api/pages/generate";
  let payload: Record<string, unknown> | null = null;
  const noteIds = draft.notes.map((note) => note.id);

  if (stage === "note" || stage === "whiteboard") {
    const cleaned = cleanPromptText(draft.prompt);
    if ((!cleaned && !noteIds.length) || cleaned.length > MAX_AI_PROMPT_CHARS) return;
    payload = {
      kind: stage,
      prompt: cleaned,
      ...(noteIds.length ? { noteIds } : {}),
      language: draft.language,
      ...(stage === "note" ? { noteStyle: draft.noteStyle } : { whiteboardStructure: draft.whiteboardStructure }),
      ...(placement.parentId ? { parentId: placement.parentId } : placement.groupId ? { groupId: placement.groupId } : {}),
      ...(model ? { model } : {}),
    };
  } else if (stage === "slides-outline") {
    const source = slidesSourceFrom(draft);
    const options = slidesOptionsFrom(draft);
    if (!source || !options) return;
    url = "/api/pages/slides/outline";
    payload = { source, options, ...(model ? { model } : {}) };
  } else {
    const source = slidesSourceFrom(draft);
    const options = slidesOptionsFrom(draft);
    const outline = parseOutline(draft.slidesOutline);
    if (!source || !options || !outline) return;
    url = "/api/pages/slides/deck";
    payload = {
      source,
      options,
      outline,
      ...(placement.parentId ? { parentId: placement.parentId } : placement.groupId ? { groupId: placement.groupId } : {}),
      ...(model ? { model } : {}),
    };
  }

  if (!payload) return;

  const started = generation;
  const live = () => started === generation && sessions.get(key) === session;
  const finish = (job: AiGenerateJob) => {
    session.job = job;
    emit();
  };
  const fail = (message: string, status: number, tier?: UsageTier) => {
    if (tier) saveAiGenerateLimitDraft(session.draft, embedded);
    finish({ state: "error", stage, message, status, ...(tier ? { limit: { tier } } : {}) });
  };

  shown = { ...shown, picker: false };
  finish({ state: "working", stage });

  if (noteIds.length > 0 && flush) {
    let saved = false;
    try {
      saved = await flush(noteIds);
    } catch {
      saved = false;
    }
    if (!live()) return;
    if (!saved) {
      fail(UNSAVED_NOTE, 0);
      return;
    }
  }

  const bodyKey = JSON.stringify(payload);
  const previous = session.draft.request;
  const clientRequestId = !fresh && previous?.stage === stage && previous.key === bodyKey
    ? previous.clientRequestId
    : crypto.randomUUID();
  session.draft = { ...session.draft, request: { stage, clientRequestId, key: bodyKey } };
  persist(key, session);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, clientRequestId }),
    });
    const data: unknown = await response.json().catch(() => null);
    if (!live()) return;
    const result = data && typeof data === "object" ? (data as Record<string, unknown>) : {};

    if (response.ok && stage === "slides-outline") {
      const outline = parseOutline(result.outline);
      if (outline) {
        const next: AiGenerateDraft = {
          ...session.draft,
          slidesStep: "outline",
          slidesOutline: outline,
          slidesPartial: result.partial === true,
        };
        delete next.request;
        session.draft = next;
        persist(key, session);
        finish({ state: "idle" });
        return;
      }
    } else if (response.ok) {
      const page = result.page as NotePageSummary | undefined;
      if (typeof page?.id === "string") {
        if (scope) removeAiGenerateDraft(scope, key);
        const doneKind: AiGenerateKind = stage === "note" ? "note" : stage === "whiteboard" ? "whiteboard" : "slides";
        if (stage === "slides-deck") {
          const imageTasks = parseSlideImageTasks(result.imageTasks);
          if (imageTasks.length) startSlideImageJob(page.id, imageTasks);
        }
        finish({ state: "done", kind: doneKind, page, partial: result.partial === true });
        window.dispatchEvent(new CustomEvent("notefable:page-created", { detail: page }));
        postToNative({ type: "pagesChanged" });
        return;
      }
    }

    if (response.status === 404) {
      delete session.draft.request;
      persist(key, session);
    }
    const fallback = failedMessageFor(stage);
    const message = SERVER_REASONS.has(response.status) && typeof result.error === "string" && result.error
      ? result.error
      : fallback;
    fail(message, response.status, usageLimitErrorFrom(response.status, result)?.tier);
  } catch {
    if (live()) fail(failedMessageFor(stage), 0);
  }
}

export function resetAiGenerate() {
  generation += 1;
  sessions.clear();
  scope = null;
  shown = null;
  emit();
}
