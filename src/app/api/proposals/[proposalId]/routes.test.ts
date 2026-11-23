import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// 提案の「元に戻す」と縮小画像のエンドポイント（処理そのものは src/lib/page-ai/proposals.test.ts）。
const mocks = vi.hoisted(() => ({ undo: vi.fn(), image: vi.fn(), sync: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getOrCreateUser: async () => ({ id: "u1" }) }));
vi.mock("@/lib/note-embeddings", () => ({ scheduleNoteEmbeddingSync: mocks.sync }));
vi.mock("@/lib/page-ai/proposals", () => ({ undoProposal: mocks.undo, proposalImage: mocks.image }));
import { POST as undo } from "./undo/route";
import { GET as image } from "./image/route";

const context = { params: Promise.resolve({ proposalId: "prop1" }) };

describe("POST /api/proposals/:id/undo", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the restored page for an edit and refreshes its search index", async () => {
    mocks.undo.mockResolvedValue({ ok: true, status: "undone", kind: "edit", page: { id: "p1", version: 5 } });
    const response = await undo(new Request("http://localhost/api/proposals/prop1/undo", { method: "POST" }), context);
    expect(mocks.undo).toHaveBeenCalledWith("u1", "prop1");
    expect(await response.json()).toEqual({ status: "undone", kind: "edit", page: { id: "p1", version: 5 } });
    expect(mocks.sync).toHaveBeenCalledWith("u1", ["p1"]);
  });

  it("returns the trashed page ids for a created page", async () => {
    mocks.undo.mockResolvedValue({ ok: true, status: "undone", kind: "create", trashedIds: ["p2", "p3"] });
    const response = await undo(new Request("http://localhost/api/proposals/prop1/undo", { method: "POST" }), context);
    expect(await response.json()).toEqual({ status: "undone", kind: "create", ids: ["p2", "p3"] });
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it("passes refusals through with their status and answers 503 when the database fails", async () => {
    mocks.undo.mockResolvedValue({ ok: false, httpStatus: 409, error: "This page changed after the AI edit. Restore an earlier version from the page history." });
    const refused = await undo(new Request("http://localhost/api/proposals/prop1/undo", { method: "POST" }), context);
    expect(refused.status).toBe(409);
    expect((await refused.json()).error).toContain("page history");
    mocks.undo.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await undo(new Request("http://localhost/api/proposals/prop1/undo", { method: "POST" }), context)).status).toBe(503);
  });
});

describe("GET /api/proposals/:id/image", () => {
  beforeEach(() => vi.clearAllMocks());
  const get = (query: string) => image(new NextRequest(`http://localhost/api/proposals/prop1/image${query}`), context);

  it("returns the owner's thumbnail with safe headers", async () => {
    mocks.image.mockResolvedValue({ mimeType: "image/png", bytes: Buffer.from([1, 2, 3]) });
    const response = await get("?change=0&side=after");
    expect(mocks.image).toHaveBeenCalledWith("u1", "prop1", 0, "after");
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("rejects a bad query and answers 404 for someone else's or a missing image", async () => {
    for (const query of ["", "?change=-1&side=after", "?change=0&side=middle", "?change=x&side=before"]) expect((await get(query)).status).toBe(400);
    expect(mocks.image).not.toHaveBeenCalled();
    mocks.image.mockResolvedValue(null);
    expect((await get("?change=0&side=before")).status).toBe(404);
  });
});
