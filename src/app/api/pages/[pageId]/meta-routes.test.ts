import { beforeEach, describe, expect, it, vi } from "vitest";
import { NoteValidationError } from "@/lib/note-document";

const mocks = vi.hoisted(() => ({
  setMeta: vi.fn(), summary: vi.fn(), resolveParent: vi.fn(), setGroup: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(),
  descendants: vi.fn(), order: vi.fn(), writeOrder: vi.fn(), create: vi.fn(), claim: vi.fn(), claimFiles: vi.fn(), claimCanvas: vi.fn(), raw: vi.fn(), aggregate: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getOrCreateUser: async () => ({ id: "mine" }) }));
vi.mock("@/lib/note-covers", () => ({ claimCover: mocks.claim }));
vi.mock("@/lib/stored-files", () => ({ claimNoteFiles: mocks.claimFiles, claimCanvasFiles: mocks.claimCanvas }));
vi.mock("@/lib/prisma", () => {
  const notePage = { findFirst: mocks.findFirst, findMany: mocks.findMany, create: mocks.create };
  return { databaseSchema: "notefable", prisma: { notePage, $transaction: async (fn: (tx: unknown) => unknown) => fn({ notePage, noteCanvas: { aggregate: mocks.aggregate }, $executeRaw: mocks.raw }) } };
});
vi.mock("@/lib/note-tree-server", async (original) => ({
  ...(await original<typeof import("@/lib/note-tree-server")>()),
  lockNoteOrder: async () => {}, setPageMeta: mocks.setMeta, pageSummary: mocks.summary, resolveParent: mocks.resolveParent,
  setSubtreeGroup: mocks.setGroup, descendantIds: mocks.descendants, liveOrderIds: mocks.order, writeOrder: mocks.writeOrder,
}));
import { POST as duplicate } from "./duplicate/route";
import { PUT as favorite } from "./favorite/route";
import { PUT as parent } from "./parent/route";
import { PUT as settings } from "./settings/route";

const context = { params: Promise.resolve({ pageId: "p1" }) };
const put = (body: unknown) => new Request("http://localhost/api/pages/p1/x", { method: "PUT", body: JSON.stringify(body) });

describe("page settings and favorites", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.setMeta.mockResolvedValue(1); mocks.summary.mockResolvedValue({ id: "p1" }); mocks.findFirst.mockResolvedValue({ kind: "note" }); });

  it("writes only the settings that were sent, as metadata", async () => {
    expect((await settings(put({ fullWidth: true, font: "serif" }), context)).status).toBe(200);
    expect(mocks.setMeta).toHaveBeenCalledWith(expect.anything(), "mine", "p1", { fullWidth: true, font: "serif" });
  });

  it("refuses note-only typography for a whiteboard or slide deck, in the requester's language, but still locks it", async () => {
    for (const kind of ["whiteboard", "slides"]) {
      mocks.findFirst.mockResolvedValue({ kind });
      for (const body of [{ font: "serif" }, { smallText: true }, { fullWidth: true }]) {
        const request = new Request("http://localhost/api/pages/p1/settings", { method: "PUT", body: JSON.stringify(body), headers: { "accept-language": "ja" } });
        const response = await settings(request, context);
        expect(response.status).toBe(400);
        const json = await response.json();
        expect(json).toMatchObject({ code: "wrong_page_kind", kind });
        // 古いアプリは辞書にこの文を持たないので、サーバーが要求の言語に訳して返す。
        expect(json.error).not.toBe("Font, text size and width can only be changed for notes.");
        expect(json.error).toMatch(/[\u3040-\u30ff\u4e00-\u9fff]/);
      }
      expect(mocks.setMeta).not.toHaveBeenCalled();
      expect((await settings(put({ locked: true }), context)).status).toBe(200);
      expect(mocks.setMeta).toHaveBeenLastCalledWith(expect.anything(), "mine", "p1", { locked: true });
      mocks.setMeta.mockClear();
    }
  });

  it("rejects unknown fonts, non-boolean switches and empty requests", async () => {
    for (const body of [{ font: "comic" }, { locked: "yes" }, { smallText: 1 }, {}]) expect((await settings(put(body), context)).status).toBe(400);
    expect(mocks.setMeta).not.toHaveBeenCalled();
  });

  it("answers 404 for a page that is not the user's or is in the trash", async () => {
    mocks.setMeta.mockResolvedValue(0);
    expect((await settings(put({ locked: true }), context)).status).toBe(404);
    expect((await favorite(put({ favorite: true }), context)).status).toBe(404);
  });

  it("stamps or clears favoritedAt", async () => {
    expect((await favorite(put({ favorite: true }), context)).status).toBe(200);
    expect(mocks.setMeta.mock.calls[0][3].favoritedAt).toBeInstanceOf(Date);
    await favorite(put({ favorite: false }), context);
    expect(mocks.setMeta.mock.calls[1][3]).toEqual({ favoritedAt: null });
    expect((await favorite(put({ favorite: "true" }), context)).status).toBe(400);
  });
});

describe("PUT /api/pages/:id/parent", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.findFirst.mockResolvedValue({ groupId: "g0" }); mocks.setGroup.mockResolvedValue(["p1", "c1"]); mocks.findMany.mockResolvedValue([]); });

  it("moves the page and its sub-pages under the new parent and into the parent's group", async () => {
    mocks.resolveParent.mockResolvedValue({ id: "q1", groupId: "g2" });
    expect((await parent(put({ parentId: "q1" }), context)).status).toBe(200);
    expect(mocks.resolveParent).toHaveBeenCalledWith(expect.anything(), "mine", "p1", "q1");
    expect(mocks.setMeta).toHaveBeenCalledWith(expect.anything(), "mine", "p1", { parentId: "q1" });
    expect(mocks.setGroup).toHaveBeenCalledWith(expect.anything(), "mine", "p1", "g2");
  });

  it("returns to the top level keeping the current group", async () => {
    expect((await parent(put({ parentId: null }), context)).status).toBe(200);
    expect(mocks.resolveParent).not.toHaveBeenCalled();
    expect(mocks.setGroup).toHaveBeenCalledWith(expect.anything(), "mine", "p1", "g0");
  });

  it("rejects cycles reported by resolveParent and bad input", async () => {
    mocks.resolveParent.mockRejectedValue(new NoteValidationError("A page cannot be moved into its own sub-page."));
    expect((await parent(put({ parentId: "child" }), context)).status).toBe(400);
    expect(mocks.setMeta).not.toHaveBeenCalled();
    expect((await parent(put({ parentId: 5 }), context)).status).toBe(400);
    mocks.findFirst.mockResolvedValue(null);
    expect((await parent(put({ parentId: null }), context)).status).toBe(404);
  });
});

describe("POST /api/pages/:id/duplicate", () => {
  const row = (id: string, parentId: string | null, title = id) => ({ id, parentId, title, icon: null, cover: null, coverPosition: null, blocks: [], groupId: "g1", fullWidth: true, smallText: false, font: "mono", locked: false });
  beforeEach(() => {
    vi.clearAllMocks();
    let next = 0;
    mocks.create.mockImplementation(async () => ({ id: `copy${++next}` }));
    mocks.findFirst.mockImplementation(async ({ where }) => where.id === "p1" ? row("p1", null, "Plan") : { id: where.id });
    mocks.order.mockResolvedValue(["x", "p1", "c1", "y"]);
  });

  it("copies the page with its sub-pages, keeps settings, and places the copy right after the original", async () => {
    mocks.descendants.mockResolvedValue(["c1"]);
    mocks.findMany.mockImplementation(async ({ select }) => select ? [] : [row("c1", "p1")]);
    const response = await duplicate(new Request("http://localhost/x", { method: "POST" }), context);
    expect(response.status).toBe(201);
    const [root, child] = mocks.create.mock.calls.map((call) => call[0].data);
    expect(root).toMatchObject({ title: "Plan (1)", parentId: null, groupId: "g1", fullWidth: true, font: "mono" });
    expect(child).toMatchObject({ title: "c1", parentId: "copy1" });
    expect(mocks.writeOrder).toHaveBeenCalledWith(expect.anything(), "mine", ["x", "p1", "copy1", "copy2", "c1", "y"]);
    // AI が書いたページの複製も「AI の内容を報告」できる（目印を写す）。書いていないページには付けない。
    expect(root).toMatchObject({ aiUpdatedAt: undefined });
    // 複製も同じファイルを参照するので、ファイルを使用中に戻す（元から外されても消えないように）。
    expect(mocks.claimFiles).toHaveBeenCalledTimes(2);
    expect(mocks.claimFiles).toHaveBeenCalledWith(expect.anything(), [], "mine");
  });

  it("keeps the AI-written marker on the copies", async () => {
    const written = new Date("2026-11-20T00:00:00Z");
    mocks.findFirst.mockImplementation(async ({ where }) => where.id === "p1" ? { ...row("p1", null, "Plan"), aiUpdatedAt: written } : { id: where.id });
    mocks.descendants.mockResolvedValue([]);
    expect((await duplicate(new Request("http://localhost/x", { method: "POST" }), context)).status).toBe(201);
    expect(mocks.create.mock.calls[0][0].data).toMatchObject({ aiUpdatedAt: written });
  });

  it("copies a whiteboard with a slide deck inside, keeping each kind and copying their content inside the database", async () => {
    mocks.aggregate.mockResolvedValue({ _sum: { size: 4096 } });
    mocks.findFirst.mockImplementation(async ({ where }) => where.id === "p1" ? { ...row("p1", null, "Board"), kind: "whiteboard" } : { id: where.id });
    mocks.descendants.mockResolvedValue(["c1"]);
    mocks.findMany.mockImplementation(async ({ select }) => select ? [] : [{ ...row("c1", "p1"), kind: "slides" }]);
    expect((await duplicate(new Request("http://localhost/x", { method: "POST" }), context)).status).toBe(201);
    const [root, child] = mocks.create.mock.calls.map((call) => call[0].data);
    expect(root).toMatchObject({ kind: "whiteboard", title: "Board (1)", blocks: [] });
    expect(child).toMatchObject({ kind: "slides", parentId: "copy1" });
    // 本体（最大 2 MB）はアプリに読み込まず、INSERT ... SELECT で写す。
    const copies = mocks.raw.mock.calls.map(([sql]) => sql as { sql: string; values: unknown[] });
    expect(copies).toHaveLength(2);
    expect(copies[0].sql).toContain('INSERT INTO "notefable"."NoteCanvas"');
    expect(copies[0].sql).toContain('SELECT');
    expect(copies.map((copy) => copy.values)).toEqual([["copy1", "p1"], ["copy2", "c1"]]);
    // 本体が参照するファイルも、写す前に DB の中で使用中に戻す（ストレージの後片付けに消させない）。
    expect(mocks.claimCanvas).toHaveBeenCalledWith(expect.anything(), ["p1", "c1"], "mine");
    expect(mocks.claimCanvas.mock.invocationCallOrder[0]).toBeLessThan(mocks.create.mock.invocationCallOrder[0]);
  });

  it("refuses to copy more than 32 MB of whiteboard and slide content at once", async () => {
    mocks.findFirst.mockImplementation(async ({ where }) => where.id === "p1" ? { ...row("p1", null, "Board"), kind: "whiteboard" } : { id: where.id });
    mocks.descendants.mockResolvedValue([]);
    mocks.findMany.mockResolvedValue([]);
    mocks.aggregate.mockResolvedValue({ _sum: { size: 32 * 1024 * 1024 + 1 } });
    const response = await duplicate(new Request("http://localhost/x", { method: "POST" }), context);
    expect(response.status).toBe(413);
    expect(mocks.aggregate).toHaveBeenCalledWith({ where: { noteId: { in: ["p1"] } }, _sum: { size: true } });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("copies notes without touching the canvas table", async () => {
    mocks.descendants.mockResolvedValue([]);
    mocks.findMany.mockResolvedValue([]);
    expect((await duplicate(new Request("http://localhost/x", { method: "POST" }), context)).status).toBe(201);
    expect(mocks.raw).not.toHaveBeenCalled();
    expect(mocks.aggregate).not.toHaveBeenCalled();
    expect(mocks.claimCanvas).not.toHaveBeenCalled();
  });

  it("refuses pages with more than 99 sub-pages", async () => {
    mocks.descendants.mockResolvedValue(Array.from({ length: 100 }, (_, index) => `c${index}`));
    expect((await duplicate(new Request("http://localhost/x", { method: "POST" }), context)).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
