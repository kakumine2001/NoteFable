import { msg } from "@/lib/i18n/translate";
import { postToNative } from "@/lib/native-bridge";
import {
  defaultQuizOptions,
  isFillBlankCorrect,
  MAX_QUIZ_COUNT,
  MIN_QUIZ_COUNT,
  QUIZ_TYPES,
  type QuizOptions,
  type QuizQuestion,
  type QuizQuestionType,
  type ReviewNoteLabels,
  type ReviewQuiz,
} from "@/lib/quiz/model";
import { usageLimitErrorFrom, type UsageTier } from "@/lib/usage-plans";
import type { NotePageSummary } from "@/types/notes";

// 復習・クイズモードのセッション内状態（データベース・localStorage に保存しない）。
// 生成・保存とも clientRequestId を使い回し、連打やネットワーク再試行で二重課金・二重ページ作成にならないようにする。

export type QuizTarget = {
  pageId: string;
  title: string;
  icon: string | null;
  kind: "note" | "slides";
  model: string;
};

export type QuizFlush = (pageId: string) => Promise<boolean>;

export type QuestionResponse =
  | { type: "mcq"; selectedIndex: number; correct: boolean }
  | { type: "true_false"; selected: boolean; correct: boolean }
  | { type: "fill_blank"; input: string; checked: boolean; correct: boolean | null; selfGraded?: boolean }
  | { type: "flashcard"; flipped: boolean; result: "known" | "review" | null };

export type QuizSessionState = {
  sessionKey: number;
  target: QuizTarget;
  options: QuizOptions;
  phase: "setup" | "generating" | "active" | "summary";
  requestId: string;
  requestKey: string;
  error: string;
  limit: { tier: UsageTier } | null;
  quiz: ReviewQuiz | null;
  reportToken: string | null;
  partial: boolean;
  currentIndex: number;
  answers: Record<string, QuestionResponse>;
  saveRequestId: string;
  saveState: "idle" | "saving" | "saved" | "error";
  saveError: string;
  savedPage: NotePageSummary | null;
};

export const QUIZ_FAILED = msg("Could not generate a quiz. Try again.");
const SAVE_REVIEW_FAILED = msg("Could not save the review note. Try again.");
const FLUSH_FAILED = msg("Save failed. Your draft is kept on this device. Resolve it before starting a quiz.");

let session: QuizSessionState | null = null;
let sessionSeq = 0;
let activeAbort: AbortController | null = null;
let backInterceptor: (() => boolean) | null = null;
const listeners = new Set<() => void>();

export function setQuizBackInterceptor(handler: (() => boolean) | null) {
  backInterceptor = handler;
}

function emit() {
  listeners.forEach((listener) => listener());
}

export function subscribeReviewQuiz(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getReviewQuiz(): QuizSessionState | null {
  return session;
}

function newId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `quiz_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

export function openReviewQuiz(target: QuizTarget) {
  activeAbort?.abort();
  activeAbort = null;
  sessionSeq += 1;
  session = {
    sessionKey: sessionSeq,
    target,
    options: defaultQuizOptions(),
    phase: "setup",
    requestId: "",
    requestKey: "",
    error: "",
    limit: null,
    quiz: null,
    reportToken: null,
    partial: false,
    currentIndex: 0,
    answers: {},
    saveRequestId: newId(),
    saveState: "idle",
    saveError: "",
    savedPage: null,
  };
  emit();
}

export function syncQuizTarget(pageId: string, patch: { title: string; icon: string | null; kind: "note" | "slides" }) {
  if (!session || session.target.pageId !== pageId) return;
  if (session.target.title === patch.title && session.target.icon === patch.icon && session.target.kind === patch.kind) return;
  session = { ...session, target: { ...session.target, ...patch } };
  emit();
}

export function closeReviewQuiz() {
  if (!session) return;
  activeAbort?.abort();
  activeAbort = null;
  session = null;
  emit();
}

export function reviewQuizBack(): boolean {
  if (!session) return false;
  if (backInterceptor?.()) return true;
  closeReviewQuiz();
  return true;
}

export function updateQuizOptions(patch: Partial<QuizOptions>) {
  if (!session || session.phase === "generating") return;
  const nextCount = patch.count !== undefined
    ? Math.max(MIN_QUIZ_COUNT, Math.min(MAX_QUIZ_COUNT, Math.round(patch.count)))
    : session.options.count;
  const nextTypes = patch.types && patch.types.length
    ? QUIZ_TYPES.filter((type) => patch.types!.includes(type))
    : session.options.types;
  const nextLanguage = patch.language ?? session.options.language;
  session = {
    ...session,
    options: { count: nextCount, types: nextTypes.length ? nextTypes : session.options.types, language: nextLanguage },
    error: "",
    limit: null,
  };
  emit();
}

export function toggleQuizType(type: QuizQuestionType) {
  if (!session || session.phase === "generating") return;
  const current = session.options.types;
  const exists = current.includes(type);
  if (exists && current.length <= 1) return;
  const next = exists ? current.filter((item) => item !== type) : QUIZ_TYPES.filter((item) => item === type || current.includes(item));
  updateQuizOptions({ types: next });
}

export async function generateReviewQuiz(flush?: QuizFlush) {
  if (!session || session.phase === "generating") return;
  const key = session.sessionKey;
  const { target, options } = session;
  const requestKey = JSON.stringify({ pageId: target.pageId, options, model: target.model });
  const requestId = session.requestKey === requestKey && session.requestId ? session.requestId : newId();

  activeAbort?.abort();
  const controller = new AbortController();
  activeAbort = controller;

  // 保存待ちの連打で二重に走り出さないよう、flush の前に generating 状態へ移す。
  session = {
    ...session,
    phase: "generating",
    requestId,
    requestKey,
    error: "",
    limit: null,
  };
  emit();

  // サーバーは保存済みのページを読むため、開いているページの未保存変更があれば先に保存する。
  if (flush) {
    const flushed = await flush(target.pageId).catch(() => false);
    if (controller.signal.aborted || !session || session.sessionKey !== key || activeAbort !== controller) return;
    if (!flushed) {
      activeAbort = null;
      session = { ...session, phase: "setup", error: FLUSH_FAILED, limit: null };
      emit();
      return;
    }
  }

  try {
    const response = await fetch("/api/pages/quiz", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pageId: target.pageId,
        options,
        model: target.model,
        clientRequestId: requestId,
      }),
      signal: controller.signal,
    });
    const data = (await response.json().catch(() => null)) as {
      quiz?: ReviewQuiz;
      reportToken?: string;
      partial?: boolean;
      error?: unknown;
      code?: unknown;
      tier?: unknown;
      kind?: unknown;
    } | null;

    if (!session || session.sessionKey !== key || activeAbort !== controller) return;
    activeAbort = null;

    if (!response.ok || !data?.quiz || typeof data.reportToken !== "string") {
      const limit = usageLimitErrorFrom(response.status, data);
      const message = typeof data?.error === "string" && data.error.trim() ? data.error.trim() : QUIZ_FAILED;
      session = {
        ...session,
        phase: "setup",
        error: message,
        limit: limit ? { tier: limit.tier } : null,
      };
      emit();
      return;
    }

    session = {
      ...session,
      phase: "active",
      quiz: data.quiz,
      reportToken: data.reportToken,
      partial: data.partial === true,
      currentIndex: 0,
      answers: {},
      error: "",
      limit: null,
      saveRequestId: newId(),
      saveState: "idle",
      saveError: "",
      savedPage: null,
    };
    emit();
  } catch {
    if (controller.signal.aborted) return;
    if (!session || session.sessionKey !== key || activeAbort !== controller) return;
    activeAbort = null;
    session = { ...session, phase: "setup", error: QUIZ_FAILED, limit: null };
    emit();
  }
}

export function setQuizIndex(index: number) {
  if (!session?.quiz) return;
  const clamped = Math.max(0, Math.min(session.quiz.questions.length - 1, index));
  session = { ...session, currentIndex: clamped };
  emit();
}

export function showQuizSummary() {
  if (!session?.quiz) return;
  session = { ...session, phase: "summary" };
  emit();
}

export function returnToQuizSetup() {
  if (!session) return;
  activeAbort?.abort();
  activeAbort = null;
  session = {
    ...session,
    phase: "setup",
    requestId: "",
    requestKey: "",
    error: "",
    limit: null,
  };
  emit();
}

export function retryCurrentQuiz() {
  if (!session?.quiz) return;
  session = {
    ...session,
    phase: "active",
    currentIndex: 0,
    answers: {},
  };
  emit();
}

export function answerMcq(question: Extract<QuizQuestion, { type: "mcq" }>, selectedIndex: number) {
  if (!session?.quiz) return;
  session = {
    ...session,
    answers: {
      ...session.answers,
      [question.id]: { type: "mcq", selectedIndex, correct: selectedIndex === question.correctIndex },
    },
  };
  emit();
}

export function answerTrueFalse(question: Extract<QuizQuestion, { type: "true_false" }>, selected: boolean) {
  if (!session?.quiz) return;
  session = {
    ...session,
    answers: {
      ...session.answers,
      [question.id]: { type: "true_false", selected, correct: selected === question.correct },
    },
  };
  emit();
}

export function setFillBlankInput(questionId: string, input: string) {
  if (!session?.quiz) return;
  const prev = session.answers[questionId];
  const checked = prev?.type === "fill_blank" ? prev.checked : false;
  if (checked) return;
  session = {
    ...session,
    answers: {
      ...session.answers,
      [questionId]: { type: "fill_blank", input, checked: false, correct: null },
    },
  };
  emit();
}

export function checkFillBlank(question: Extract<QuizQuestion, { type: "fill_blank" }>, revealOnly = false) {
  if (!session?.quiz) return;
  const prev = session.answers[question.id];
  const input = prev?.type === "fill_blank" ? prev.input : "";
  const correct = revealOnly ? false : isFillBlankCorrect(input, question.acceptedAnswers);
  session = {
    ...session,
    answers: {
      ...session.answers,
      [question.id]: { type: "fill_blank", input, checked: true, correct, selfGraded: false },
    },
  };
  emit();
}

export function selfGradeFillBlank(questionId: string, correct: boolean) {
  if (!session?.quiz) return;
  const prev = session.answers[questionId];
  if (prev?.type !== "fill_blank" || !prev.checked) return;
  session = {
    ...session,
    answers: {
      ...session.answers,
      [questionId]: { ...prev, correct, selfGraded: true },
    },
  };
  emit();
}

export function flipFlashcard(questionId: string) {
  if (!session?.quiz) return;
  const prev = session.answers[questionId];
  const flipped = prev?.type === "flashcard" ? !prev.flipped : true;
  const result = prev?.type === "flashcard" ? prev.result : null;
  session = {
    ...session,
    answers: {
      ...session.answers,
      [questionId]: { type: "flashcard", flipped, result },
    },
  };
  emit();
}

export function rateFlashcard(questionId: string, result: "known" | "review") {
  if (!session?.quiz) return;
  session = {
    ...session,
    answers: {
      ...session.answers,
      [questionId]: { type: "flashcard", flipped: true, result },
    },
  };
  emit();
}

export function isQuestionAnswered(question: QuizQuestion, response: QuestionResponse | undefined): boolean {
  if (!response) return false;
  if (response.type === "mcq" || response.type === "true_false") return true;
  if (response.type === "fill_blank") return response.checked;
  return response.result !== null;
}

export function isQuestionCorrect(question: QuizQuestion, response: QuestionResponse | undefined): boolean | null {
  if (!response) return null;
  if (response.type === "mcq" || response.type === "true_false") return response.correct;
  if (response.type === "fill_blank") return response.checked ? response.correct : null;
  return response.result === null ? null : response.result === "known";
}

export function quizScore(quiz: ReviewQuiz, answers: Record<string, QuestionResponse>) {
  let correct = 0;
  let answered = 0;
  for (const question of quiz.questions) {
    const result = isQuestionCorrect(question, answers[question.id]);
    if (result !== null) {
      answered += 1;
      if (result) correct += 1;
    }
  }
  const total = quiz.questions.length;
  const percent = total ? Math.round((correct / total) * 100) : 0;
  return { correct, answered, missed: answered - correct, unanswered: total - answered, total, percent };
}

export async function saveReviewNote(labels: ReviewNoteLabels, embedded: boolean) {
  if (!session?.quiz) return;
  if (session.saveState === "saving" || session.saveState === "saved") return;
  const key = session.sessionKey;
  const { target, quiz, saveRequestId } = session;

  session = { ...session, saveState: "saving", saveError: "" };
  emit();

  try {
    const response = await fetch("/api/pages/quiz/note", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pageId: target.pageId,
        quiz,
        clientRequestId: saveRequestId,
        labels,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const data = (await response.json().catch(() => null)) as { page?: NotePageSummary; error?: unknown } | null;
    if (!response.ok || !data?.page?.id) {
      if (!session || session.sessionKey !== key || session.saveRequestId !== saveRequestId) return;
      const message = typeof data?.error === "string" && data.error.trim() ? data.error.trim() : SAVE_REVIEW_FAILED;
      session = { ...session, saveState: "error", saveError: message };
      emit();
      return;
    }
    // すでに別のクイズへ切り替えた・窓を閉じた後でも、実際に作られたノートはワークスペース一覧へ反映する。
    window.dispatchEvent(new CustomEvent("notefable:page-created", { detail: data.page }));
    if (embedded) postToNative({ type: "pagesChanged" });
    if (!session || session.sessionKey !== key || session.saveRequestId !== saveRequestId) return;
    session = { ...session, saveState: "saved", saveError: "", savedPage: data.page };
    emit();
  } catch {
    if (!session || session.sessionKey !== key || session.saveRequestId !== saveRequestId) return;
    session = { ...session, saveState: "error", saveError: SAVE_REVIEW_FAILED };
    emit();
  }
}

// テスト用に内部状態をリセットする。
export function resetReviewQuizForTest() {
  activeAbort?.abort();
  activeAbort = null;
  session = null;
  sessionSeq = 0;
}
