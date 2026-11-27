import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewQuiz } from "@/lib/quiz/model";
import {
  answerMcq,
  answerTrueFalse,
  checkFillBlank,
  closeReviewQuiz,
  flipFlashcard,
  generateReviewQuiz,
  getReviewQuiz,
  openReviewQuiz,
  quizScore,
  rateFlashcard,
  resetReviewQuizForTest,
  retryCurrentQuiz,
  returnToQuizSetup,
  reviewQuizBack,
  saveReviewNote,
  selfGradeFillBlank,
  setFillBlankInput,
  setQuizBackInterceptor,
  toggleQuizType,
  updateQuizOptions,
} from "./quiz-session";

const sampleQuiz: ReviewQuiz = {
  title: "Bio Quiz",
  questions: [
    { id: "q1", type: "mcq", prompt: "Q1", options: ["A", "B"], correctIndex: 1, explanation: "B is right" },
    { id: "q2", type: "true_false", prompt: "Q2", correct: true, explanation: "True" },
    { id: "q3", type: "fill_blank", prompt: "Q3", acceptedAnswers: ["mitosis"], explanation: "Cell division" },
    { id: "q4", type: "flashcard", front: "F", back: "B" },
  ],
};

describe("quiz-session store", () => {
  const fetchMock = vi.fn();
  let windowTarget: EventTarget & { NoteFableNative?: { postMessage: ReturnType<typeof vi.fn> } };

  beforeEach(() => {
    resetReviewQuizForTest();
    setQuizBackInterceptor(null);
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    windowTarget = Object.assign(new EventTarget(), {
      NoteFableNative: { postMessage: vi.fn() },
    });
    vi.stubGlobal("window", windowTarget);
  });

  afterEach(() => {
    resetReviewQuizForTest();
    setQuizBackInterceptor(null);
    vi.unstubAllGlobals();
  });

  it("configures options (keeping at least one type), flushes before generating, reuses clientRequestId on retry and handles 429", async () => {
    openReviewQuiz({ pageId: "p1", title: "Bio", icon: null, kind: "note", model: "gpt-6-luna" });
    updateQuizOptions({ count: 4, types: ["mcq"] });
    // Cannot toggle off the last remaining type.
    toggleQuizType("mcq");
    expect(getReviewQuiz()?.options.types).toEqual(["mcq"]);

    // Flush failure stops generation.
    await generateReviewQuiz(async () => false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getReviewQuiz()?.phase).toBe("setup");
    expect(getReviewQuiz()?.error).toContain("Resolve it before starting a quiz");

    // First attempt hits 429 usage limit.
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "Daily limit", code: "usage_limit", tier: "guest", kind: "chat" }), { status: 429 }));
    await generateReviewQuiz(async () => true);
    expect(getReviewQuiz()?.phase).toBe("setup");
    expect(getReviewQuiz()?.limit).toEqual({ tier: "guest" });
    const firstId = JSON.parse(fetchMock.mock.calls[0][1].body as string).clientRequestId;

    // Retry with unchanged options reuses the same clientRequestId.
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ quiz: sampleQuiz, reportToken: "tok1" }), { status: 200 }));
    await generateReviewQuiz(async () => true);
    const secondId = JSON.parse(fetchMock.mock.calls[1][1].body as string).clientRequestId;
    expect(secondId).toBe(firstId);
    expect(getReviewQuiz()?.phase).toBe("active");
    expect(getReviewQuiz()?.reportToken).toBe("tok1");
  });

  it("scores all 4 question types including fill-blank self-grading and flashcard rating, and resets on retry", async () => {
    openReviewQuiz({ pageId: "p1", title: "Bio", icon: null, kind: "note", model: "gpt-6-luna" });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ quiz: sampleQuiz, reportToken: "tok1" }), { status: 200 }));
    await generateReviewQuiz();

    const [q1, q2, q3, q4] = sampleQuiz.questions;
    if (q1.type === "mcq") answerMcq(q1, 1);
    if (q2.type === "true_false") answerTrueFalse(q2, false);
    if (q3.type === "fill_blank") {
      setFillBlankInput(q3.id, "wrong");
      checkFillBlank(q3);
      expect(getReviewQuiz()?.answers[q3.id]).toMatchObject({ checked: true, correct: false });
      selfGradeFillBlank(q3.id, true);
      expect(getReviewQuiz()?.answers[q3.id]).toMatchObject({ correct: true, selfGraded: true });
    }
    flipFlashcard(q4.id);
    rateFlashcard(q4.id, "known");

    expect(quizScore(sampleQuiz, getReviewQuiz()!.answers)).toEqual({
      correct: 3,
      answered: 4,
      missed: 1,
      unanswered: 0,
      total: 4,
      percent: 75,
    });

    retryCurrentQuiz();
    expect(getReviewQuiz()?.answers).toEqual({});
    expect(getReviewQuiz()?.currentIndex).toBe(0);
  });

  it("saves review note idempotently, blocks duplicate clicks and notifies web + native", async () => {
    openReviewQuiz({ pageId: "p1", title: "Bio", icon: null, kind: "slides", model: "gpt-6-luna" });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ quiz: sampleQuiz, reportToken: "tok1" }), { status: 200 }));
    await generateReviewQuiz();

    const createdEvents: unknown[] = [];
    windowTarget.addEventListener("notefable:page-created", (e) => createdEvents.push((e as CustomEvent).detail));

    // First save fails with 503.
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "Temporary failure" }), { status: 503 }));
    await saveReviewNote({ noteTitle: "Bio · Review quiz" }, true);
    expect(getReviewQuiz()?.saveState).toBe("error");
    const firstSaveId = JSON.parse(fetchMock.mock.calls[1][1].body as string).clientRequestId;

    // Retry reuses the same saveRequestId and succeeds.
    const pageSummary = { id: "rev1", title: "Bio · Review quiz", kind: "note" };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ page: pageSummary }), { status: 201 }));
    await saveReviewNote({ noteTitle: "Bio · Review quiz" }, true);
    const secondSaveId = JSON.parse(fetchMock.mock.calls[2][1].body as string).clientRequestId;
    expect(secondSaveId).toBe(firstSaveId);
    expect(getReviewQuiz()?.saveState).toBe("saved");
    expect(getReviewQuiz()?.savedPage).toEqual(pageSummary);
    expect(createdEvents).toEqual([pageSummary]);
    expect(windowTarget.NoteFableNative?.postMessage).toHaveBeenCalledWith(JSON.stringify({ type: "pagesChanged" }));

    // Clicking save again after saved does not send another request.
    await saveReviewNote({ noteTitle: "Bio · Review quiz" }, true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("lets a back interceptor close nested dialogs before closing the quiz", () => {
    openReviewQuiz({ pageId: "p1", title: "Bio", icon: null, kind: "note", model: "gpt-6-luna" });
    let reportOpen = true;
    setQuizBackInterceptor(() => {
      if (!reportOpen) return false;
      reportOpen = false;
      return true;
    });
    expect(reviewQuizBack()).toBe(true);
    expect(reportOpen).toBe(false);
    expect(getReviewQuiz()).not.toBeNull();

    expect(reviewQuizBack()).toBe(true);
    expect(getReviewQuiz()).toBeNull();
    expect(reviewQuizBack()).toBe(false);
    closeReviewQuiz();
  });

  it("ignores duplicate generateReviewQuiz clicks while source flush is still pending", async () => {
    openReviewQuiz({ pageId: "p1", title: "Bio", icon: null, kind: "note", model: "gpt-6-luna" });
    let resolveFlush!: (ok: boolean) => void;
    const flush = vi.fn(() => new Promise<boolean>((resolve) => { resolveFlush = resolve; }));
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ quiz: sampleQuiz, reportToken: "tok1" }), { status: 200 }));

    const first = generateReviewQuiz(flush);
    expect(getReviewQuiz()?.phase).toBe("generating");
    const second = generateReviewQuiz(flush);
    resolveFlush(true);
    await Promise.all([first, second]);

    expect(flush).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getReviewQuiz()?.phase).toBe("active");
  });

  it("does not apply a late review-note save to a newer quiz while still notifying the workspace", async () => {
    openReviewQuiz({ pageId: "p1", title: "Bio", icon: null, kind: "note", model: "gpt-6-luna" });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ quiz: sampleQuiz, reportToken: "tok1" }), { status: 200 }));
    await generateReviewQuiz();

    let resolveSave!: (res: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveSave = resolve; }));
    const createdEvents: unknown[] = [];
    windowTarget.addEventListener("notefable:page-created", (e) => createdEvents.push((e as CustomEvent).detail));

    const pendingSave = saveReviewNote({ noteTitle: "First review note" }, true);
    expect(getReviewQuiz()?.saveState).toBe("saving");

    // Start and complete a brand-new quiz before the first save finishes.
    returnToQuizSetup();
    const secondQuiz: ReviewQuiz = { ...sampleQuiz, title: "Second Quiz" };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ quiz: secondQuiz, reportToken: "tok2" }), { status: 200 }));
    await generateReviewQuiz();
    expect(getReviewQuiz()?.quiz?.title).toBe("Second Quiz");
    expect(getReviewQuiz()?.saveState).toBe("idle");

    const firstPage = { id: "rev_old", title: "First review note", kind: "note" };
    resolveSave(new Response(JSON.stringify({ page: firstPage }), { status: 201 }));
    await pendingSave;

    // Workspace is notified that the first note exists, but the second quiz stays unsaved.
    expect(createdEvents).toEqual([firstPage]);
    expect(windowTarget.NoteFableNative?.postMessage).toHaveBeenCalledWith(JSON.stringify({ type: "pagesChanged" }));
    expect(getReviewQuiz()?.saveState).toBe("idle");
    expect(getReviewQuiz()?.savedPage).toBeNull();
  });
});
