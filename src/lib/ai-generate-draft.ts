import {
  DEFAULT_NOTE_GENERATE_OPTIONS,
  DEFAULT_WHITEBOARD_GENERATE_OPTIONS,
  isAiGenerateKind,
  MAX_AI_PROMPT_CHARS,
  MAX_AI_SOURCE_NOTES,
  parseNoteGenerateOptions,
  parseWhiteboardGenerateOptions,
  type AiGenerateKind,
  type NoteGenerateStyle,
  type WhiteboardGenerateStructure,
} from "@/lib/ai-generate";
import { isLocale, type Locale } from "@/lib/i18n/locale";
import { isClientRequestId, isRecordId } from "@/lib/page-ai/ids";
import {
  DEFAULT_SLIDES_OPTIONS,
  MAX_OUTLINE_SLIDES,
  MAX_OUTLINE_TITLE_CHARS,
  MAX_POINT_CHARS,
  MAX_SLIDE_POINTS,
  MAX_SLIDE_TITLE_CHARS,
  parseOptions,
  type SlidesOptions,
  type SlidesOutline,
} from "@/lib/slides/ai-wizard";
import type { WizardNote } from "@/lib/slides-wizard-draft";

// 統合「AI で生成」パネル（ノート・ホワイトボード・スライド）の下書き保存。
// 利用者（scope）と作り先（placementKey）ごとに localStorage に保存し、リロード・ログイン遷移・アップグレード遷移でも入力を失わない。

export type AiGeneratePlacement = {
  groupId?: string | null;
  parentId?: string | null;
};

export type AiGenerateStage = "note" | "whiteboard" | "slides-outline" | "slides-deck";

export type AiGenerateRequestRecord = {
  stage: AiGenerateStage;
  clientRequestId: string;
  key: string;
};

export type AiGenerateDraft = {
  v: 1;
  updatedAt: number;
  kind: AiGenerateKind;
  prompt: string;
  notes: WizardNote[];
  language: "auto" | Locale;
  noteStyle: NoteGenerateStyle;
  whiteboardStructure: WhiteboardGenerateStructure;
  slidesOptions: SlidesOptions;
  slidesStep: "compose" | "outline";
  slidesOutline: SlidesOutline | null;
  slidesPartial?: boolean;
  request?: AiGenerateRequestRecord;
};

export const AI_GENERATE_DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const AI_GENERATE_DRAFTS_PER_SCOPE = 10;
const PREFIX = "notefable:ai-generate:v1:";

export function aiGeneratePlacementKey(placement: AiGeneratePlacement): string {
  if (placement.parentId) return `p:${placement.parentId}`;
  return placement.groupId ? `g:${placement.groupId}` : "root";
}

const storageKey = (scope: string, placementKey: string) => `${PREFIX}${scope}:${placementKey}`;

const defaultSlidesOptions = (): SlidesOptions => ({
  ...DEFAULT_SLIDES_OPTIONS,
  theme: { ...DEFAULT_SLIDES_OPTIONS.theme },
});

export function newAiGenerateDraft(kind: AiGenerateKind = "note"): AiGenerateDraft {
  return {
    v: 1,
    updatedAt: Date.now(),
    kind,
    prompt: "",
    notes: [],
    language: "auto",
    noteStyle: DEFAULT_NOTE_GENERATE_OPTIONS.style,
    whiteboardStructure: DEFAULT_WHITEBOARD_GENERATE_OPTIONS.structure,
    slidesOptions: defaultSlidesOptions(),
    slidesStep: "compose",
    slidesOutline: null,
  };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isText = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length <= max;

function readNotes(value: unknown): WizardNote[] | null {
  if (!Array.isArray(value)) return null;
  const notes: WizardNote[] = [];
  for (const item of value) {
    if (!isObject(item) || !isRecordId(item.id) || typeof item.title !== "string") return null;
    if (item.icon !== null && typeof item.icon !== "string") return null;
    if (notes.length < MAX_AI_SOURCE_NOTES && !notes.some((existing) => existing.id === item.id)) {
      notes.push({ id: item.id, title: item.title, icon: item.icon });
    }
  }
  return notes;
}

function readOutline(value: unknown): SlidesOutline | null {
  if (!isObject(value) || !isText(value.title, MAX_OUTLINE_TITLE_CHARS) || !Array.isArray(value.slides)) return null;
  if (!value.slides.length || value.slides.length > MAX_OUTLINE_SLIDES) return null;
  const slides: SlidesOutline["slides"] = [];
  for (const slide of value.slides) {
    if (!isObject(slide) || !isText(slide.title, MAX_SLIDE_TITLE_CHARS) || !Array.isArray(slide.points) || slide.points.length > MAX_SLIDE_POINTS) {
      return null;
    }
    if (!slide.points.every((point) => isText(point, MAX_POINT_CHARS))) return null;
    slides.push({ title: slide.title, points: [...(slide.points as string[])] });
  }
  return { title: value.title, slides };
}

export function parseAiGenerateDraft(raw: string | null): AiGenerateDraft | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(value) || value.v !== 1 || typeof value.updatedAt !== "number") return null;
  if (Date.now() - value.updatedAt > AI_GENERATE_DRAFT_MAX_AGE_MS) return null;
  if (!isAiGenerateKind(value.kind) || !isText(value.prompt, MAX_AI_PROMPT_CHARS)) return null;
  const notes = readNotes(value.notes);
  if (!notes) return null;
  const language = value.language === "auto" || isLocale(value.language) ? value.language : "auto";
  const noteOpt = parseNoteGenerateOptions({ style: value.noteStyle, language });
  const wbOpt = parseWhiteboardGenerateOptions({ structure: value.whiteboardStructure, language });
  const slidesOptions = parseOptions(value.slidesOptions);
  if (!noteOpt || !wbOpt || !slidesOptions) return null;
  const slidesOutline = readOutline(value.slidesOutline);
  const draft: AiGenerateDraft = {
    v: 1,
    updatedAt: value.updatedAt,
    kind: value.kind,
    prompt: value.prompt,
    notes,
    language,
    noteStyle: noteOpt.style,
    whiteboardStructure: wbOpt.structure,
    slidesOptions,
    slidesStep: value.slidesStep === "outline" && slidesOutline ? "outline" : "compose",
    slidesOutline,
  };
  if (value.slidesPartial === true) draft.slidesPartial = true;
  const req = value.request;
  if (
    isObject(req)
    && (req.stage === "note" || req.stage === "whiteboard" || req.stage === "slides-outline" || req.stage === "slides-deck")
    && isClientRequestId(req.clientRequestId)
    && typeof req.key === "string"
  ) {
    draft.request = { stage: req.stage, clientRequestId: req.clientRequestId, key: req.key };
  }
  return draft;
}

export function readAiGenerateDraft(scope: string, placementKey: string): AiGenerateDraft | null {
  const key = storageKey(scope, placementKey);
  try {
    const raw = localStorage.getItem(key);
    const draft = parseAiGenerateDraft(raw);
    if (!draft) {
      if (raw !== null) localStorage.removeItem(key);
      return null;
    }
    return draft;
  } catch {
    return null;
  }
}

function prune(scope: string) {
  const prefix = `${PREFIX}${scope}:`;
  const keys: string[] = [];
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (key?.startsWith(prefix)) keys.push(key);
  }
  const live = keys.flatMap((key) => {
    const draft = parseAiGenerateDraft(localStorage.getItem(key));
    if (draft) return [{ key, updatedAt: draft.updatedAt }];
    localStorage.removeItem(key);
    return [];
  });
  live.sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(AI_GENERATE_DRAFTS_PER_SCOPE)
    .forEach(({ key }) => localStorage.removeItem(key));
}

export function writeAiGenerateDraft(scope: string, placementKey: string, draft: AiGenerateDraft) {
  const key = storageKey(scope, placementKey);
  try {
    const added = localStorage.getItem(key) === null;
    localStorage.setItem(key, JSON.stringify({ ...draft, updatedAt: Date.now() }));
    if (added) prune(scope);
  } catch { /* Private mode or quota error: keep in-memory draft working. */ }
}

export function removeAiGenerateDraft(scope: string, placementKey: string) {
  try {
    localStorage.removeItem(storageKey(scope, placementKey));
  } catch { /* Ignore storage errors. */ }
}
