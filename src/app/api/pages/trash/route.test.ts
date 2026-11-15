import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn(), descendants: vi.fn(), setGroup: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getOrCreateUser: async () => ({ id: "mine" }) }));
vi.mock("@/lib/prisma", () => {
  const notePage = { findMany: mocks.findMany, findFirst: mocks.findFirst, updateMany: mocks.updateMany, deleteMany: mocks.deleteMany };
  return { databaseSchema: "studymate", prisma: { notePage, $transaction: async (fn: (tx: unknown) => unknown) => fn({ notePage }) } };
});
// サブページの探索（再帰の SQL）とグループの書き込みは note-tree-server に任せる。
vi.mock("@/lib/note-tree-server", async (original) => ({
  ...(await original<typeof import("@/lib/note-tree-server")>()), lockNoteOrder: async () => {}, descendantIds: mocks.descendants, setSubtreeGroup: mocks.setGroup,
}));
import { DELETE as emptyTrash, GET as listTrash } from "./route";
import { DELETE as deleteForever, POST as restore } from "./[pageId]/route";

const DAY = 24 * 60 * 60 * 1000;
const context = { params: Promise.resolve({ pageId: "n1" }) };
const call = (method: string) => new Request("http://localhost/api/pages/trash/n1", { method });
const cutoffOf = (filter: { gte?: Date; lt?: Date }) => (filter.gte ?? filter.lt)!.getTime();
const expectCutoff = (filter: { gte?: Date; lt?: Date }) => expect(Math.abs(Date.now() - 30 * DAY - cutoffOf(filter))).toBeLessThan(60_000);

describe("GET /api/pages/trash", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.deleteMany.mockResolvedValue({ count: 0 }); });

  it("purges this user's expired notes first, then lists the rest newest-deleted first with their purge time", async () => {
    const deletedAt = new Date(Date.now() - 2 * DAY);
    // n3 は親の n1 と一緒に捨てたサブページなので、一覧には出さない（親を戻すと一緒に戻る）。
    mocks.findMany.mockResolvedValue([{ id: "n1", title: "Plan", icon: "📚", deletedAt, parent: null }, { id: "n3", title: "Child", icon: null, deletedAt, parent: { deletedAt } },
      { id: "n2", title: "Old", icon: null, deletedAt: new Date(Date.now() - 5 * DAY), parent: { deletedAt: null } }]);
    const response = await listTrash();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const { pages } = await response.json();
    expect(pages.map((page: { id: string }) => page.id)).toEqual(["n1", "n2"]);
    expect(pages[0]).toEqual({ id: "n1", title: "Plan", icon: "📚", deletedAt: deletedAt.toISOString(), purgeAt: new Date(deletedAt.getTime() + 30 * DAY).toISOString() });

    const purge = mocks.deleteMany.mock.calls[0][0].where;
    expect(purge.userId).toBe("mine");
    expectCutoff(purge.deletedAt);
    expect(mocks.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(mocks.findMany.mock.invocationCallOrder[0]);

    const query = mocks.findMany.mock.calls[0][0];
    expect(query.where.userId).toBe("mine");
    expectCutoff(query.where.deletedAt);
    expect(query.orderBy).toEqual([{ deletedAt: "desc" }, { id: "desc" }]);
    // 本文は取らない。
    expect(query.select).toEqual({ id: true, title: true, icon: true, deletedAt: true, parent: { select: { deletedAt: true } } });
  });

  it("never lists an expired note even when purging failed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.deleteMany.mockRejectedValue(new Error("down"));
    mocks.findMany.mockResolvedValue([]);
    const response = await listTrash();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ pages: [] });
    expectCutoff(mocks.findMany.mock.calls[0][0].where.deletedAt);
  });
});

describe("DELETE /api/pages/trash (empty the trash)", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  const empty = (query = "") => emptyTrash(new Request(`http://localhost/api/pages/trash${query}`, { method: "DELETE" }));

  it("permanently deletes only this user's trashed notes and reports how many", async () => {
    mocks.deleteMany.mockResolvedValue({ count: 4 });
    const response = await empty();
    expect(await response.json()).toEqual({ ok: true, count: 4 });
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: { userId: "mine", deletedAt: { not: null } } });
  });

  it("with before=, leaves notes trashed after the list the user confirmed", async () => {
    mocks.deleteMany.mockResolvedValue({ count: 3 });
    const before = "2026-10-15T01:02:03.456Z";
    expect(await (await empty(`?before=${encodeURIComponent(before)}`)).json()).toEqual({ ok: true, count: 3 });
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: { userId: "mine", deletedAt: { lte: new Date(before) } } });
  });

  it("rejects an unreadable before= without deleting anything", async () => {
    expect((await empty("?before=yesterday")).status).toBe(400);
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });
});

describe("POST /api/pages/trash/:pageId (restore)", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.descendants.mockResolvedValue([]); mocks.updateMany.mockResolvedValue({ count: 1 }); });
  const deletedAt = new Date(Date.now() - DAY);
  const summary = { id: "n1", position: 2, title: "Plan", icon: null, version: 5, groupId: null, parentId: null, createdAt: new Date(), updatedAt: new Date() };

  it("restores a note that is in the trash and within retention, answering with a list item", async () => {
    mocks.findFirst.mockResolvedValue({ deletedAt, parentId: null, groupId: null, parent: null });
    mocks.findMany.mockResolvedValue([summary]);
    const response = await restore(call("POST"), context);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.page.id).toBe("n1");
    expect(body.pages.map((page: { id: string }) => page.id)).toEqual(["n1"]);
    const { where } = mocks.findFirst.mock.calls[0][0];
    expect(where).toMatchObject({ id: "n1", userId: "mine" });
    expectCutoff(where.deletedAt);
    expect(mocks.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["n1"] }, userId: "mine" }, data: { deletedAt: null } });
    // GET /api/pages の 1 件と同じ項目だけ（本文は含めない）。
    expect(mocks.findMany.mock.calls.at(-1)![0].select).not.toHaveProperty("blocks");
  });

  it("restores the sub-pages trashed with it, and moves it to the top level when its parent is still in the trash", async () => {
    mocks.findFirst.mockResolvedValue({ deletedAt, parentId: "p0", groupId: "g1", parent: { deletedAt: new Date(), groupId: "g1" } });
    mocks.descendants.mockResolvedValue(["c1", "c2"]);
    // c1 は一緒に捨てたもの、c2 は別の時刻に捨てたもの（一緒には戻さない）。
    mocks.findMany.mockImplementation(async ({ where, select }) => {
      if (where.deletedAt) return [{ id: "c1" }];
      if (select?.parentId && !select.title) return [{ id: "c1", parentId: "n1" }];
      return [summary, { ...summary, id: "c1", parentId: "n1" }];
    });
    const response = await restore(call("POST"), context);
    expect(response.status).toBe(200);
    expect(mocks.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["n1", "c1"] }, userId: "mine" }, data: { deletedAt: null } });
    expect(mocks.updateMany).toHaveBeenCalledWith({ where: { id: "n1", userId: "mine" }, data: { parentId: null } });
    expect(mocks.setGroup).not.toHaveBeenCalled();
  });

  it("returns under a live parent and follows the parent's current group", async () => {
    mocks.findFirst.mockResolvedValue({ deletedAt, parentId: "p0", groupId: null, parent: { deletedAt: null, groupId: "g2" } });
    mocks.findMany.mockResolvedValue([{ ...summary, parentId: "p0", groupId: "g2" }]);
    expect((await restore(call("POST"), context)).status).toBe(200);
    expect(mocks.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({ data: { parentId: null } }));
    expect(mocks.setGroup).toHaveBeenCalledWith(expect.anything(), "mine", "n1", "g2");
  });

  it("answers 404 for a live note, someone else's note, an unknown note and a note past retention", async () => {
    mocks.findFirst.mockResolvedValue(null);
    const response = await restore(call("POST"), context);
    expect(response.status).toBe(404);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/pages/trash/:pageId (delete forever)", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.descendants.mockResolvedValue(["c1"]); });

  it("deletes one trashed note of this user and its trashed sub-pages permanently", async () => {
    mocks.findFirst.mockResolvedValue({ id: "n1" });
    mocks.deleteMany.mockResolvedValue({ count: 2 });
    const response = await deleteForever(call("DELETE"), context);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.findFirst).toHaveBeenCalledWith({ where: { id: "n1", userId: "mine", deletedAt: { not: null } }, select: { id: true } });
    expect(mocks.descendants).toHaveBeenCalledWith(expect.anything(), "mine", "n1", { live: false });
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["n1", "c1"] }, userId: "mine", deletedAt: { not: null } } });
  });

  it("cannot delete a live note or another user's note through the trash", async () => {
    mocks.findFirst.mockResolvedValue(null);
    expect((await deleteForever(call("DELETE"), context)).status).toBe(404);
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });
});
