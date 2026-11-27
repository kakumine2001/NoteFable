import { describe, expect, it } from "vitest";
import { issueQuizReportToken, verifyQuizReportToken } from "./quiz-report-token";
import { parseQuizReply, validateReviewQuiz, type ReviewQuiz } from "./quiz/model";

const quiz: ReviewQuiz = {
  title: "History Quiz",
  questions: [
    { id: "q1", type: "true_false", prompt: "Earth orbits the Sun.", correct: true, explanation: "Heliocentric model." },
  ],
};

describe("quiz report tokens", () => {
  it("issues and verifies a signed token bound to user, page and quiz digest", async () => {
    const token = await issueQuizReportToken("u1", { pageId: "p1", pageKind: "note", model: "gpt-6-luna", quiz });
    await expect(verifyQuizReportToken(token, "u1", "p1", quiz)).resolves.toEqual({
      pageKind: "note",
      model: "gpt-6-luna",
    });
  });

  it("keeps digest verification stable when clipped fields land on whitespace", async () => {
    const longExplanation = `${"a".repeat(1999)} tail beyond limit`;
    const parsed = parseQuizReply(
      JSON.stringify({
        title: `${"T".repeat(119)} extra title`,
        questions: [{ type: "true_false", prompt: "P", correct: true, explanation: longExplanation }],
      }),
      { count: 3, types: ["true_false"], language: "auto" },
      "Fallback",
    );
    expect(parsed).not.toBeNull();
    const token = await issueQuizReportToken("u1", { pageId: "p1", pageKind: "note", model: "gpt-6-luna", quiz: parsed! });
    const revalidated = validateReviewQuiz(JSON.parse(JSON.stringify(parsed)));
    expect(revalidated).not.toBeNull();
    await expect(verifyQuizReportToken(token, "u1", "p1", revalidated!)).resolves.toEqual({
      pageKind: "note",
      model: "gpt-6-luna",
    });
  });

  it("rejects tampered quiz content, wrong user, wrong page or malformed tokens", async () => {
    const token = await issueQuizReportToken("u1", { pageId: "p1", pageKind: "slides", model: "claude-haiku-5-5", quiz });
    const tampered: ReviewQuiz = {
      ...quiz,
      questions: [{ ...quiz.questions[0], prompt: "Altered text" } as ReviewQuiz["questions"][0]],
    };
    await expect(verifyQuizReportToken(token, "u1", "p1", tampered)).resolves.toBeNull();
    await expect(verifyQuizReportToken(token, "u2", "p1", quiz)).resolves.toBeNull();
    await expect(verifyQuizReportToken(token, "u1", "p2", quiz)).resolves.toBeNull();
    await expect(verifyQuizReportToken("not.a.jwt", "u1", "p1", quiz)).resolves.toBeNull();
  });
});
