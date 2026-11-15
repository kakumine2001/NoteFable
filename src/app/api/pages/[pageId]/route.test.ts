import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  find: vi.fn(), update: vi.fn(), purge: vi.fn(), raw: vi.fn(), unsafe: vi.fn(), revisionFind: vi.fn(), revisionDelete: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getOrCreateUser: async () => ({ id: "mine" }) }));
// サブページの探索（再帰の SQL）は note-tree-server に任せる。ここでは子が 1 つあるものとして扱う。
vi.mock("@/lib/note-tree-server", () => ({ lockNoteOrder: async () => {}, descendantIds: async () => ["c1"] }));
vi.mock("@/lib/prisma", () => {
  const notePage = { findFirst: mocks.find, updateMany: mocks.update, deleteMany: mocks.purge };
  const noteRevision = { findMany: mocks.revisionFind, deleteMany: mocks.revisionDelete };
  const tx = { notePage, noteRevision, $executeRaw: mocks.raw, $executeRawUnsafe: mocks.unsafe };
  return { databaseSchema: "notefable", prisma: { notePage, $transaction: async (fn: (tx: unknown) => unknown) => fn(tx) } };
});
import { DELETE, GET, PATCH } from "./route";

const context = { params: Promise.resolve({ pageId: "p1" }) };
const page = { id: "p1", title: "Saved", icon: null, cover: null, coverPosition: null, blocks: [], version: 2 };
function request(version = 1, title = "Mine") { return new Request("http://localhost/api/pages/p1", { method: "PATCH", body: JSON.stringify({ title, blocks: [], version }) }); }

describe("page ownership and save concurrency", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.raw.mockResolvedValue(0); mocks.purge.mockResolvedValue({ count: 0 }); mocks.revisionFind.mockResolvedValue([]); });

  it("does not read or trash a page from another device", async () => {
    mocks.find.mockResolvedValue(null);
    mocks.update.mockResolvedValue({ count: 0 });
    expect((await GET(request(), context)).status).toBe(404);
    expect((await DELETE(request(), context)).status).toBe(404);
    expect(mocks.find).toHaveBeenCalledWith({ where: { id: "p1", userId: "mine", deletedAt: null } });
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: { in: ["p1", "c1"] }, userId: "mine", deletedAt: null }, data: { deletedAt: expect.any(Date) } });
    // 何も捨てていないなら、掃除もしない。
    expect(mocks.purge).not.toHaveBeenCalled();
  });

  it("rejects stale writes and returns the latest owned page", async () => {
    mocks.update.mockResolvedValue({ count: 0 });
    mocks.find.mockResolvedValue(page);
    const result = await PATCH(request(), context);
    expect(result.status).toBe(409);
    expect((await result.json()).page).toEqual(page);
    expect(mocks.update.mock.calls[0][0].where).toEqual({ id: "p1", userId: "mine", version: 1, deletedAt: null });
  });

  it("accepts an identical retry after a lost response", async () => {
    mocks.update.mockResolvedValue({ count: 0 });
    mocks.find.mockResolvedValue(page);
    expect((await PATCH(request(1, "Saved"), context)).status).toBe(200);
  });

  it("recognizes identical JSONB content even when object keys are reordered", async () => {
    const blocks = [{ id: "b1", type: "paragraph", props: {}, content: [{ type: "text", text: "你好", styles: {} }], children: [] }];
    mocks.update.mockResolvedValue({ count: 0 });
    mocks.find.mockResolvedValue({ ...page, blocks: [{ children: [], content: [{ styles: {}, text: "你好", type: "text" }], props: {}, type: "paragraph", id: "b1" }] });
    const retry = new Request("http://localhost/api/pages/p1", { method: "PATCH", body: JSON.stringify({ title: "Saved", blocks, version: 1 }) });
    expect((await PATCH(retry, context)).status).toBe(200);
  });

  it("does not leak a foreign page through a conflict response", async () => {
    mocks.update.mockResolvedValue({ count: 0 });
    mocks.find.mockResolvedValue(null);
    const result = await PATCH(request(), context);
    expect(result.status).toBe(404);
    expect(await result.json()).not.toHaveProperty("page");
  });

  it("updates title and blocks together", async () => {
    mocks.update.mockResolvedValue({ count: 1 });
    mocks.find.mockResolvedValue(page);
    expect((await PATCH(request(), context)).status).toBe(200);
    expect(mocks.update.mock.calls[0][0].data).toEqual({ title: "Mine", blocks: [], version: { increment: 1 } });
  });
});

describe("trashed notes", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.raw.mockResolvedValue(0); mocks.purge.mockResolvedValue({ count: 0 }); mocks.revisionFind.mockResolvedValue([]); });

  it("moves a note and its sub-pages to the trash by stamping one deletedAt, leaving position and group alone, and then purges expired notes", async () => {
    mocks.update.mockResolvedValue({ count: 2 });
    const before = Date.now();
    const response = await DELETE(request(), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, ids: ["p1", "c1"] });
    const { where, data } = mocks.update.mock.calls[0][0];
    expect(where).toEqual({ id: { in: ["p1", "c1"] }, userId: "mine", deletedAt: null });
    expect(Object.keys(data)).toEqual(["deletedAt"]);
    expect((data.deletedAt as Date).getTime()).toBeGreaterThanOrEqual(before);
    // 保持期間（30 日）より前に捨てた、自分のノートだけを消す。
    const purge = mocks.purge.mock.calls[0][0].where;
    expect(purge.userId).toBe("mine");
    const cutoff = (purge.deletedAt.lt as Date).getTime();
    expect(Math.abs(Date.now() - 30 * 24 * 60 * 60 * 1000 - cutoff)).toBeLessThan(60_000);
    expect(mocks.purge).toHaveBeenCalledTimes(1);
  });

  it("still succeeds when purging expired notes fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.update.mockResolvedValue({ count: 1 });
    mocks.purge.mockRejectedValue(new Error("db hiccup"));
    expect((await DELETE(request(), context)).status).toBe(200);
  });

  it("answers 404 for a trashed note and refuses to save into it", async () => {
    mocks.find.mockResolvedValue(null);
    mocks.update.mockResolvedValue({ count: 0 });
    expect((await GET(request(), context)).status).toBe(404);
    const saved = await PATCH(request(), context);
    expect(saved.status).toBe(404);
    expect(mocks.update.mock.calls[0][0].where.deletedAt).toBeNull();
    expect(mocks.find).toHaveBeenLastCalledWith({ where: { id: "p1", userId: "mine", deletedAt: null } });
  });
});

describe("edit history snapshot on save", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.raw.mockResolvedValue(0); mocks.purge.mockResolvedValue({ count: 0 }); mocks.revisionFind.mockResolvedValue([]); });

  it("snapshots the stored version before the update, inside the same transaction", async () => {
    mocks.update.mockResolvedValue({ count: 1 });
    mocks.find.mockResolvedValue(page);
    expect((await PATCH(request(1), context)).status).toBe(200);
    expect(mocks.raw).toHaveBeenCalledTimes(1);
    const sql = mocks.raw.mock.calls[0][0] as { sql: string; values: unknown[] };
    expect(sql.sql).toContain('INSERT INTO "notefable"."NoteRevision"');
    expect(sql.values).toEqual(expect.arrayContaining(["p1", "mine", 1]));
    expect(mocks.raw.mock.invocationCallOrder[0]).toBeLessThan(mocks.update.mock.invocationCallOrder[0]);
  });

  it("keeps the 409 and the idempotent resend as they were when nothing was snapshotted", async () => {
    mocks.raw.mockResolvedValue(0);
    mocks.update.mockResolvedValue({ count: 0 });
    mocks.find.mockResolvedValue(page);
    expect((await PATCH(request(1), context)).status).toBe(409);
    expect((await PATCH(request(1, "Saved"), context)).status).toBe(200);
    expect(mocks.revisionFind).not.toHaveBeenCalled();
  });

  it("prunes old revisions only after a snapshot was actually inserted", async () => {
    mocks.raw.mockResolvedValue(1);
    mocks.revisionFind.mockResolvedValueOnce([{ id: "old1" }]).mockResolvedValueOnce([{ id: "old2" }]);
    mocks.update.mockResolvedValue({ count: 1 });
    mocks.find.mockResolvedValue(page);
    expect((await PATCH(request(1), context)).status).toBe(200);
    expect(mocks.revisionFind).toHaveBeenCalledWith(expect.objectContaining({ where: { noteId: "p1", userId: "mine", reason: "AUTO" }, skip: 30 }));
    expect(mocks.revisionDelete).toHaveBeenCalledWith({ where: { id: { in: ["old1", "old2"] }, noteId: "p1", userId: "mine" } });
  });

  it("still saves the note when the snapshot statement fails, and rolls the savepoint back", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.raw.mockRejectedValue(new Error("snapshot failed"));
    mocks.update.mockResolvedValue({ count: 1 });
    mocks.find.mockResolvedValue(page);
    expect((await PATCH(request(1), context)).status).toBe(200);
    expect(mocks.unsafe).toHaveBeenCalledWith("SAVEPOINT note_snapshot");
    expect(mocks.unsafe).toHaveBeenCalledWith("ROLLBACK TO SAVEPOINT note_snapshot");
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });

  it("does not snapshot a rejected request (invalid cover owner)", async () => {
    const foreign = new Request("http://localhost/api/pages/p1", { method: "PATCH", body: JSON.stringify({
      title: "T", cover: "upload:page-covers/someone/0e111e3a-9e25-4944-ade7-b460580fa925.png", blocks: [], version: 1,
    }) });
    expect((await PATCH(foreign, context)).status).toBe(400);
    expect(mocks.raw).not.toHaveBeenCalled();
  });
});

describe("page metadata from older clients", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.raw.mockResolvedValue(0); mocks.purge.mockResolvedValue({ count: 0 }); });

  it("keeps saved icon and cover when a request omits them, and updates them when present", async () => {
    mocks.update.mockResolvedValue({ count: 1 });
    mocks.find.mockResolvedValue(page);
    const legacy = new Request("http://localhost/api/pages/p1", { method: "PATCH", body: JSON.stringify({ title: "T", icon: "📚", blocks: [], version: 1 }) });
    expect((await PATCH(legacy, context)).status).toBe(200);
    expect(mocks.update.mock.calls[0][0].data).toEqual({ title: "T", icon: "📚", blocks: [], version: { increment: 1 } });
  });

  it("rejects another user's uploaded cover key", async () => {
    const foreign = new Request("http://localhost/api/pages/p1", { method: "PATCH", body: JSON.stringify({
      title: "T", cover: "upload:page-covers/someone/0e111e3a-9e25-4944-ade7-b460580fa925.png", blocks: [], version: 1,
    }) });
    expect((await PATCH(foreign, context)).status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
