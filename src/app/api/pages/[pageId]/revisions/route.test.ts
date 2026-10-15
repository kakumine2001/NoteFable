import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pageFind: vi.fn(), pageUpdate: vi.fn(), revFindMany: vi.fn(), revFind: vi.fn(), revCreate: vi.fn(), revDelete: vi.fn(), raw: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getOrCreateAnonymousUser: async () => ({ id: "mine" }) }));
vi.mock("@/lib/prisma", () => {
  const notePage = { findFirst: mocks.pageFind, updateMany: mocks.pageUpdate };
  const noteRevision = { findMany: mocks.revFindMany, findFirst: mocks.revFind, create: mocks.revCreate, deleteMany: mocks.revDelete };
  const tx = { notePage, noteRevision, $executeRaw: mocks.raw, $executeRawUnsafe: vi.fn() };
  return { databaseSchema: "studymate", prisma: { notePage, noteRevision, $transaction: async (fn: (tx: unknown) => unknown) => fn(tx) } };
});
import { GET as listRevisions } from "./route";
import { GET as readRevision } from "./[revisionId]/route";
import { POST as restore } from "./[revisionId]/restore/route";

const para = (id: string, text: string) => ({ id, type: "paragraph", props: {}, content: [{ type: "text", text, styles: {} }], children: [] });
const listContext = { params: Promise.resolve({ pageId: "n1" }) };
const context = { params: Promise.resolve({ pageId: "n1", revisionId: "r1" }) };
const createdAt = new Date("2026-10-14T08:00:00.000Z");
const stored = { id: "r1", noteId: "n1", userId: "mine", reason: "AUTO", title: "Old title", icon: "📚", blocks: [para("a", "old text")], version: 3, createdAt };
const live = { id: "n1", userId: "mine", title: "Current", icon: null, cover: "solid-red", coverPosition: null, blocks: [para("b", "current text")], version: 6, deletedAt: null };
const restoreRequest = (body: unknown) => new Request("http://localhost/api/pages/n1/revisions/r1/restore", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });

describe("GET /api/pages/:id/revisions", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("lists the newest revisions first without their blocks", async () => {
    mocks.pageFind.mockResolvedValue({ id: "n1" });
    mocks.revFindMany.mockResolvedValue([{ id: "r2", reason: "AI_EDIT", title: "B", version: 5, createdAt }, { id: "r1", reason: "AUTO", title: "A", version: 3, createdAt }]);
    const response = await listRevisions(new Request("http://localhost"), listContext);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revisions: [
      { id: "r2", reason: "AI_EDIT", title: "B", version: 5, createdAt: createdAt.toISOString() },
      { id: "r1", reason: "AUTO", title: "A", version: 3, createdAt: createdAt.toISOString() },
    ] });
    expect(mocks.pageFind).toHaveBeenCalledWith({ where: { id: "n1", userId: "mine", deletedAt: null }, select: { id: true } });
    const query = mocks.revFindMany.mock.calls[0][0];
    expect(query.where).toEqual({ noteId: "n1", userId: "mine" });
    expect(query.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
    expect(query.select).toEqual({ id: true, reason: true, title: true, version: true, createdAt: true });
  });

  it("answers 404 for another user's note and for a trashed note", async () => {
    mocks.pageFind.mockResolvedValue(null);
    mocks.revFindMany.mockResolvedValue([]);
    const response = await listRevisions(new Request("http://localhost"), listContext);
    expect(response.status).toBe(404);
    expect(await response.json()).not.toHaveProperty("revisions");
  });
});

describe("GET /api/pages/:id/revisions/:revisionId", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns one revision with its content", async () => {
    mocks.revFind.mockResolvedValue(stored);
    const response = await readRevision(new Request("http://localhost"), context);
    expect((await response.json()).revision).toEqual({ id: "r1", reason: "AUTO", title: "Old title", icon: "📚", blocks: stored.blocks, version: 3, createdAt: createdAt.toISOString() });
    expect(mocks.revFind.mock.calls[0][0].where).toEqual({ id: "r1", noteId: "n1", userId: "mine", note: { userId: "mine", deletedAt: null } });
  });

  it("answers 404 for an unknown revision, another user's, a trashed note's or another note's", async () => {
    mocks.revFind.mockResolvedValue(null);
    expect((await readRevision(new Request("http://localhost"), context)).status).toBe(404);
  });
});

describe("POST /api/pages/:id/revisions/:revisionId/restore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.raw.mockResolvedValue(0);
    mocks.revFindMany.mockResolvedValue([]);
  });

  it("restores title, icon and blocks with version + 1, after keeping the current state as a RESTORE revision", async () => {
    const restored = { ...live, title: "Old title", icon: "📚", blocks: stored.blocks, version: 7 };
    mocks.pageFind.mockResolvedValueOnce(live).mockResolvedValueOnce(restored);
    mocks.revFind.mockResolvedValue(stored);
    mocks.pageUpdate.mockResolvedValue({ count: 1 });
    const response = await restore(restoreRequest({ version: 6 }), context);
    expect(response.status).toBe(200);
    expect((await response.json()).page).toMatchObject({ title: "Old title", version: 7, cover: "solid-red" });

    expect(mocks.revFind.mock.calls[0][0].where).toEqual({ id: "r1", noteId: "n1", userId: "mine" });
    expect(mocks.revCreate).toHaveBeenCalledWith({ data: { noteId: "n1", userId: "mine", reason: "RESTORE", title: "Current", icon: null, blocks: live.blocks, version: 6 } });
    const update = mocks.pageUpdate.mock.calls[0][0];
    expect(update.where).toEqual({ id: "n1", userId: "mine", version: 6, deletedAt: null });
    // カバー・カバー位置・グループには触れない。
    expect(update.data).toEqual({ title: "Old title", icon: "📚", blocks: stored.blocks, version: { increment: 1 } });
    expect(mocks.revCreate.mock.invocationCallOrder[0]).toBeLessThan(mocks.pageUpdate.mock.invocationCallOrder[0]);
  });

  it("answers 409 with the latest page when the client's version is stale, and changes nothing", async () => {
    mocks.pageFind.mockResolvedValue(live);
    mocks.revFind.mockResolvedValue(stored);
    const response = await restore(restoreRequest({ version: 5 }), context);
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toBe("This note was changed in another tab.");
    expect(body.page.version).toBe(6);
    expect(mocks.revCreate).not.toHaveBeenCalled();
    expect(mocks.pageUpdate).not.toHaveBeenCalled();
  });

  it("answers 409 when another tab saved between the read and the write (the added revision is rolled back)", async () => {
    mocks.pageFind.mockResolvedValue(live);
    mocks.revFind.mockResolvedValue(stored);
    mocks.pageUpdate.mockResolvedValue({ count: 0 });
    const response = await restore(restoreRequest({ version: 6 }), context);
    expect(response.status).toBe(409);
    expect((await response.json()).page.id).toBe("n1");
    expect(mocks.revCreate).toHaveBeenCalledTimes(1); // 実 DB ではトランザクションの巻き戻しで消える
  });

  it("answers 404 for another user's or a trashed note, and for a revision that is not this note's", async () => {
    mocks.pageFind.mockResolvedValue(null);
    expect((await restore(restoreRequest({ version: 6 }), context)).status).toBe(404);
    expect(mocks.revFind).not.toHaveBeenCalled();
    mocks.pageFind.mockResolvedValue(live);
    mocks.revFind.mockResolvedValue(null);
    const response = await restore(restoreRequest({ version: 6 }), context);
    expect(response.status).toBe(404);
    expect(mocks.pageUpdate).not.toHaveBeenCalled();
  });

  it("requires a valid version in the body", async () => {
    for (const body of [{}, { version: "6" }, { version: -1 }, { version: 1.5 }, "not json"]) {
      expect((await restore(restoreRequest(body), context)).status).toBe(400);
    }
    expect(mocks.pageFind).not.toHaveBeenCalled();
  });

  it("re-validates stored content and refuses a revision that points at someone else's file", async () => {
    mocks.pageFind.mockResolvedValue(live);
    mocks.revFind.mockResolvedValue({ ...stored, title: "x".repeat(300) });
    expect((await restore(restoreRequest({ version: 6 }), context)).status).toBe(400);
    const foreign = { id: "i", type: "image", props: { url: "/api/pages/files?key=note-files%2Fsomeoneelse%2F0e111e3a-9e25-4944-ade7-b460580fa925.png&name=a.png" }, children: [] };
    mocks.revFind.mockResolvedValue({ ...stored, blocks: [foreign] });
    const response = await restore(restoreRequest({ version: 6 }), context);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/cannot be restored.*not yours/);
    expect(mocks.revCreate).not.toHaveBeenCalled();
    expect(mocks.pageUpdate).not.toHaveBeenCalled();
  });
});
