import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateMany: vi.fn(),
  findFirst: vi.fn(),
  readCanvasData: vi.fn(),
  scheduleNoteEmbeddingSync: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getOrCreateUser: async () => ({ id: "mine" }) }));
vi.mock("@/lib/canvas-store", () => ({ readCanvasData: mocks.readCanvasData }));
vi.mock("@/lib/note-embeddings", () => ({ scheduleNoteEmbeddingSync: mocks.scheduleNoteEmbeddingSync }));
vi.mock("@/lib/prisma", () => ({
  prisma: { notePage: { updateMany: mocks.updateMany, findFirst: mocks.findFirst } },
}));

import { PUT } from "./route";

const context = { params: Promise.resolve({ pageId: "n1" }) };
const call = (body: unknown) =>
  PUT(new Request("http://localhost/api/pages/n1/title", { method: "PUT", body: JSON.stringify(body) }), context);

describe("PUT /api/pages/:id/title", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readCanvasData.mockResolvedValue(null);
  });

  it("renames an owned live note, normalizes newlines, and bumps version", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findFirst.mockResolvedValue({ id: "n1", kind: "note", title: "My Plan", version: 4 });
    const response = await call({ title: "  My\nPlan  ", version: 3 });
    expect(response.status).toBe(200);
    expect((await response.json()).page).toMatchObject({ id: "n1", title: "My Plan", version: 4 });
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: "n1", userId: "mine", version: 3, deletedAt: null },
      data: { title: "My Plan", version: { increment: 1 } },
    });
    expect(mocks.scheduleNoteEmbeddingSync).toHaveBeenCalledWith("mine", ["n1"]);
  });

  it("falls back to Untitled when blank", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findFirst.mockResolvedValue({ id: "n1", kind: "note", title: "Untitled", version: 5 });
    const response = await call({ title: "   \n  ", version: 4 });
    expect(response.status).toBe(200);
    expect(mocks.updateMany.mock.calls[0][0].data.title).toBe("Untitled");
  });

  it("returns canvas data for whiteboards and slides", async () => {
    const data = { elements: [{ id: "e1", type: "rectangle" }] };
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findFirst.mockResolvedValue({ id: "w1", kind: "whiteboard", title: "Board", version: 3 });
    mocks.readCanvasData.mockResolvedValue(data);
    const response = await call({ title: "Board", version: 2 });
    expect(response.status).toBe(200);
    expect((await response.json()).page).toMatchObject({ id: "w1", kind: "whiteboard", title: "Board", version: 3, data });
    expect(mocks.readCanvasData).toHaveBeenCalledWith("mine", "n1");
  });

  it("rejects non-string or overlong titles and invalid versions without writing", async () => {
    for (const title of [123, null, {}, "a".repeat(201)]) {
      expect((await call({ title, version: 0 })).status).toBe(400);
    }
    for (const version of [undefined, null, -1, 1.5, "1"]) {
      expect((await call({ title: "Valid", version })).status).toBe(400);
    }
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.scheduleNoteEmbeddingSync).not.toHaveBeenCalled();
  });

  it("answers 409 with the latest note when version is stale", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    mocks.findFirst.mockResolvedValue({ id: "n1", kind: "note", title: "Changed in tab 2", version: 7 });
    const response = await call({ title: "Stale rename", version: 6 });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      page: { id: "n1", title: "Changed in tab 2", version: 7 },
    });
    expect(mocks.scheduleNoteEmbeddingSync).not.toHaveBeenCalled();
  });

  it("answers 404 for another user's, missing, or trashed note", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    mocks.findFirst.mockResolvedValue(null);
    expect((await call({ title: "New", version: 0 })).status).toBe(404);
    expect(mocks.scheduleNoteEmbeddingSync).not.toHaveBeenCalled();
  });
});
