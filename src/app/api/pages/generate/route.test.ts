import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findPage: vi.fn(),
  findPages: vi.fn(),
  findGroup: vi.fn(),
  consume: vi.fn(),
  refund: vi.fn(),
  generate: vi.fn(),
  createNote: vi.fn(),
  createCanvas: vi.fn(),
  embed: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getOrCreateUser: async () => ({ id: "mine", googleSub: null }) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    notePage: { findFirst: mocks.findPage, findMany: mocks.findPages },
    noteGroup: { findFirst: mocks.findGroup },
  },
}));
vi.mock("@/lib/usage-limits", () => ({
  clientNetworkKey: () => null,
  consumeUsage: mocks.consume,
  refundUsage: mocks.refund,
  usageLimitResponse: (result: { message: string }) => Response.json({ error: result.message, code: "usage_limit", tier: "guest" }, { status: 429 }),
}));
vi.mock("@/lib/one-shot-model", async (importOriginal) => ({ ...(await importOriginal<object>()), generateOneShotText: mocks.generate }));
vi.mock("@/lib/note-create", () => ({
  createNotePage: mocks.createNote,
  createCanvasPage: mocks.createCanvas,
}));
vi.mock("@/lib/note-embeddings", () => ({ scheduleNoteEmbeddingSync: mocks.embed }));

import { GET, POST } from "./route";
import { aiRequestPageId } from "@/lib/page-ai/one-shot";

const ticket = { buckets: [{ key: "user:mine", kind: "chat", day: "2026-11-28" }] };
const requestId = "req-0123456789";

function post(body: unknown) {
  return POST(new Request("https://notefable.example/api/pages/generate", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  }));
}

describe("GET /api/pages/generate", () => {
  it("returns a stable per-user draft scope", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(typeof data.scope).toBe("string");
    expect(data.scope.length).toBeGreaterThan(10);
  });
});

describe("POST /api/pages/generate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findPage.mockResolvedValue(null);
    mocks.findPages.mockResolvedValue([]);
    mocks.findGroup.mockResolvedValue({ id: "cgroup1" });
    mocks.consume.mockResolvedValue({ ok: true, ticket });
    mocks.createNote.mockImplementation(async (_user: string, content: { title: string }, options: { id: string; parentId: string | null; groupId: string | null; ai: boolean }) => ({
      id: options.id,
      kind: "note",
      title: content.title,
      icon: null,
      cover: null,
      coverPosition: null,
      version: 0,
      groupId: options.groupId,
      parentId: options.parentId,
      position: 0,
      favoritedAt: null,
      fullWidth: false,
      smallText: false,
      font: "default",
      locked: false,
      shareEnabled: false,
      shareExpiresAt: null,
      aiUpdatedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      blocks: [],
    }));
    mocks.createCanvas.mockImplementation(async (_user: string, kind: string, input: { title: string }, options: { id: string; parentId: string | null; groupId: string | null; ai: boolean }) => ({
      page: {
        id: options.id,
        kind,
        title: input.title,
        icon: null,
        cover: null,
        coverPosition: null,
        version: 0,
        groupId: options.groupId,
        parentId: options.parentId,
        position: 0,
        favoritedAt: null,
        fullWidth: false,
        smallText: false,
        font: "default",
        locked: false,
        shareEnabled: false,
        shareExpiresAt: null,
        aiUpdatedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      data: {},
    }));
  });

  it("generates a validated note with ai: true and deterministic pageId", async () => {
    mocks.generate.mockResolvedValueOnce({
      text: "# French Revolution\n\n## Causes\n\n- Fiscal crisis\n- Enlightenment ideas",
      cutOff: false,
    });
    const res = await post({
      kind: "note",
      prompt: "Summarize the French Revolution",
      noteStyle: "study-guide",
      groupId: "cgroup1",
      clientRequestId: requestId,
    });
    expect(res.status).toBe(201);
    const { page } = await res.json();
    expect(page).toMatchObject({
      id: aiRequestPageId("mine", "ai-note", requestId),
      kind: "note",
      title: "French Revolution",
      groupId: "cgroup1",
    });
    expect(page).not.toHaveProperty("blocks");
    expect(mocks.createNote).toHaveBeenCalledTimes(1);
    expect(mocks.createNote.mock.calls[0][2]).toMatchObject({ ai: true, groupId: "cgroup1", id: aiRequestPageId("mine", "ai-note", requestId) });
    expect(mocks.refund).not.toHaveBeenCalled();
    expect(mocks.embed).toHaveBeenCalledWith("mine", [page.id]);
  });

  it("generates an editable mindmap whiteboard by default and marks ai: true", async () => {
    mocks.generate.mockResolvedValueOnce({
      text: "# Neural Networks\n\n```mermaid\nmindmap\n  root((Neural Networks))\n    Layers\n      Input\n      Hidden\n    Training\n      Backprop\n```",
      cutOff: false,
    });
    const res = await post({
      kind: "whiteboard",
      prompt: "Neural networks overview",
      clientRequestId: requestId,
    });
    expect(res.status).toBe(201);
    const { page } = await res.json();
    expect(page).toMatchObject({
      id: aiRequestPageId("mine", "ai-whiteboard", requestId),
      kind: "whiteboard",
      title: "Neural Networks",
    });
    const [, kind, input, options] = mocks.createCanvas.mock.calls[0];
    expect(kind).toBe("whiteboard");
    expect(options).toMatchObject({ ai: true, id: aiRequestPageId("mine", "ai-whiteboard", requestId) });
    const elementTypes = (input.data.elements as { type: string }[]).map((e) => e.type);
    expect(elementTypes.length).toBeGreaterThan(0);
    expect(elementTypes).not.toContain("image");
  });

  it("generates a structured sticky-note board when whiteboardStructure is board", async () => {
    mocks.generate.mockResolvedValueOnce({
      text: JSON.stringify({
        title: "Product SWOT",
        frames: [{ ref: "s", name: "Strengths", layout: "column" }],
        items: [{ ref: "i1", type: "stickynote", text: "Fast UX", color: "green", frameRef: "s" }],
      }),
      cutOff: false,
    });
    const res = await post({
      kind: "whiteboard",
      prompt: "SWOT analysis",
      whiteboardStructure: "board",
      clientRequestId: requestId,
    });
    expect(res.status).toBe(201);
    const { page } = await res.json();
    expect(page.title).toBe("Product SWOT");
    const elementTypes = (mocks.createCanvas.mock.calls[0][2].data.elements as { type: string }[]).map((e) => e.type);
    expect(elementTypes).toContain("frame");
    expect(elementTypes).toContain("stickynote");
  });

  it("delimits referenced notes as private data and verifies ownership with deletedAt: null", async () => {
    mocks.findPages.mockResolvedValueOnce([{
      id: "cnote1",
      kind: "note",
      title: "Private Note",
      blocks: [{ id: "b1", type: "paragraph", props: {}, content: [{ type: "text", text: "Secret study facts", styles: {} }], children: [] }],
    }]);
    mocks.generate.mockResolvedValueOnce({ text: "# Study Summary\n\n- Secret study facts", cutOff: false });
    const res = await post({
      kind: "note",
      prompt: "Turn into outline",
      noteIds: ["cnote1"],
      clientRequestId: requestId,
    });
    expect(res.status).toBe(201);
    expect(mocks.findPages.mock.calls[0][0].where).toEqual({
      id: { in: ["cnote1"] },
      userId: "mine",
      deletedAt: null,
      kind: "note",
    });
    const sentInput = mocks.generate.mock.calls[0][0].input as string;
    expect(sentInput).toMatch(/<<<page-content [0-9a-f]{12}>>>\nSecret study facts\n<<<end page-content/);
  });

  it("replays an already created page for the same clientRequestId without double-charging or creating a second page", async () => {
    mocks.findPage.mockResolvedValueOnce({ id: "cexisting", kind: "note", title: "Existing", deletedAt: null });
    const res = await post({ kind: "note", prompt: "Hello", clientRequestId: requestId });
    expect(res.status).toBe(200);
    expect((await res.json()).page.id).toBe("cexisting");
    expect(mocks.consume).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.createNote).not.toHaveBeenCalled();
  });

  it("refunds usage and leaves no page when upstream fails or returns invalid output", async () => {
    mocks.generate.mockRejectedValueOnce(new Error("upstream down"));
    const res = await post({ kind: "note", prompt: "Topic", clientRequestId: requestId });
    expect(res.status).toBe(502);
    expect(mocks.refund).toHaveBeenCalledWith(ticket);
    expect(mocks.createNote).not.toHaveBeenCalled();
  });

  it("returns 429 usage_limit when chat quota is exhausted", async () => {
    mocks.consume.mockResolvedValueOnce({ ok: false, message: "Limit reached" });
    const res = await post({ kind: "note", prompt: "Topic", clientRequestId: requestId });
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ code: "usage_limit" });
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.createNote).not.toHaveBeenCalled();
  });

  it("refunds and replays on concurrent P2002 duplicate create", async () => {
    mocks.generate.mockResolvedValueOnce({ text: "# Dup\n\nBody", cutOff: false });
    mocks.createNote.mockRejectedValueOnce({ code: "P2002" });
    mocks.findPage
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "cwinner", kind: "note", title: "Dup", deletedAt: null });
    const res = await post({ kind: "note", prompt: "Dup", clientRequestId: requestId });
    expect(res.status).toBe(200);
    expect((await res.json()).page.id).toBe("cwinner");
    expect(mocks.refund).toHaveBeenCalledWith(ticket);
  });
});
