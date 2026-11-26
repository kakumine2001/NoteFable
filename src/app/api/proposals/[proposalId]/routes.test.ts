import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// 提案の「元に戻す」・縮小画像・改前/改後コンテンツ取得エンドポイント（処理そのものは src/lib/page-ai/proposals.test.ts）。
const mocks = vi.hoisted(() => ({ undo: vi.fn(), image: vi.fn(), content: vi.fn(), sync: vi.fn(), readUrl: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/storage", () => ({ getStoredImageReadUrl: mocks.readUrl, readStoredImage: mocks.read }));
vi.mock("@/lib/auth", () => ({ getOrCreateUser: async () => ({ id: "u1" }) }));
vi.mock("@/lib/note-embeddings", () => ({ scheduleNoteEmbeddingSync: mocks.sync }));
vi.mock("@/lib/page-ai/proposals", () => ({ undoProposal: mocks.undo, proposalImage: mocks.image, proposalContent: mocks.content }));
import { POST as undo } from "./undo/route";
import { GET as image } from "./image/route";
import { GET as content } from "./content/route";

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
    // 提案がもう別の状態なら、その状態と適用先も返す（カードがそれに合わせる）。
    mocks.undo.mockResolvedValue({ ok: false, httpStatus: 404, error: "Note not found.", status: "undone", pageId: "p1" });
    const settled = await undo(new Request("http://localhost/api/proposals/prop1/undo", { method: "POST" }), context);
    expect(await settled.json()).toEqual({ error: "Note not found.", status: "undone", pageId: "p1" });
    mocks.undo.mockResolvedValue({ ok: false, httpStatus: 409, error: "x", status: "applied", pageId: "p1", undoable: true });
    expect(await (await undo(new Request("http://localhost/api/proposals/prop1/undo", { method: "POST" }), context)).json()).toEqual({ error: "x", status: "applied", pageId: "p1", undoable: true });
    mocks.undo.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await undo(new Request("http://localhost/api/proposals/prop1/undo", { method: "POST" }), context)).status).toBe(503);
  });
});

describe("GET /api/proposals/:id/image", () => {
  beforeEach(() => vi.clearAllMocks());
  const get = (query: string) => image(new NextRequest(`http://localhost/api/proposals/prop1/image${query}`), context);

  it("sends the owner's thumbnail through a short-lived link to that one file, like chat images", async () => {
    mocks.image.mockResolvedValue({ mimeType: "image/png", path: "proposal-images/u1/a.png" });
    mocks.readUrl.mockResolvedValue("https://blob.example/proposal-images/u1/a.png?token=short");
    const response = await get("?change=0&side=after");
    expect(mocks.image).toHaveBeenCalledWith("u1", "prop1", 0, "after");
    expect(mocks.readUrl).toHaveBeenCalledWith("proposal-images/u1/a.png");
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://blob.example/proposal-images/u1/a.png?token=short");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("returns the bytes with safe headers when the files are stored locally", async () => {
    mocks.image.mockResolvedValue({ mimeType: "image/png", path: "proposal-images/u1/a.png" });
    mocks.readUrl.mockResolvedValue(null);
    mocks.read.mockResolvedValue(Buffer.from([1, 2, 3]));
    const response = await get("?change=0&side=after");
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    mocks.read.mockRejectedValue(new Error("missing"));
    expect((await get("?change=0&side=after")).status).toBe(404);
  });

  it("rejects a bad query and answers 404 for someone else's or a missing image", async () => {
    for (const query of ["", "?side=after", "?change=&side=after", "?change=-1&side=after", "?change=0&side=middle", "?change=x&side=before", "?change=1.5&side=before"]) {
      expect((await get(query)).status).toBe(400);
    }
    expect(mocks.image).not.toHaveBeenCalled();
    mocks.image.mockResolvedValue(null);
    expect((await get("?change=0&side=before")).status).toBe(404);
  });
});

describe("GET /api/proposals/:id/content", () => {
  beforeEach(() => vi.clearAllMocks());
  const get = (query: string) => content(new NextRequest(`http://localhost/api/proposals/prop1/content${query}`), context);

  it("returns before/after canvas content with Cache-Control: private, no-store", async () => {
    const payload = {
      kind: "edit",
      pageKind: "whiteboard",
      status: "pending",
      side: "after",
      title: "Plan",
      changes: [],
      focusIds: ["e1"],
      data: { elements: [{ id: "e1", type: "rectangle" }] },
    };
    mocks.content.mockResolvedValue({ ok: true, content: payload });
    const response = await get("?side=after");
    expect(mocks.content).toHaveBeenCalledWith("u1", "prop1", "after");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual(payload);
  });

  it("rejects invalid side params, forwards 404/400 errors, and answers 503 on DB error", async () => {
    for (const query of ["", "?side=", "?side=middle", "?side=BEFORE"]) {
      const bad = await get(query);
      expect(bad.status).toBe(400);
      expect(bad.headers.get("Cache-Control")).toBe("private, no-store");
    }
    expect(mocks.content).not.toHaveBeenCalled();

    mocks.content.mockResolvedValue({ ok: false, httpStatus: 404, error: "Proposal not found." });
    const notFound = await get("?side=before");
    expect(notFound.status).toBe(404);
    expect(notFound.headers.get("Cache-Control")).toBe("private, no-store");

    mocks.content.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const down = await get("?side=before");
    expect(down.status).toBe(503);
    expect(down.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
