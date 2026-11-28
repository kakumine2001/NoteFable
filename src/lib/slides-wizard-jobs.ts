import { UNSAVED_NOTE } from "@/lib/draw-diagram-jobs";
import { msg } from "@/lib/i18n/translate";
import { postToNative } from "@/lib/native-bridge";
import { parseOptions, parseOutline, parseSource, type SlidesOptions, type SlidesOutline, type SlidesSource } from "@/lib/slides/ai-wizard";
import {
  fitSlidesSource, newSlidesDraft, readSlidesDraft, removeSlidesDraft, slidesEntryKey, writeSlidesDraft,
  type SlidesDraft, type SlidesEntry, type WizardNote,
} from "@/lib/slides-wizard-draft";
import {
  isAnySlideImageJobWorking, isSlideImageJobWorking, parseSlideImageTasks, resetSlideImageJobs, startSlideImageJob, subscribeSlideImageJobs,
} from "@/lib/slides-image-jobs";
import { usageLimitErrorFrom, type UsageTier } from "@/lib/usage-plans";
import type { NotePageSummary } from "@/types/notes";

// 「AI でスライドを作る」の窓の状態と要求（docs/architecture/slides.md の「AI 生成幻灯片」）。
// 状態は入口ごとに部品の外に持つので、窓を閉じても要求は続く（大綱は下書きに書き、スライドは "notefable:page-created" で一覧に加わる）。
// 窓（SlidesWizardHost）は画面に 1 つだけ置き、どの入口（チャットの「＋」・ノートの「…」と AI パネル・新規作成・アプリ）からもここで開く。
// clientRequestId は下書きに持つ：返事を受け取れていない同じ内容の要求は、同じ ID で送り直す。自動では送り直さない。

export type SlidesStage = "outline" | "deck";

export type SlidesJob =
  | { state: "idle" }
  | { state: "working"; stage: SlidesStage }
  // partial: 材料が長く前の部分だけを使った・枚数の上限で一部を落とした。
  | { state: "done"; page: NotePageSummary; partial: boolean }
  // status: 応答の HTTP の番号（要求できなかったときは 0）。limit: 使用回数の上限（429 usage_limit）。
  | { state: "error"; stage: SlidesStage; message: string; status: number; limit?: { tier: UsageTier } };

export type SlidesWizardView =
  // 下書きを分ける値（scope）を読んでいる・読めなかった。
  | { key: string; phase: "loading" | "failed" }
  // picker: 材料のノートを選ぶ面を重ねて出している。
  | { key: string; phase: "ready"; entry: SlidesEntry; draft: SlidesDraft; job: SlidesJob; picker: boolean };

// 要求の前に、材料にするノートのうち開いているものの入力中の内容を保存する。保存し切れなければ false。
export type SlidesFlush = (pageIds: string[]) => Promise<boolean>;

export const SLIDES_FAILED = msg("Could not generate slides. Try again.");
const SCOPE_URL = "/api/pages/slides/outline";
// サーバーの理由をそのまま見せる応答（検証・見つからない・実行中・大きすぎる・上限）。他は共通の文。
const SERVER_REASONS = new Set([400, 404, 409, 413, 429]);

type Session = { entry: SlidesEntry; draft: SlidesDraft; job: SlidesJob };

// 入口の鍵（slidesEntryKey）ごと。
const sessions = new Map<string, Session>();
// 下書きを利用者ごとに分ける値。窓を開くたびに確かめ直す。
let scope: string | null = null;
let scopeRequest = 0;
// いま出している窓。
let shown: { key: string; entry: SlidesEntry; model: string; picker: boolean; failed: boolean } | null = null;
let view: SlidesWizardView | null = null;
// 利用者が替わったら上げる。替わる前の要求の結果は捨てる。
let generation = 0;
const listeners = new Set<() => void>();

function emit() {
  if (!shown) view = null;
  else {
    const session = sessions.get(shown.key);
    view = session
      ? { key: shown.key, phase: "ready", entry: session.entry, draft: session.draft, job: session.job, picker: shown.picker }
      : { key: shown.key, phase: shown.failed ? "failed" : "loading" };
  }
  listeners.forEach((listener) => listener());
}

export function subscribeSlidesWizard(listener: () => void) {
  listeners.add(listener);
  const stopImages = subscribeSlideImageJobs(listener);
  return () => {
    listeners.delete(listener);
    stopImages();
  };
}

export function getSlidesWizard(): SlidesWizardView | null {
  return view;
}

// メニューの項目が「作成中」を出すのに使う。
export function getSlidesJobState(key: string): SlidesJob["state"] {
  return sessions.get(key)?.job.state ?? "idle";
}

// ノートを入口にしたスライドを作っている最中のノート（アプリの「…」メニューの「作成中」。getSlidesJobState("note:<id>") と同じ条件）。
export function workingSlidesNoteIds(): string[] {
  return [...sessions.values()]
    .flatMap((session) => (session.entry.type === "note" && session.job.state === "working" ? [session.entry.pageId] : []))
    .sort();
}

export function isSlidesWizardBusy() {
  return [...sessions.values()].some((session) => session.job.state === "working") || isAnySlideImageJobWorking();
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
    if (!sessions.has(shown.key)) { shown = { ...shown, failed: true }; emit(); }
    return;
  }
  // 利用者が替わった：前の利用者の下書きと要求の結果は出さない。
  if (scope !== null && scope !== next) sessions.clear();
  scope = next;
  if (!sessions.has(shown.key)) {
    sessions.set(shown.key, { entry: shown.entry, draft: readSlidesDraft(next, shown.entry) ?? newSlidesDraft(shown.entry), job: { state: "idle" } });
  }
  emit();
}

// 見せ終わった結果は忘れる（出来た：次は新しく作る。失敗：下書きは残し、失敗の表示だけ消す）。進行中のものは残す。
function dismissFinished(key: string) {
  const session = sessions.get(key);
  if (session?.job.state === "done") {
    if (!isSlideImageJobWorking(session.job.page.id)) sessions.delete(key);
  } else if (session?.job.state === "error") {
    session.job = { state: "idle" };
  }
}

// model はいま選んでいるチャットモデル（サーバーはそのモデルの既定の推論強度で呼ぶ）。
export function openSlidesWizard({ entry, model }: { entry: SlidesEntry; model: string }) {
  const key = slidesEntryKey(entry);
  if (shown && shown.key !== key) dismissFinished(shown.key);
  shown = { key, entry, model, picker: false, failed: false };
  const session = sessions.get(key);
  if (session) {
    session.entry = entry;
    if (session.job.state !== "working") session.draft = { ...session.draft, source: fitSlidesSource(session.draft.source, entry) };
  }
  emit();
  void loadScope();
}

export function retrySlidesWizardLoad() {
  if (!shown?.failed) return;
  shown = { ...shown, failed: false };
  emit();
  void loadScope();
}

// 利用者が閉じた：下書きと進行中の要求は残す。
export function closeSlidesWizard(): boolean {
  if (!shown) return false;
  dismissFinished(shown.key);
  shown = null;
  emit();
  return true;
}

// アプリが別のページへ移った・編集画面を閉じた：窓を隠すだけ（要求と結果も残す）。
export function hideSlidesWizard(): boolean {
  if (!shown) return false;
  shown = null;
  emit();
  return true;
}

export function setSlidesPicker(open: boolean) {
  if (!shown || shown.picker === open) return;
  shown = { ...shown, picker: open };
  emit();
}

// 端末の「戻る」（アプリから）：一番上の面を閉じる。ノートを選ぶ面、次に窓。何も開いていなければ false。
export function slidesWizardBack(): boolean {
  if (!shown) return false;
  if (shown.picker) { setSlidesPicker(false); return true; }
  return closeSlidesWizard();
}

function persist(key: string, session: Session) {
  if (scope) writeSlidesDraft(scope, key, session.draft);
}

function current() {
  const session = shown ? sessions.get(shown.key) : undefined;
  return shown && session ? { key: shown.key, session } : null;
}

// 利用者の編集。要求の間と、出来たあとは受け付けない。
export function updateSlidesDraft(change: (draft: SlidesDraft) => SlidesDraft) {
  const open = current();
  if (!open || open.session.job.state === "working" || open.session.job.state === "done") return;
  open.session.draft = change(open.session.draft);
  // 直したら、前の失敗の表示は消す。
  if (open.session.job.state === "error") open.session.job = { state: "idle" };
  persist(open.key, open.session);
  emit();
}

// ノートの一覧が読めたら、選んであるノートの題名とアイコンを今のものにそろえ、なくなったノートを外す
// （ノートから開いた窓のそのノートは残す。無ければサーバーが「Note not found.」と答える）。
export function syncSlidesNotes(pages: WizardNote[]) {
  const open = current();
  if (!open || open.session.job.state === "working") return;
  const { draft, entry } = open.session;
  const byId = new Map(pages.map((page) => [page.id, page]));
  const notes = draft.source.notes.flatMap((note) => {
    const page = byId.get(note.id);
    if (page) return [{ id: page.id, title: page.title, icon: page.icon }];
    return entry.type === "note" && entry.pageId === note.id ? [note] : [];
  });
  if (JSON.stringify(notes) === JSON.stringify(draft.source.notes)) return;
  open.session.draft = { ...draft, source: { ...draft.source, notes } };
  emit();
}

// 下書きを捨てて最初から。
export function startOverSlides() {
  const open = current();
  if (!open || open.session.job.state === "working") return;
  if (scope) removeSlidesDraft(scope, open.key);
  open.session.draft = newSlidesDraft(open.session.entry);
  open.session.job = { state: "idle" };
  if (shown) shown = { ...shown, picker: false };
  emit();
}

// スライドを作れなかった画面から大綱へ戻る。
export function dismissSlidesError() {
  const open = current();
  if (open?.session.job.state !== "error") return;
  open.session.job = { state: "idle" };
  emit();
}

export type SlidesRequestInput = { source: SlidesSource; options: SlidesOptions; outline?: SlidesOutline; groupId?: string; parentId?: string };

// 下書きから要求の中身を作る。足りない・直す必要があるときは null（ボタンを押せなくする）。
export function slidesRequestInput(stage: SlidesStage, draft: SlidesDraft, entry: SlidesEntry): SlidesRequestInput | null {
  const { type, topic, notes, chat } = draft.source;
  const source = parseSource(
    type === "topic" ? { type, topic }
      : type === "notes" ? { type, pageIds: notes.map((note) => note.id) }
        : { type, sessionId: chat?.sessionId },
  );
  const options = parseOptions(draft.options);
  if (!source || !options) return null;
  if (stage === "outline") return { source, options };
  const outline = parseOutline(draft.outline);
  if (!outline) return null;
  const input: SlidesRequestInput = { source, options, outline };
  // 作る場所は「新しいスライド」の入口だけが指定する（他はサーバーが決める）。
  if (entry.type === "new" && entry.parentId) input.parentId = entry.parentId;
  else if (entry.type === "new" && entry.groupId) input.groupId = entry.groupId;
  return input;
}

// 大綱（stage: "outline"）かスライド（"deck"）を頼む。fresh は新しい clientRequestId を使う（大綱の作り直し）。
// 生成には時間がかかるので、ブラウザ側では時間で打ち切らない（サーバーは 300 秒まで待つ）。
export async function requestSlides(stage: SlidesStage, { flush, fresh = false }: { flush?: SlidesFlush; fresh?: boolean } = {}) {
  const open = current();
  if (!open || !shown) return;
  const { key, session } = open;
  const model = shown.model;
  if (session.job.state === "working" || session.job.state === "done") return;
  const input = slidesRequestInput(stage, session.draft, session.entry);
  if (!input) return;
  const started = generation;
  const live = () => started === generation && sessions.get(key) === session;
  const finish = (job: SlidesJob) => { session.job = job; emit(); };
  const fail = (message: string, status: number, tier?: UsageTier) => finish({ state: "error", stage, message, status, ...(tier ? { limit: { tier } } : {}) });

  shown = { ...shown, picker: false };
  finish({ state: "working", stage });

  if (input.source.type === "notes" && flush) {
    let saved = false;
    try {
      saved = await flush(input.source.pageIds);
    } catch {
      saved = false;
    }
    if (!live()) return;
    if (!saved) { fail(UNSAVED_NOTE, 0); return; }
  }

  const body = { ...input, model };
  const bodyKey = JSON.stringify(body);
  const previous = session.draft.request;
  const clientRequestId = !fresh && previous?.stage === stage && previous.key === bodyKey ? previous.clientRequestId : crypto.randomUUID();
  session.draft = { ...session.draft, request: { stage, clientRequestId, key: bodyKey } };
  persist(key, session);

  try {
    const response = await fetch(`/api/pages/slides/${stage}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, clientRequestId }),
    });
    const data: unknown = await response.json().catch(() => null);
    if (!live()) return;
    const result = data && typeof data === "object" ? data as Record<string, unknown> : {};
    if (response.ok && stage === "outline") {
      const outline = parseOutline(result.outline);
      if (outline) {
        const next: SlidesDraft = { ...session.draft, step: "outline", outline, partial: result.partial === true };
        delete next.request;
        session.draft = next;
        persist(key, session);
        finish({ state: "idle" });
        return;
      }
    } else if (response.ok) {
      const page = result.page as NotePageSummary | undefined;
      if (typeof page?.id === "string") {
        // 出来たので下書きは要らない。
        if (scope) removeSlidesDraft(scope, key);
        const imageTasks = parseSlideImageTasks(result.imageTasks);
        if (imageTasks.length) startSlideImageJob(page.id, imageTasks);
        finish({ state: "done", page, partial: result.partial === true });
        // 一覧（サイドバー・ホーム）に加える。サーバーが返すのは一覧用の形（本体を含まない）。
        window.dispatchEvent(new CustomEvent("notefable:page-created", { detail: page }));
        // アプリの WebView では、アプリの一覧に知らせる（ブラウザーでは何もしない）。
        postToNative({ type: "pagesChanged" });
        return;
      }
    }
    // 404 は作る前の失敗か、出来たページがゴミ箱にある。次は新しい要求にする。
    if (response.status === 404) {
      delete session.draft.request;
      persist(key, session);
    }
    const message = SERVER_REASONS.has(response.status) && typeof result.error === "string" && result.error ? result.error : SLIDES_FAILED;
    fail(message, response.status, usageLimitErrorFrom(response.status, result)?.tier);
  } catch {
    if (live()) fail(SLIDES_FAILED, 0);
  }
}

// 利用者が替わった・テストの後始末：下書きの状態と要求を忘れる（localStorage の下書きは残す）。
export function resetSlidesWizard() {
  generation += 1;
  sessions.clear();
  scope = null;
  shown = null;
  resetSlideImageJobs();
  emit();
}
