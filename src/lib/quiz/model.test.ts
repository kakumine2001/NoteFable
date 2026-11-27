import { describe, expect, it } from "vitest";
import { validateNoteContent } from "@/lib/note-document";
import {
  canonicalQuizJson,
  defaultQuizOptions,
  formatQuizForReport,
  isFillBlankCorrect,
  parseQuizOptions,
  parseQuizReply,
  parseReviewNoteLabels,
  quizToReviewNoteContent,
  validateReviewQuiz,
  type ReviewQuiz,
} from "./model";

const sampleQuiz: ReviewQuiz = {
  title: "Photosynthesis Review",
  questions: [
    {
      id: "q1",
      type: "mcq",
      prompt: "Where do light-dependent reactions occur?",
      options: ["Thylakoid membrane", "Stroma", "Mitochondria", "Nucleus"],
      correctIndex: 0,
      explanation: "Light reactions take place in the thylakoid membrane.",
    },
    {
      id: "q2",
      type: "true_false",
      prompt: "The Calvin cycle requires direct sunlight.",
      correct: false,
      explanation: "It uses ATP and NADPH rather than direct light.",
    },
    {
      id: "q3",
      type: "fill_blank",
      prompt: "The primary pigment in plants is ____.",
      acceptedAnswers: ["chlorophyll", "Chlorophyll a"],
      explanation: "Chlorophyll absorbs red and blue wavelengths.",
    },
    {
      id: "q4",
      type: "flashcard",
      front: "What does RuBisCO catalyze?",
      back: "Carbon fixation in the Calvin cycle",
      explanation: "Combines CO2 with RuBP.",
    },
  ],
};

describe("quiz options parsing", () => {
  it("normalizes valid options and rejects invalid counts, types or locales", () => {
    expect(parseQuizOptions({ count: 5, types: ["flashcard", "mcq"], language: "ja" })).toEqual({
      count: 5,
      types: ["mcq", "flashcard"],
      language: "ja",
    });
    expect(parseQuizOptions({ count: 8, types: ["true_false"] })).toEqual({
      count: 8,
      types: ["true_false"],
      language: "auto",
    });
    for (const bad of [
      null,
      [],
      { count: 2, types: ["mcq"] },
      { count: 21, types: ["mcq"] },
      { count: 5.5, types: ["mcq"] },
      { count: 5, types: [] },
      { count: 5, types: ["essay"] },
      { count: 5, types: ["mcq"], language: "xx" },
    ]) {
      expect(parseQuizOptions(bad)).toBeNull();
    }
  });
});

describe("parseQuizReply and validateReviewQuiz", () => {
  it("parses strict JSON and code-fenced JSON across all 4 question types", () => {
    const raw = "```json\n" + JSON.stringify(sampleQuiz) + "\n```";
    const parsed = parseQuizReply(raw, { count: 4, types: ["mcq", "true_false", "fill_blank", "flashcard"], language: "auto" }, "Fallback");
    expect(parsed).toEqual(sampleQuiz);
    expect(validateReviewQuiz(parsed)).toEqual(sampleQuiz);
  });

  it("uses the fallback title when the model leaves title empty and trims extra questions to count", () => {
    const raw = JSON.stringify({
      title: "   ",
      questions: [
        { type: "true_false", prompt: "A", correct: true, explanation: "E1" },
        { type: "true_false", prompt: "B", correct: false, explanation: "E2" },
        { type: "true_false", prompt: "C", correct: true, explanation: "E3" },
        { type: "true_false", prompt: "D", correct: false, explanation: "E4" },
      ],
    });
    const parsed = parseQuizReply(raw, { count: 3, types: ["true_false"], language: "auto" }, "Biology Deck");
    expect(parsed?.title).toBe("Biology Deck");
    expect(parsed?.questions).toHaveLength(3);
    expect(parsed?.questions.map((q) => q.id)).toEqual(["q1", "q2", "q3"]);
  });

  it("rejects malformed JSON, disallowed question types and invalid question fields", () => {
    const opts = defaultQuizOptions();
    expect(parseQuizReply("not json", opts, "T")).toBeNull();
    expect(parseQuizReply(JSON.stringify({ title: "T", questions: [] }), opts, "T")).toBeNull();
    // Disallowed type requested only mcq.
    expect(parseQuizReply(JSON.stringify({
      title: "T",
      questions: [{ type: "true_false", prompt: "P", correct: true, explanation: "" }],
    }), { count: 3, types: ["mcq"], language: "auto" }, "T")).toBeNull();
    // Out-of-range correctIndex.
    expect(parseQuizReply(JSON.stringify({
      title: "T",
      questions: [{ type: "mcq", prompt: "P", options: ["A", "B"], correctIndex: 2, explanation: "" }],
    }), opts, "T")).toBeNull();
    // Duplicate MCQ options (even with other distinct choices) are rejected.
    expect(parseQuizReply(JSON.stringify({
      title: "T",
      questions: [{ type: "mcq", prompt: "P", options: ["Same", "same!"], correctIndex: 0, explanation: "" }],
    }), opts, "T")).toBeNull();
    expect(parseQuizReply(JSON.stringify({
      title: "T",
      questions: [{ type: "mcq", prompt: "P", options: ["Same", "same", "Other", "Fourth"], correctIndex: 0, explanation: "" }],
    }), opts, "T")).toBeNull();
    // Empty fill_blank acceptedAnswers.
    expect(parseQuizReply(JSON.stringify({
      title: "T",
      questions: [{ type: "fill_blank", prompt: "P", acceptedAnswers: [], explanation: "" }],
    }), opts, "T")).toBeNull();
    // Missing flashcard back.
    expect(parseQuizReply(JSON.stringify({
      title: "T",
      questions: [{ type: "flashcard", front: "Q", back: "   " }],
    }), opts, "T")).toBeNull();
  });

  it("produces deterministic canonical JSON independent of input key order", () => {
    const reordered = validateReviewQuiz({
      questions: [
        { explanation: "E", correct: false, prompt: "P", type: "true_false" },
      ],
      title: "  My\nQuiz  ",
    });
    const standard = validateReviewQuiz({
      title: "My Quiz",
      questions: [
        { id: "ignored", type: "true_false", prompt: "P", correct: false, explanation: "E" },
      ],
    });
    expect(reordered && standard && canonicalQuizJson(reordered) === canonicalQuizJson(standard)).toBe(true);
  });
});

describe("fill-in-the-blank normalization and matching", () => {
  it("matches case-insensitively across whitespace, punctuation, diacritics and full-width forms", () => {
    expect(isFillBlankCorrect("  CHLOROPHYLL! ", ["chlorophyll"])).toBe(true);
    expect(isFillBlankCorrect("résumé", ["resume"])).toBe(true);
    expect(isFillBlankCorrect("ＡＴＰ。", ["ATP"])).toBe(true);
    expect(isFillBlankCorrect("「光合成」", ["光合成"])).toBe(true);
    expect(isFillBlankCorrect("   ", ["chlorophyll"])).toBe(false);
    expect(isFillBlankCorrect("glucose", ["chlorophyll"])).toBe(false);
  });
});

describe("quizToReviewNoteContent and formatQuizForReport", () => {
  it("builds valid BlockNote content with headings, lists, toggle blocks and source mention", () => {
    const labels = parseReviewNoteLabels({
      noteTitle: "Biology · Review quiz",
      sourceLabel: "Source",
      answerLabel: "Answer",
      explanationLabel: "Explanation",
      trueLabel: "True",
      falseLabel: "False",
      typeLabels: { mcq: "Multiple choice", flashcard: "Flashcard" },
    });
    const draft = quizToReviewNoteContent(sampleQuiz, labels, { pageId: "note_123", title: "Biology" });
    const validated = validateNoteContent({
      title: draft.title,
      icon: null,
      cover: null,
      coverPosition: null,
      blocks: draft.blocks,
    });
    expect(validated.title).toBe("Biology · Review quiz");
    const blocks = validated.blocks as Array<{ type: string; content?: unknown[]; children?: unknown[] }>;
    // Source block contains the page mention.
    expect(blocks[0].type).toBe("paragraph");
    expect(JSON.stringify(blocks[0].content)).toContain('"pageId":"note_123"');
    // Headings, bullet list items, and toggle blocks with answer children.
    expect(blocks.some((b) => b.type === "heading")).toBe(true);
    expect(blocks.some((b) => b.type === "bulletListItem")).toBe(true);
    const toggles = blocks.filter((b) => b.type === "toggleListItem");
    expect(toggles).toHaveLength(4);
    for (const toggle of toggles) {
      expect(Array.isArray(toggle.children) && toggle.children.length > 0).toBe(true);
    }
  });

  it("escapes markdown-like leading characters in prompts and formats readable report text", () => {
    const tricky: ReviewQuiz = {
      title: "Markdown edge",
      questions: [
        { id: "q1", type: "flashcard", front: "# Heading?\n▸ Not a toggle", back: "- Not a list\n---" },
      ],
    };
    const draft = quizToReviewNoteContent(tricky);
    const validated = validateNoteContent({ title: draft.title, icon: null, cover: null, coverPosition: null, blocks: draft.blocks });
    expect(validated.blocks.length).toBeGreaterThan(0);

    const reportText = formatQuizForReport(sampleQuiz);
    expect(reportText).toContain("Quiz title: Photosynthesis Review");
    expect(reportText).toContain("A*: Thylakoid membrane");
    expect(reportText).toContain("Correct: False");
    expect(reportText).toContain("Accepted answers: chlorophyll | Chlorophyll a");
    expect(reportText).toContain("Front: What does RuBisCO catalyze?");
  });
});
