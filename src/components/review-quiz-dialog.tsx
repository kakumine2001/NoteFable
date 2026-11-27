"use client";

import {
  ArrowUpRight,
  BookOpenCheck,
  Check,
  ChevronLeft,
  ChevronRight,
  Eye,
  FilePlus2,
  Flag,
  LoaderCircle,
  RotateCcw,
  X,
} from "lucide-react";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import "@/components/review-quiz.css";
import { ReportDialog } from "@/components/answer-actions";
import { AssistantMarkdown } from "@/components/assistant-markdown";
import { GuestLimitPrompt, UpgradePrompt } from "@/components/guest-limit-prompt";
import { useT } from "@/components/i18n-provider";
import { NoteIcon } from "@/components/note-icon";
import { PageKindIcon } from "@/components/page-kind-icon";
import { useAccount } from "@/lib/account-store";
import { LOCALE_NAMES, LOCALES, type Locale } from "@/lib/i18n/locale";
import { localizeSystemText, msg } from "@/lib/i18n/translate";
import { nativeCanOpenPage, nativeCanShowQuiz, nativeCanShowUsageLimit, postToNative } from "@/lib/native-bridge";
import {
  MAX_QUIZ_COUNT,
  MIN_QUIZ_COUNT,
  QUIZ_COUNT_PRESETS,
  QUIZ_TYPES,
  type QuizQuestion,
  type QuizQuestionType,
  type ReviewNoteLabels,
} from "@/lib/quiz/model";
import {
  answerMcq,
  answerTrueFalse,
  checkFillBlank,
  closeReviewQuiz,
  flipFlashcard,
  generateReviewQuiz,
  getReviewQuiz,
  isQuestionAnswered,
  isQuestionCorrect,
  quizScore,
  rateFlashcard,
  returnToQuizSetup,
  retryCurrentQuiz,
  saveReviewNote,
  selfGradeFillBlank,
  setFillBlankInput,
  setQuizBackInterceptor,
  setQuizIndex,
  showQuizSummary,
  subscribeReviewQuiz,
  toggleQuizType,
  updateQuizOptions,
  type QuestionResponse,
  type QuizFlush,
  type QuizSessionState,
} from "@/lib/quiz-session";
import { useBackToClose } from "@/lib/use-back-to-close";

// 復習・クイズモードの共通 UI（ウェブの /app とネイティブアプリの /note-embed WebView で共用）。
// 問題と解答はこのセッション中のみ保持し、元のページは書き換えない。「保存」時のみ通常のノート（aiUpdatedAt 付き）を作る。

const TYPE_LABELS: Record<QuizQuestionType, string> = {
  mcq: msg("Multiple choice"),
  true_false: msg("True / False"),
  fill_blank: msg("Fill in the blank"),
  flashcard: msg("Flashcards"),
};

const SINGLE_TYPE_LABELS: Record<QuizQuestionType, string> = {
  mcq: msg("Multiple choice"),
  true_false: msg("True / False"),
  fill_blank: msg("Fill in the blank"),
  flashcard: msg("Flashcard"),
};

function optionLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

// 画面に 1 つだけ置く。ノートまたはスライドの「…」メニューから開いたときに表示する。
export function ReviewQuizHost({ embedded = false, flush }: { embedded?: boolean; flush?: QuizFlush }) {
  const view = useSyncExternalStore(subscribeReviewQuiz, getReviewQuiz, () => null);
  const visible = view !== null;
  useEffect(() => {
    if (!embedded || !visible || !nativeCanShowQuiz()) return;
    postToNative({ type: "quiz", state: "open" });
    return () => {
      postToNative({ type: "quiz", state: "closed" });
    };
  }, [embedded, visible]);
  if (!view) return null;
  return <ReviewQuizDialog key={view.sessionKey} view={view} embedded={embedded} flush={flush} />;
}

function ReviewQuizDialog({ view, embedded, flush }: { view: QuizSessionState; embedded: boolean; flush?: QuizFlush }) {
  const t = useT();
  const { account } = useAccount();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [reporting, setReporting] = useState(false);
  const [dismissedLimit, setDismissedLimit] = useState<QuizSessionState["limit"]>(null);
  const [countDraft, setCountDraft] = useState<string | null>(null);

  useBackToClose(true, closeReviewQuiz);
  useEffect(() => { ref.current?.showModal(); }, []);

  // 通報ダイアログが開いている間にネイティブの「戻る」が来たら、先に通報ダイアログを閉じる。
  useEffect(() => {
    if (!reporting) {
      setQuizBackInterceptor(null);
      return;
    }
    setQuizBackInterceptor(() => {
      setReporting(false);
      return true;
    });
    return () => setQuizBackInterceptor(null);
  }, [reporting]);

  // 429 使用回数上限：アプリ WebView ではネイティブのログイン / アップグレード案内へ橋渡し（旧版アプリは下のエラー文のみ表示）。
  const limit = view.limit;
  useEffect(() => {
    if (!limit || !embedded || !nativeCanShowUsageLimit()) return;
    postToNative({ type: "usageLimit", tier: limit.tier, kind: "chat", pageId: view.target.pageId });
  }, [embedded, limit, view.target.pageId]);

  const limitClosed = Boolean(limit && dismissedLimit === limit);
  const countText = countDraft ?? String(view.options.count);
  const showGuestPrompt = !embedded && !limitClosed && limit?.tier === "guest" && Boolean(account?.configured && !account.user);
  const showUpgradePrompt = !embedded && !limitClosed && limit?.tier === "member" && Boolean(account?.billing && account.user);
  const canOpenSaved = !embedded || nativeCanOpenPage();
  const canReport = Boolean(view.quiz && view.reportToken && (view.phase === "active" || view.phase === "summary"));

  function commitCount(raw: string) {
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) {
      setCountDraft(null);
      return;
    }
    const clamped = Math.max(MIN_QUIZ_COUNT, Math.min(MAX_QUIZ_COUNT, parsed));
    updateQuizOptions({ count: clamped });
    setCountDraft(null);
  }

  function handleSaveReviewNote() {
    if (!view.quiz) return;
    const baseTitle = view.quiz.title.trim() || view.target.title.trim() || t("Untitled");
    const labels: ReviewNoteLabels = {
      noteTitle: t("Review notes: {title}", { title: baseTitle }),
      sourceLabel: t("Source"),
      answerLabel: t("Answer"),
      explanationLabel: t("Explanation"),
      trueLabel: t("True"),
      falseLabel: t("False"),
      typeLabels: {
        mcq: t(SINGLE_TYPE_LABELS.mcq),
        true_false: t(SINGLE_TYPE_LABELS.true_false),
        fill_blank: t(SINGLE_TYPE_LABELS.fill_blank),
        flashcard: t(SINGLE_TYPE_LABELS.flashcard),
      },
    };
    void saveReviewNote(labels, embedded);
  }

  function openSavedNote(pageId: string) {
    if (embedded) postToNative({ type: "openPage", id: pageId });
    else window.dispatchEvent(new CustomEvent("notefable:open-note", { detail: { id: pageId } }));
    closeReviewQuiz();
  }

  const headerTitle = (view.phase === "active" || view.phase === "summary") && view.quiz
    ? view.quiz.title
    : t("Review & quiz");

  const currentQuestion = view.quiz?.questions[view.currentIndex] ?? null;
  const score = view.quiz ? quizScore(view.quiz, view.answers) : null;

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className="notes-dialog review-quiz-dialog"
      onCancel={(event) => {
        event.preventDefault();
        if (reporting) setReporting(false);
        else closeReviewQuiz();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) {
          closeReviewQuiz();
        }
      }}
    >
      <header className="review-quiz-header">
        <h2 id={titleId} className="review-quiz-title">
          <BookOpenCheck size={18} className="shrink-0 text-[var(--notion-accent)]" aria-hidden="true" />
          <span className="review-quiz-title-text">{headerTitle}</span>
        </h2>
        {canReport && (
          <button
            type="button"
            className="notion-icon-button grid"
            aria-label={t("Report AI content")}
            title={t("Report AI content")}
            onClick={() => setReporting(true)}
          >
            <Flag size={16} aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          className="notion-icon-button grid"
          aria-label={t("Close")}
          title={t("Close")}
          onClick={closeReviewQuiz}
        >
          <X size={18} aria-hidden="true" />
        </button>
      </header>

      <div className="review-quiz-body">
        {view.phase === "setup" && (
          <>
            <div className="review-quiz-source">
              <span className="shrink-0 leading-none" aria-hidden="true">
                <NoteIcon icon={view.target.icon} fallback={<PageKindIcon kind={view.target.kind} size={15} />} />
              </span>
              <span className="review-quiz-source-title">{view.target.title || t("Untitled")}</span>
            </div>

            <div className="review-quiz-field">
              <span className="review-quiz-label">{t("Question types")}</span>
              <div className="review-quiz-type-grid" role="group" aria-label={t("Question types")}>
                {QUIZ_TYPES.map((type) => {
                  const selected = view.options.types.includes(type);
                  return (
                    <button
                      key={type}
                      type="button"
                      className="review-quiz-type-chip"
                      aria-pressed={selected}
                      onClick={() => toggleQuizType(type)}
                    >
                      <span>{t(TYPE_LABELS[type])}</span>
                      {selected && <Check size={15} className="shrink-0" aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="review-quiz-field">
              <label className="review-quiz-label" htmlFor={`${titleId}-count`}>
                {t("Number of questions")}
              </label>
              <div className="review-quiz-count-row">
                {QUIZ_COUNT_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className="review-quiz-preset"
                    aria-pressed={view.options.count === preset}
                    onClick={() => {
                      setCountDraft(null);
                      updateQuizOptions({ count: preset });
                    }}
                  >
                    {preset}
                  </button>
                ))}
                <input
                  id={`${titleId}-count`}
                  type="number"
                  min={MIN_QUIZ_COUNT}
                  max={MAX_QUIZ_COUNT}
                  value={countText}
                  className="review-quiz-count-input"
                  aria-label={t("Number of questions")}
                  onChange={(event) => {
                    const value = event.target.value;
                    setCountDraft(value);
                    const parsed = Number.parseInt(value, 10);
                    if (Number.isSafeInteger(parsed) && parsed >= MIN_QUIZ_COUNT && parsed <= MAX_QUIZ_COUNT) {
                      updateQuizOptions({ count: parsed });
                    }
                  }}
                  onBlur={() => commitCount(countText)}
                />
              </div>
            </div>

            <div className="review-quiz-field">
              <label className="review-quiz-label" htmlFor={`${titleId}-lang`}>
                {t("Quiz language")}
              </label>
              <select
                id={`${titleId}-lang`}
                className="review-quiz-select"
                value={view.options.language}
                onChange={(event) => {
                  const val = event.target.value;
                  updateQuizOptions({ language: val === "auto" ? "auto" : (val as Locale) });
                }}
              >
                <option value="auto">{t("Follow material")}</option>
                {LOCALES.map((code) => (
                  <option key={code} value={code}>{LOCALE_NAMES[code]}</option>
                ))}
              </select>
            </div>

            <p className="review-quiz-notice">
              {t("Counts as 1 chat message. Your answers stay in this session; saving a review note keeps the questions and answer key.")}
            </p>

            {view.error && (
              <div role="alert" className="review-quiz-error">
                {localizeSystemText(view.error, t)}
              </div>
            )}
            {showGuestPrompt && <GuestLimitPrompt kind="chat" onClose={() => setDismissedLimit(limit)} />}
            {showUpgradePrompt && <UpgradePrompt kind="chat" onClose={() => setDismissedLimit(limit)} />}
          </>
        )}

        {view.phase === "generating" && (
          <div className="review-quiz-generating" role="status" aria-live="polite">
            <LoaderCircle size={26} className="animate-spin text-[var(--notion-accent)]" aria-hidden="true" />
            <p className="text-sm font-medium text-[var(--notion-text)]">{t("Creating your quiz…")}</p>
            <p className="text-xs text-[var(--notion-muted)]">
              {t("{count} questions from {title}", { count: view.options.count, title: view.target.title || t("Untitled") })}
            </p>
          </div>
        )}

        {view.phase === "active" && view.quiz && currentQuestion && score && (
          <>
            {view.partial && (
              <p className="review-quiz-notice">
                {t("Part of the material was too long, so only the first part was used.")}
              </p>
            )}

            <div className="flex flex-col gap-2">
              <div className="review-quiz-progress-head">
                <span>{t("Question {current} of {total}", { current: view.currentIndex + 1, total: view.quiz.questions.length })}</span>
                <span>{t("{answered} / {total} answered", { answered: score.answered, total: score.total })}</span>
              </div>
              <div className="review-quiz-progress-track" aria-hidden="true">
                <div
                  className="review-quiz-progress-fill"
                  style={{ width: `${Math.round(((view.currentIndex + 1) / view.quiz.questions.length) * 100)}%` }}
                />
              </div>
              <div className="review-quiz-dots" role="navigation" aria-label={t("Questions")}>
                {view.quiz.questions.map((question, index) => {
                  const verdict = isQuestionCorrect(question, view.answers[question.id]);
                  const state = verdict === true ? "correct" : verdict === false ? "wrong" : undefined;
                  return (
                    <button
                      key={question.id}
                      type="button"
                      className="review-quiz-dot"
                      data-current={index === view.currentIndex ? "true" : undefined}
                      data-state={state}
                      aria-current={index === view.currentIndex ? "step" : undefined}
                      aria-label={t("Question {current} of {total}", { current: index + 1, total: view.quiz!.questions.length })}
                      onClick={() => setQuizIndex(index)}
                    >
                      {index + 1}
                    </button>
                  );
                })}
              </div>
            </div>

            <QuestionCard
              question={currentQuestion}
              response={view.answers[currentQuestion.id]}
            />
          </>
        )}

        {view.phase === "summary" && view.quiz && score && (
          <>
            <div className="review-quiz-score-card">
              <div className="review-quiz-score-main">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-[var(--notion-muted)]">{t("Session score")}</p>
                  <p className="review-quiz-score-value">{score.correct} / {score.total}</p>
                </div>
                <span className="review-quiz-score-pct">{score.percent}%</span>
              </div>
              <div className="review-quiz-progress-track" aria-hidden="true">
                <div className="review-quiz-progress-fill" style={{ width: `${score.percent}%` }} />
              </div>
              <div className="review-quiz-score-stats">
                <span>{t("Correct: {count}", { count: score.correct })}</span>
                <span>{t("Needs review: {count}", { count: score.missed })}</span>
                {score.unanswered > 0 && <span>{t("Unanswered: {count}", { count: score.unanswered })}</span>}
              </div>
            </div>

            <div className="review-quiz-summary-actions">
              {view.saveState === "saved" && view.savedPage ? (
                canOpenSaved ? (
                  <button
                    type="button"
                    className="notion-button notion-button-primary inline-flex items-center gap-1.5"
                    onClick={() => openSavedNote(view.savedPage!.id)}
                  >
                    <ArrowUpRight size={15} aria-hidden="true" />
                    {t("Open review note")}
                  </button>
                ) : (
                  <span className="notion-button inline-flex items-center gap-1.5" aria-live="polite">
                    <Check size={15} aria-hidden="true" />
                    {t("Saved as review note")}
                  </span>
                )
              ) : (
                <button
                  type="button"
                  className="notion-button notion-button-primary inline-flex items-center gap-1.5"
                  disabled={view.saveState === "saving"}
                  aria-busy={view.saveState === "saving"}
                  onClick={handleSaveReviewNote}
                >
                  {view.saveState === "saving"
                    ? <LoaderCircle size={15} className="animate-spin" aria-hidden="true" />
                    : <FilePlus2 size={15} aria-hidden="true" />}
                  {view.saveState === "saving"
                    ? t("Saving…")
                    : view.saveState === "error"
                      ? t("Retry saving review note")
                      : t("Save review note")}
                </button>
              )}

              <button
                type="button"
                className="notion-button inline-flex items-center gap-1.5"
                onClick={retryCurrentQuiz}
              >
                <RotateCcw size={15} aria-hidden="true" />
                {t("Practice again")}
              </button>

              <button
                type="button"
                className="notion-button"
                onClick={returnToQuizSetup}
              >
                {t("New quiz")}
              </button>

              {canReport && (
                <button
                  type="button"
                  className="notion-button inline-flex items-center gap-1.5"
                  onClick={() => setReporting(true)}
                >
                  <Flag size={15} aria-hidden="true" />
                  {t("Report AI content")}
                </button>
              )}
            </div>

            {view.saveError && (
              <div role="alert" className="review-quiz-error">
                {localizeSystemText(view.saveError, t)}
              </div>
            )}

            <div className="review-quiz-review-list">
              {view.quiz.questions.map((question, index) => (
                <SummaryQuestionItem
                  key={question.id}
                  index={index}
                  question={question}
                  response={view.answers[question.id]}
                />
              ))}
            </div>
          </>
        )}
      </div>

      <footer className="review-quiz-footer">
        {view.phase === "setup" && (
          <>
            <button type="button" className="notion-button" onClick={closeReviewQuiz}>
              {t("Cancel")}
            </button>
            <button
              type="button"
              className="notion-button notion-button-primary"
              onClick={() => void generateReviewQuiz(flush)}
            >
              {t("Generate quiz")}
            </button>
          </>
        )}

        {view.phase === "generating" && (
          <>
            <span />
            <button type="button" className="notion-button" onClick={closeReviewQuiz}>
              {t("Cancel")}
            </button>
          </>
        )}

        {view.phase === "active" && view.quiz && (
          <>
            <button
              type="button"
              className="notion-button inline-flex items-center gap-1"
              disabled={view.currentIndex === 0}
              onClick={() => setQuizIndex(view.currentIndex - 1)}
            >
              <ChevronLeft size={16} aria-hidden="true" />
              {t("Previous question")}
            </button>
            <div className="flex items-center gap-2">
              {view.currentIndex < view.quiz.questions.length - 1 ? (
                <>
                  <button
                    type="button"
                    className="notion-button"
                    onClick={showQuizSummary}
                  >
                    {t("Finish")}
                  </button>
                  <button
                    type="button"
                    className="notion-button notion-button-primary inline-flex items-center gap-1"
                    onClick={() => setQuizIndex(view.currentIndex + 1)}
                  >
                    {t("Next question")}
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="notion-button notion-button-primary"
                  onClick={showQuizSummary}
                >
                  {t("Finish & see score")}
                </button>
              )}
            </div>
          </>
        )}

        {view.phase === "summary" && (
          <>
            <span />
            <button type="button" className="notion-button notion-button-primary" onClick={closeReviewQuiz}>
              {t("Done")}
            </button>
          </>
        )}
      </footer>

      {reporting && view.quiz && view.reportToken && (
        <ReportDialog
          target={{ pageId: view.target.pageId, quizReportToken: view.reportToken, quiz: view.quiz }}
          onClose={() => setReporting(false)}
        />
      )}
    </dialog>
  );
}

function QuestionCard({ question, response }: { question: QuizQuestion; response: QuestionResponse | undefined }) {
  const t = useT();
  const answered = isQuestionAnswered(question, response);

  return (
    <div className="review-quiz-card">
      <span className="review-quiz-type-badge">{t(SINGLE_TYPE_LABELS[question.type])}</span>

      {question.type === "mcq" && (
        <>
          <div className="review-quiz-prompt">
            <AssistantMarkdown content={question.prompt} />
          </div>
          <div className="review-quiz-options" role="group" aria-label={t("Answer choices")}>
            {question.options.map((option, index) => {
              const selected = response?.type === "mcq" ? response.selectedIndex : null;
              const isSelected = selected === index;
              const isCorrect = index === question.correctIndex;
              const state = answered ? (isCorrect ? "correct" : isSelected ? "wrong" : undefined) : undefined;
              return (
                <div
                  key={index}
                  role="button"
                  tabIndex={answered ? -1 : 0}
                  className="review-quiz-option"
                  aria-disabled={answered || undefined}
                  data-state={state}
                  aria-pressed={isSelected}
                  onClick={(event) => {
                    if (answered || (event.target as HTMLElement).closest("a, button")) return;
                    answerMcq(question, index);
                  }}
                  onKeyDown={(event) => {
                    if (answered || event.target !== event.currentTarget) return;
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      answerMcq(question, index);
                    }
                  }}
                >
                  <span className="review-quiz-option-letter" aria-hidden="true">
                    {answered && isCorrect ? <Check size={14} /> : answered && isSelected ? <X size={14} /> : optionLetter(index)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <AssistantMarkdown content={option} />
                  </span>
                </div>
              );
            })}
          </div>
          {answered && response?.type === "mcq" && (
            <FeedbackBox correct={response.correct} explanation={question.explanation} />
          )}
        </>
      )}

      {question.type === "true_false" && (
        <>
          <div className="review-quiz-prompt">
            <AssistantMarkdown content={question.prompt} />
          </div>
          <div className="review-quiz-tf-grid" role="group" aria-label={t("True / False")}>
            {[true, false].map((choice) => {
              const selected = response?.type === "true_false" ? response.selected : null;
              const isSelected = selected === choice;
              const isCorrect = choice === question.correct;
              const state = answered ? (isCorrect ? "correct" : isSelected ? "wrong" : undefined) : undefined;
              return (
                <button
                  key={String(choice)}
                  type="button"
                  className="review-quiz-option review-quiz-tf-button"
                  disabled={answered}
                  data-state={state}
                  aria-pressed={isSelected}
                  onClick={() => answerTrueFalse(question, choice)}
                >
                  {answered && isCorrect && <Check size={16} aria-hidden="true" />}
                  {answered && isSelected && !isCorrect && <X size={16} aria-hidden="true" />}
                  <span>{choice ? t("True") : t("False")}</span>
                </button>
              );
            })}
          </div>
          {answered && response?.type === "true_false" && (
            <FeedbackBox correct={response.correct} explanation={question.explanation} />
          )}
        </>
      )}

      {question.type === "fill_blank" && (
        <>
          <div className="review-quiz-prompt">
            <AssistantMarkdown content={question.prompt} />
          </div>
          <form
            className="review-quiz-blank-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!answered) checkFillBlank(question, false);
            }}
          >
            <input
              type="text"
              className="review-quiz-blank-input"
              value={response?.type === "fill_blank" ? response.input : ""}
              disabled={answered}
              placeholder={t("Type your answer…")}
              aria-label={t("Your answer")}
              onChange={(event) => setFillBlankInput(question.id, event.target.value)}
            />
            {!answered && (
              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  className="notion-button notion-button-primary"
                  disabled={!(response?.type === "fill_blank" && response.input.trim())}
                >
                  {t("Check answer")}
                </button>
                <button
                  type="button"
                  className="notion-button inline-flex items-center gap-1.5"
                  onClick={() => checkFillBlank(question, true)}
                >
                  <Eye size={15} aria-hidden="true" />
                  {t("Show answer")}
                </button>
              </div>
            )}
          </form>
          {answered && response?.type === "fill_blank" && (
            <div className="review-quiz-feedback" data-correct={response.correct ? "true" : "false"} role="status">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="review-quiz-feedback-status">
                  {response.correct ? <Check size={16} aria-hidden="true" /> : <X size={16} aria-hidden="true" />}
                  {response.correct ? t("Correct") : t("Needs review")}
                </span>
                {response.correct ? (
                  <button
                    type="button"
                    className="notion-button text-xs"
                    onClick={() => selfGradeFillBlank(question.id, false)}
                  >
                    {t("Mark as needs review")}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="notion-button text-xs"
                    onClick={() => selfGradeFillBlank(question.id, true)}
                  >
                    {t("I got it right")}
                  </button>
                )}
              </div>
              <div>
                <span className="font-medium text-[var(--notion-muted)]">{t("Accepted answer:")} </span>
                <span>{question.acceptedAnswers.join(" / ")}</span>
              </div>
              {question.explanation && (
                <div className="review-quiz-explanation">
                  <AssistantMarkdown content={question.explanation} />
                </div>
              )}
            </div>
          )}
        </>
      )}

      {question.type === "flashcard" && (() => {
        const card = response?.type === "flashcard" ? response : { type: "flashcard" as const, flipped: false, result: null };
        return (
          <>
            <div
              role="button"
              tabIndex={0}
              className="review-quiz-flashcard-surface"
              data-flipped={card.flipped ? "true" : undefined}
              aria-pressed={card.flipped}
              onClick={(event) => {
                if ((event.target as HTMLElement).closest("a, button")) return;
                flipFlashcard(question.id);
              }}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  flipFlashcard(question.id);
                }
              }}
            >
              <span className="review-quiz-flashcard-side">
                {card.flipped ? t("Back of card") : t("Front of card")}
              </span>
              <div className="review-quiz-flashcard-face">
                <AssistantMarkdown content={card.flipped ? question.back : question.front} />
              </div>
              {card.flipped && question.explanation && (
                <div className="review-quiz-explanation text-xs text-[var(--notion-muted)]">
                  <AssistantMarkdown content={question.explanation} />
                </div>
              )}
              <span className="mt-auto text-xs text-[var(--notion-muted)]">
                {card.flipped ? t("Tap to see front") : t("Tap to flip")}
              </span>
            </div>
            {card.flipped ? (
              <div className="review-quiz-tf-grid" role="group" aria-label={t("Self-check")}>
                <button
                  type="button"
                  className="review-quiz-option review-quiz-tf-button"
                  data-state={card.result === "review" ? "wrong" : undefined}
                  aria-pressed={card.result === "review"}
                  onClick={() => rateFlashcard(question.id, "review")}
                >
                  <RotateCcw size={15} aria-hidden="true" />
                  <span>{t("Review again")}</span>
                </button>
                <button
                  type="button"
                  className="review-quiz-option review-quiz-tf-button"
                  data-state={card.result === "known" ? "correct" : undefined}
                  aria-pressed={card.result === "known"}
                  onClick={() => rateFlashcard(question.id, "known")}
                >
                  <Check size={15} aria-hidden="true" />
                  <span>{t("Got it")}</span>
                </button>
              </div>
            ) : (
              <div>
                <button
                  type="button"
                  className="notion-button inline-flex items-center gap-1.5"
                  onClick={() => flipFlashcard(question.id)}
                >
                  <Eye size={15} aria-hidden="true" />
                  {t("Show answer")}
                </button>
              </div>
            )}
          </>
        );
      })()}
    </div>
  );
}

function FeedbackBox({ correct, explanation }: { correct: boolean; explanation: string }) {
  const t = useT();
  return (
    <div className="review-quiz-feedback" data-correct={correct ? "true" : "false"} role="status">
      <span className="review-quiz-feedback-status">
        {correct ? <Check size={16} aria-hidden="true" /> : <X size={16} aria-hidden="true" />}
        {correct ? t("Correct") : t("Incorrect")}
      </span>
      {explanation && (
        <div className="review-quiz-explanation">
          <AssistantMarkdown content={explanation} />
        </div>
      )}
    </div>
  );
}

function SummaryQuestionItem({
  index,
  question,
  response,
}: {
  index: number;
  question: QuizQuestion;
  response: QuestionResponse | undefined;
}) {
  const t = useT();
  const verdict = isQuestionCorrect(question, response);
  const promptText = question.type === "flashcard" ? question.front : question.prompt;
  const answerText = question.type === "mcq"
    ? `${optionLetter(question.correctIndex)}. ${question.options[question.correctIndex] ?? ""}`
    : question.type === "true_false"
      ? (question.correct ? t("True") : t("False"))
      : question.type === "fill_blank"
        ? question.acceptedAnswers.join(" / ")
        : question.back;

  return (
    <div className="review-quiz-review-item">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-[var(--notion-muted)]">
          {index + 1}. {t(SINGLE_TYPE_LABELS[question.type])}
        </span>
        <span
          className="review-quiz-review-status"
          data-state={verdict === true ? "correct" : verdict === false ? "wrong" : undefined}
        >
          {verdict === true && <Check size={13} aria-hidden="true" />}
          {verdict === false && <X size={13} aria-hidden="true" />}
          {verdict === true ? t("Correct") : verdict === false ? t("Needs review") : t("Unanswered")}
        </span>
      </div>
      <div className="font-medium text-[var(--notion-text)]">
        <AssistantMarkdown content={promptText} />
      </div>
      <div className="text-[var(--notion-muted)]">
        <span className="font-medium text-[var(--notion-text)]">{t("Answer")}: </span>
        <span>{answerText}</span>
      </div>
      {question.explanation && (
        <div className="text-xs text-[var(--notion-muted)]">
          <AssistantMarkdown content={question.explanation} />
        </div>
      )}
    </div>
  );
}
