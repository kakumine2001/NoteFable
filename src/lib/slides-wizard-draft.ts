import { isClientRequestId, isRecordId } from "@/lib/page-ai/ids";
import {
  DEFAULT_SLIDES_OPTIONS, MAX_OUTLINE_SLIDES, MAX_OUTLINE_TITLE_CHARS, MAX_POINT_CHARS, MAX_SLIDE_POINTS, MAX_SLIDE_TITLE_CHARS,
  MAX_SLIDES_SOURCE_NOTES, MAX_TOPIC_CHARS, parseOptions, type SlidesOptions, type SlidesOutline,
} from "@/lib/slides/ai-wizard";

// 「AI でスライドを作る」の窓の下書き（docs/architecture/slides.md の「AI 生成幻灯片」）。
// 材料・設定・大綱を端末の localStorage に、利用者（scope）と入口ごとに分けて置き、窓を閉じても・読み直しても続きから出す。
// 保存できない端末（プライベートモードなど）でも窓は使える：読み書きはすべて失敗を無視する。

// 窓の入口。アプリが window.notefableEmbed.slidesWizard で渡す source と同じ形（title・icon は表示に使うだけ）。
// new の groupId / parentId は作る場所（プロジェクトの「+」・ページ行の「+」）。
export type SlidesEntry =
  | { type: "new"; groupId?: string | null; parentId?: string | null }
  | { type: "note"; pageId: string; title?: string; icon?: string | null }
  | { type: "chat"; sessionId: string; title?: string };

export type WizardNote = { id: string; title: string; icon: string | null };

export type WizardSource = {
  type: "topic" | "notes" | "chat";
  topic: string;
  notes: WizardNote[];
  chat?: { sessionId: string; title: string };
};

// 返事を受け取れていない要求。同じ内容を送り直すときは同じ clientRequestId を使う（二重に作らず数え直さない）。
// key は clientRequestId を除いた要求の本文。
export type WizardRequest = { stage: "outline" | "deck"; clientRequestId: string; key: string };

export type SlidesDraft = {
  v: 1;
  updatedAt: number;
  step: "source" | "outline";
  source: WizardSource;
  options: SlidesOptions;
  // 編集中の大綱。題名が空の間もそのまま持つ（送る前に parseOutline で確かめる）。
  outline: SlidesOutline | null;
  // 材料が長く、前の部分だけで大綱を作った。
  partial?: boolean;
  request?: WizardRequest;
};

export const DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const DRAFTS_PER_SCOPE = 10;
const PREFIX = "notefable:slides-wizard:v1:";

export function slidesEntryKey(entry: SlidesEntry) {
  if (entry.type === "note") return `note:${entry.pageId}`;
  if (entry.type === "chat") return `chat:${entry.sessionId}`;
  if (entry.parentId) return `new:p:${entry.parentId}`;
  return entry.groupId ? `new:g:${entry.groupId}` : "new";
}

const storageKey = (scope: string, entryKey: string) => `${PREFIX}${scope}:${entryKey}`;

const defaultOptions = (): SlidesOptions => ({ ...DEFAULT_SLIDES_OPTIONS, theme: { ...DEFAULT_SLIDES_OPTIONS.theme } });

// 入口に合う材料にそろえる：ノートから開いた窓はそのノートを必ず含み、チャットから開いた窓はその会話に固定する。
// 「新しいスライド」の窓の材料はテーマかノート。
export function fitSlidesSource(source: WizardSource, entry: SlidesEntry): WizardSource {
  if (entry.type === "chat") {
    const title = entry.title || (source.chat?.sessionId === entry.sessionId ? source.chat.title : "");
    return { ...source, type: "chat", chat: { sessionId: entry.sessionId, title } };
  }
  const type = entry.type === "note" ? "notes" : source.type === "notes" ? "notes" : "topic";
  const next: WizardSource = { type, topic: source.topic, notes: source.notes };
  if (entry.type !== "note") return next;
  const current = source.notes.find((note) => note.id === entry.pageId);
  const own = { id: entry.pageId, title: entry.title || current?.title || "", icon: entry.icon !== undefined ? entry.icon : current?.icon ?? null };
  next.notes = [own, ...source.notes.filter((note) => note.id !== entry.pageId)].slice(0, MAX_SLIDES_SOURCE_NOTES);
  return next;
}

export function newSlidesDraft(entry: SlidesEntry): SlidesDraft {
  return {
    v: 1, updatedAt: Date.now(), step: "source",
    source: fitSlidesSource({ type: "topic", topic: "", notes: [] }, entry),
    options: defaultOptions(), outline: null,
  };
}

const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max;

function readSource(value: unknown): WizardSource | null {
  if (!object(value) || !["topic", "notes", "chat"].includes(value.type as string)) return null;
  if (!text(value.topic, MAX_TOPIC_CHARS) || !Array.isArray(value.notes)) return null;
  const notes: WizardNote[] = [];
  for (const note of value.notes) {
    if (!object(note) || !isRecordId(note.id) || typeof note.title !== "string") return null;
    if (note.icon !== null && typeof note.icon !== "string") return null;
    if (notes.length < MAX_SLIDES_SOURCE_NOTES && !notes.some((item) => item.id === note.id)) notes.push({ id: note.id, title: note.title, icon: note.icon });
  }
  const source: WizardSource = { type: value.type as WizardSource["type"], topic: value.topic, notes };
  if (object(value.chat) && isRecordId(value.chat.sessionId) && typeof value.chat.title === "string") {
    source.chat = { sessionId: value.chat.sessionId, title: value.chat.title };
  }
  return source;
}

// 編集の途中（空の題名・空の要点）は許し、上限を超えた値と形の違う値だけを捨てる。
function readOutline(value: unknown): SlidesOutline | null {
  if (!object(value) || !text(value.title, MAX_OUTLINE_TITLE_CHARS) || !Array.isArray(value.slides)) return null;
  if (!value.slides.length || value.slides.length > MAX_OUTLINE_SLIDES) return null;
  const slides: SlidesOutline["slides"] = [];
  for (const slide of value.slides) {
    if (!object(slide) || !text(slide.title, MAX_SLIDE_TITLE_CHARS) || !Array.isArray(slide.points) || slide.points.length > MAX_SLIDE_POINTS) return null;
    if (!slide.points.every((point) => text(point, MAX_POINT_CHARS))) return null;
    slides.push({ title: slide.title, points: [...slide.points as string[]] });
  }
  return { title: value.title, slides };
}

function parseDraft(raw: string | null): SlidesDraft | null {
  if (!raw) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!object(value) || value.v !== 1 || typeof value.updatedAt !== "number") return null;
  if (Date.now() - value.updatedAt > DRAFT_MAX_AGE_MS) return null;
  const source = readSource(value.source);
  const options = parseOptions(value.options);
  if (!source || !options) return null;
  const outline = readOutline(value.outline);
  const draft: SlidesDraft = {
    v: 1, updatedAt: value.updatedAt, step: value.step === "outline" && outline ? "outline" : "source", source, options, outline,
  };
  if (value.partial === true) draft.partial = true;
  const request = value.request;
  if (object(request) && (request.stage === "outline" || request.stage === "deck") && isClientRequestId(request.clientRequestId) && typeof request.key === "string") {
    draft.request = { stage: request.stage, clientRequestId: request.clientRequestId, key: request.key };
  }
  return draft;
}

// 読めない・30 日より古い下書きは消して null。
export function readSlidesDraft(scope: string, entry: SlidesEntry): SlidesDraft | null {
  const key = storageKey(scope, slidesEntryKey(entry));
  try {
    const raw = localStorage.getItem(key);
    const draft = parseDraft(raw);
    if (!draft) {
      if (raw !== null) localStorage.removeItem(key);
      return null;
    }
    return { ...draft, source: fitSlidesSource(draft.source, entry) };
  } catch {
    return null;
  }
}

// 同じ利用者の下書きは新しい方から DRAFTS_PER_SCOPE 件だけ残す。
function prune(scope: string) {
  const prefix = `${PREFIX}${scope}:`;
  const keys: string[] = [];
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (key?.startsWith(prefix)) keys.push(key);
  }
  const live = keys.flatMap((key) => {
    const draft = parseDraft(localStorage.getItem(key));
    if (draft) return [{ key, updatedAt: draft.updatedAt }];
    localStorage.removeItem(key);
    return [];
  });
  live.sort((a, b) => b.updatedAt - a.updatedAt).slice(DRAFTS_PER_SCOPE).forEach(({ key }) => localStorage.removeItem(key));
}

export function writeSlidesDraft(scope: string, entryKey: string, draft: SlidesDraft) {
  const key = storageKey(scope, entryKey);
  try {
    const added = localStorage.getItem(key) === null;
    localStorage.setItem(key, JSON.stringify({ ...draft, updatedAt: Date.now() }));
    if (added) prune(scope);
  } catch { /* 保存できなくても、開いている間の下書きはメモリーに残る。 */ }
}

export function removeSlidesDraft(scope: string, entryKey: string) {
  try {
    localStorage.removeItem(storageKey(scope, entryKey));
  } catch { /* 消せなくても動作は変えない。 */ }
}
