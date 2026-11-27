import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  findFirst: vi.fn(),
  findMany: vi.fn(),
  queryRaw: vi.fn(),
  canvasFindFirst: vi.fn(),
  createPage: vi.fn(),
  scheduleEmbedding: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getOrCreateUser: mocks.user }));
vi.mock("@/lib/prisma", () => ({
  databaseSchema: "notefable",
  prisma: {
    notePage: { findFirst: mocks.findFirst, findMany: mocks.findMany },
    noteCanvas: { findFirst: mocks.canvasFindFirst },
    $queryRaw: mocks.queryRaw,
  },
}));
vi.mock("@/lib/note-create", () => ({ createNotePage: mocks.createPage }));
vi.mock("@/lib/note-embeddings", () => ({ scheduleNoteEmbeddingSync: mocks.scheduleEmbedding }));

import { generateShareToken, resolvePublicShare } from "@/lib/note-share-server";
import { aiRequestPageId } from "@/lib/page-ai/one-shot";
import type { ReviewQuiz } from "@/lib/quiz/model";
import { POST } from "./route";

const requestId = "save-req-0123456789";
const quiz: ReviewQuiz = {
  title: "Photosynthesis Quiz",
  questions: [
    { id: "q1", type: "mcq", prompt: "Site of light reaction?", options: ["Thylakoid", "Stroma"], correctIndex: 0, explanation: "Membrane." },
    { id: "q2", type: "true_false", prompt: "Releases O2.", correct: true, explanation: "Water splitting." },
    { id: "q3", type: "fill_blank", prompt: "Main pigment: ____.", acceptedAnswers: ["chlorophyll"], explanation: "Green pigment." },
    { id: "q4", type: "flashcard", front: "ATP", back: "Energy currency" },
  ],
};

function post(body: unknown) {
  return POST(new Request("https://notefable.example/api/pages/quiz/note", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  }));
}

const summaryPage = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  kind: "note",
  title: "Photosynthesis · Review quiz",
  icon: null,
  cover: null,
  coverPosition: null,
  groupId: null,
  parentId: "cdeck1",
  favoritedAt: null,
  fullWidth: false,
  smallText: false,
  font: "default",
  locked: false,
  shareEnabled: false,
  aiUpdatedAt: new Date("2026-11-27T00:00:00Z"),
  version: 0,
  createdAt: new Date("2026-11-27T00:00:00Z"),
  updatedAt: new Date("2026-11-27T00:00:00Z"),
  deletedAt: null,
  ...extra,
});

describe("POST /api/pages/quiz/note", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.mockResolvedValue({ id: "mine", googleSub: null });
    mocks.findMany.mockResolvedValue([]);
    mocks.queryRaw.mockResolvedValue([]);
  });

  it("creates a reportable review note (aiUpdatedAt set, toggle blocks) as a sub-page of the source", async () => {
    const expectedId = aiRequestPageId("mine", "quiz-note", requestId);
    // First findFirst: findRequestedPage (none); second: source page.
    mocks.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "cdeck1", title: "Photosynthesis Deck" });
    mocks.createPage.mockResolvedValueOnce(summaryPage(expectedId));

    const response = await post({
      pageId: "cdeck1",
      quiz,
      clientRequestId: requestId,
      labels: { noteTitle: "Photosynthesis · Review quiz", answerLabel: "Answer" },
    });
    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.page.id).toBe(expectedId);
    expect(payload.page.aiUpdatedAt).toBeTruthy();
    expect(payload.page.parentId).toBe("cdeck1");

    expect(mocks.createPage).toHaveBeenCalledTimes(1);
    const [userId, content, options] = mocks.createPage.mock.calls[0];
    expect(userId).toBe("mine");
    expect(options).toEqual({ parentId: "cdeck1", ai: true, id: expectedId });
    expect((content.blocks as Array<{ type: string }>).filter((b) => b.type === "toggleListItem")).toHaveLength(4);
    expect(mocks.scheduleEmbedding).toHaveBeenCalledWith("mine", [expectedId]);
  });

  it("replays an existing review note on duplicate click or retry without creating a second page", async () => {
    const expectedId = aiRequestPageId("mine", "quiz-note", requestId);
    mocks.findFirst.mockResolvedValueOnce(summaryPage(expectedId));

    const response = await post({ pageId: "cdeck1", quiz, clientRequestId: requestId });
    expect(response.status).toBe(200);
    expect((await response.json()).page.id).toBe(expectedId);
    expect(mocks.createPage).not.toHaveBeenCalled();
  });

  it("handles concurrent duplicate create (P2002) by returning the already-created review note", async () => {
    const expectedId = aiRequestPageId("mine", "quiz-note", requestId);
    mocks.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "cdeck1", title: "Photosynthesis Deck" })
      .mockResolvedValueOnce(summaryPage(expectedId));
    mocks.createPage.mockRejectedValueOnce({ code: "P2002" });

    const response = await post({ pageId: "cdeck1", quiz, clientRequestId: requestId });
    expect(response.status).toBe(200);
    expect((await response.json()).page.id).toBe(expectedId);
  });

  it("returns 404 when a replayed review note was moved to Trash or the source page is missing", async () => {
    const expectedId = aiRequestPageId("mine", "quiz-note", requestId);
    mocks.findFirst.mockResolvedValueOnce(summaryPage(expectedId, { deletedAt: new Date("2026-11-27T01:00:00Z") }));
    const trashed = await post({ pageId: "cdeck1", quiz, clientRequestId: requestId });
    expect([trashed.status, (await trashed.json()).error]).toEqual([404, "This note was moved to the trash."]);

    mocks.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    expect((await post({ pageId: "missing", quiz, clientRequestId: requestId })).status).toBe(404);
  });

  it("rejects malformed requests before touching the database", async () => {
    for (const bad of [
      "bad json",
      { pageId: "bad id", quiz, clientRequestId: requestId },
      { pageId: "cdeck1", quiz: { title: "T", questions: [] }, clientRequestId: requestId },
      { pageId: "cdeck1", quiz, clientRequestId: "short" },
    ]) {
      expect((await post(bad)).status).toBe(400);
    }
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it("keeps saved review notes hidden from the source slide deck's public share link", async () => {
    const token = generateShareToken();
    const deck = {
      id: "cdeck1",
      userId: "mine",
      kind: "slides",
      parentId: null,
      title: "Public Deck",
      icon: null,
      cover: null,
      coverPosition: null,
      blocks: [],
      fullWidth: false,
      smallText: false,
      font: "default",
      deletedAt: null,
      shareToken: token,
      shareEnabled: true,
      shareIncludeSubpages: true,
      shareExpiresAt: null,
      shareExcludeFromParent: false,
      updatedAt: new Date("2026-11-27T00:00:00Z"),
    };
    const reviewNoteId = aiRequestPageId("mine", "quiz-note", requestId);
    mocks.canvasFindFirst.mockResolvedValue({ data: { slides: [{ id: "s1", elements: [] }] } });
    mocks.findFirst.mockResolvedValueOnce(deck);
    const rootShare = await resolvePublicShare(token);
    expect(rootShare?.children).toEqual([]);
    // Directly requesting the review note sub-page via the deck's public share link is refused.
    mocks.findFirst.mockResolvedValueOnce(deck);
    expect(await resolvePublicShare(token, reviewNoteId)).toBeNull();
  });
});
