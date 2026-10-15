import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getOrCreateAnonymousUser: async () => ({ id: "mine" }) }));
vi.mock("@/lib/prisma", () => ({
  databaseSchema: "studymate",
  prisma: { notePage: { findMany: mocks.findMany, findFirst: mocks.findFirst, updateMany: mocks.updateMany, deleteMany: mocks.deleteMany } },
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
    mocks.findMany.mockResolvedValue([{ id: "n1", title: "Plan", icon: "📚", deletedAt }, { id: "n2", title: "Old", icon: null, deletedAt: new Date(Date.now() - 5 * DAY) }]);
    const response = await listTrash();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect((await response.json()).pages[0]).toEqual({ id: "n1", title: "Plan", icon: "📚", deletedAt: deletedAt.toISOString(), purgeAt: new Date(deletedAt.getTime() + 30 * DAY).toISOString() });

    const purge = mocks.deleteMany.mock.calls[0][0].where;
    expect(purge.userId).toBe("mine");
    expectCutoff(purge.deletedAt);
    expect(mocks.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(mocks.findMany.mock.invocationCallOrder[0]);

    const query = mocks.findMany.mock.calls[0][0];
    expect(query.where.userId).toBe("mine");
    expectCutoff(query.where.deletedAt);
    expect(query.orderBy).toEqual([{ deletedAt: "desc" }, { id: "desc" }]);
    // 本文は取らない。
    expect(query.select).toEqual({ id: true, title: true, icon: true, deletedAt: true });
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
  beforeEach(() => { vi.clearAllMocks(); });
  const summary = { id: "n1", position: 2, title: "Plan", icon: null, version: 5, groupId: null, createdAt: new Date(), updatedAt: new Date() };

  it("restores a note that is in the trash and within retention, answering with a list item", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findFirst.mockResolvedValue(summary);
    const response = await restore(call("POST"), context);
    expect(response.status).toBe(200);
    expect((await response.json()).page.id).toBe("n1");
    const { where, data } = mocks.updateMany.mock.calls[0][0];
    expect(where).toMatchObject({ id: "n1", userId: "mine" });
    expectCutoff(where.deletedAt);
    expect(where.deletedAt.gte).toBeInstanceOf(Date);
    expect(data).toEqual({ deletedAt: null });
    const read = mocks.findFirst.mock.calls[0][0];
    expect(read.where).toEqual({ id: "n1", userId: "mine", deletedAt: null });
    // GET /api/pages の 1 件と同じ項目だけ。
    expect(read.select).toEqual({ id: true, position: true, title: true, icon: true, version: true, groupId: true, createdAt: true, updatedAt: true });
  });

  it("answers 404 for a live note, someone else's note, an unknown note and a note past retention", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    const response = await restore(call("POST"), context);
    expect(response.status).toBe(404);
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/pages/trash/:pageId (delete forever)", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("deletes one trashed note of this user permanently", async () => {
    mocks.deleteMany.mockResolvedValue({ count: 1 });
    const response = await deleteForever(call("DELETE"), context);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: { id: "n1", userId: "mine", deletedAt: { not: null } } });
  });

  it("cannot delete a live note or another user's note through the trash", async () => {
    mocks.deleteMany.mockResolvedValue({ count: 0 });
    expect((await deleteForever(call("DELETE"), context)).status).toBe(404);
  });
});
