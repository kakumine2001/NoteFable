import { msg } from "@/lib/i18n/translate";
import { postToNative } from "@/lib/native-bridge";
import { usageLimitErrorFrom, type UsageTier } from "@/lib/usage-plans";
import type { NotePageSummary } from "@/types/notes";

// 「画成図」（Draw as diagram）：チャットの回答かノートを、AI が編集できる図にして新しいホワイトボードに置く（POST /api/pages/diagram）。
// 生成には時間がかかるので、窓を閉じても要求は続け、出来たページは "notefable:page-created" で一覧に加わる（Create page と同じ）。
// 状態は元（回答・ノート）ごとに部品の外に持つ。同じ元でもう一度選んでも、進行中・結果を見ていない要求の窓を開き直すだけで、二重に作らない。
// clientRequestId は要求ごとに 1 つ作り、「もう一度」でも同じものを送る（応答だけが失われたときの送り直しで、二重に作らず数え直さない）。
// 終わった結果は窓を閉じたら忘れ、次に選んだら新しい要求（新しい clientRequestId）になる。
// 窓（DrawDiagramHost）は画面に 1 つだけ置き、どの入口（回答の「…」・ノートの「…」・ノートの AI パネル）からもここで開く。

export type DiagramSource = { type: "answer"; sessionId: string; messageId: string } | { type: "note"; pageId: string };

export type DiagramJob =
  | { status: "working" }
  // partial: 材料が長く、前の部分だけを図にした。
  | { status: "done"; page: NotePageSummary; partial: boolean }
  // source: 編集できる図に変換できなかった（422）ときの Mermaid の原文。コピーして他で使える。
  // limit: 使用回数の上限（429 usage_limit）。窓はログイン・アップグレードの案内を出す（アプリの中ではアプリに任せる）。
  | { status: "error"; message: string; source: string | null; limit?: { tier: UsageTier } };

// notice: 要求を始めずに窓だけを開いた理由（ノートの未保存の変更を保存できなかった）。
export type DiagramDialog = { key: string; notice?: string };

type Entry = { source: DiagramSource; model: string; clientRequestId: string; job: DiagramJob };

const FAILED = msg("Could not draw a diagram. Try again.");
export const UNSAVED_NOTE = msg("Resolve the note's unsaved changes first, then ask again.");
// サーバーの理由をそのまま見せる応答（検証・見つからない・大きすぎる・変換できない・上限）。他は共通の文。
const SERVER_REASONS = new Set([400, 404, 413, 422, 429]);

const entries = new Map<string, Entry>();
// ノートを保存している途中の元（二度押しで保存と要求を重ねない）。
const flushing = new Set<string>();
let dialog: DiagramDialog | null = null;
// アカウントが替わったら上げる。替わる前に押した操作（ノートの保存待ち）を続けない。
let generation = 0;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

export function subscribeDiagramJobs(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function diagramKey(source: DiagramSource) {
  return source.type === "answer" ? `answer:${source.sessionId}\n${source.messageId}` : `note:${source.pageId}`;
}

export function getDiagramJob(key: string): DiagramJob | null {
  return entries.get(key)?.job ?? null;
}

export function getDiagramDialog(): DiagramDialog | null {
  return dialog;
}

export function openDiagramDialog(key: string, notice?: string) {
  dialog = notice ? { key, notice } : { key };
  emit();
}

// 窓を隠すだけ（要求と結果は残す）。結果を忘れるのは dismissDiagramJob。
export function closeDiagramDialog() {
  if (!dialog) return;
  dialog = null;
  emit();
}

export function diagramErrorMessage(status: number, data: Record<string, unknown>) {
  if (SERVER_REASONS.has(status) && typeof data.error === "string" && data.error) return data.error;
  return FAILED;
}

function requestBody(entry: Entry) {
  const target = entry.source.type === "answer" ? { source: "answer", messageId: entry.source.messageId } : { source: "note", pageId: entry.source.pageId };
  return { ...target, model: entry.model, clientRequestId: entry.clientRequestId };
}

function update(key: string, entry: Entry, job: DiagramJob) {
  // 窓を閉じて忘れた・アカウントが替わった（resetDiagramJobs）後に届いた結果は使わない。
  if (entries.get(key) !== entry) return false;
  entry.job = job;
  emit();
  return true;
}

// 生成は 10〜90 秒ほどかかる（サーバーは 300 秒まで待つ）。Create page と同じく、ブラウザ側では時間で打ち切らない。
async function run(key: string, entry: Entry) {
  entry.job = { status: "working" };
  emit();
  try {
    const response = await fetch("/api/pages/diagram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody(entry)),
    });
    const data: unknown = await response.json().catch(() => null);
    const body = data && typeof data === "object" ? data as Record<string, unknown> : {};
    const page = body.page as NotePageSummary | undefined;
    if (!response.ok || typeof page?.id !== "string") {
      const source = response.status === 422 && typeof body.source === "string" && body.source ? body.source : null;
      const limit = usageLimitErrorFrom(response.status, body);
      update(key, entry, { status: "error", message: diagramErrorMessage(response.status, body), source, ...(limit ? { limit: { tier: limit.tier } } : {}) });
      return;
    }
    if (!update(key, entry, { status: "done", page, partial: body.partial === true })) return;
    // 一覧（サイドバー・ホーム）に加える。サーバーが返すのは一覧用の形（本体を含まない）。
    window.dispatchEvent(new CustomEvent("notefable:page-created", { detail: page }));
    // アプリの WebView（/note-embed の AI パネル）では、アプリの一覧に知らせる（ブラウザーでは何もしない）。
    postToNative({ type: "pagesChanged" });
  } catch {
    update(key, entry, { status: "error", message: FAILED, source: null });
  }
}

// その元の要求を始める。すでにあれば（進行中・結果を見ていない）何もしない。元の鍵を返す。
export function startDiagramJob(source: DiagramSource, model: string) {
  const key = diagramKey(source);
  if (entries.has(key)) return key;
  const entry: Entry = { source, model, clientRequestId: crypto.randomUUID(), job: { status: "working" } };
  entries.set(key, entry);
  void run(key, entry);
  return key;
}

// 失敗した要求を、同じ clientRequestId とモデルで送り直す。
export function retryDiagramJob(key: string) {
  const entry = entries.get(key);
  if (entry?.job.status !== "error") return;
  void run(key, entry);
}

// 窓を閉じた：終わった結果は忘れる（次に選んだら新しく作る）。進行中のものは残す。
export function dismissDiagramJob(key: string) {
  const entry = entries.get(key);
  if (!entry || entry.job.status === "working") return;
  entries.delete(key);
  emit();
}

// アカウントが替わった：要求も窓も忘れ、進行中の要求の結果は捨てる。
// web はログイン・ログアウトでページを読み直すので、ふだんはそれで消える。
export function resetDiagramJobs() {
  generation += 1;
  entries.clear();
  flushing.clear();
  dialog = null;
  emit();
}

// チャットの回答の「…」から。保存済みの回答（サーバーの ID）だけが呼ぶ。
export function drawAnswerDiagram(sessionId: string, messageId: string, model: string) {
  openDiagramDialog(startDiagramJob({ type: "answer", sessionId, messageId }, model));
}

// ノートの「…」と AI パネルから。サーバーは保存済みのノートを読むので、入力中の内容を先に保存する。
// 保存できなければ要求を始めず、理由を窓に出す。同じノートの要求がすでにあれば、保存せずにその窓を開き直す。
export async function drawNoteDiagram(pageId: string, model: string, flush: () => Promise<boolean>): Promise<"started" | "reopened" | "unsaved" | "ignored"> {
  const key = diagramKey({ type: "note", pageId });
  if (entries.has(key)) {
    openDiagramDialog(key);
    return "reopened";
  }
  // 保存の途中に押し直した。
  if (flushing.has(key)) return "ignored";
  flushing.add(key);
  const started = generation;
  let saved = false;
  try {
    saved = await flush();
  } catch {
    saved = false;
  } finally {
    flushing.delete(key);
  }
  // 保存の間にアカウントが替わった。
  if (started !== generation) return "ignored";
  if (!saved) {
    openDiagramDialog(key, UNSAVED_NOTE);
    return "unsaved";
  }
  openDiagramDialog(startDiagramJob({ type: "note", pageId }, model));
  return "started";
}
