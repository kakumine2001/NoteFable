import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ find: vi.fn(), update: vi.fn(), remove: vi.fn(), limited: false }));
vi.mock("@/lib/auth", () => ({ getOrCreateAnonymousUser: async () => ({ id: "mine" }) }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => ({ limited: mocks.limited }), rateLimitHeaders: () => ({}) }));
vi.mock("@/lib/prisma", () => {
  const notePage = { findFirst: mocks.find, updateMany: mocks.update, deleteMany: mocks.remove };
  return { prisma: { notePage, $transaction: async (fn: (tx: unknown) => unknown) => fn({ notePage }) } };
});
import { DELETE, GET, PATCH } from "./route";

const context = { params: Promise.resolve({ pageId: "p1" }) };
const page = { id: "p1", title: "Saved", icon: null, cover: null, coverPosition: null, blocks: [], version: 2 };
function request(version = 1, title = "Mine") { return new Request("http://localhost/api/pages/p1", { method: "PATCH", body: JSON.stringify({ title, blocks: [], version }) }); }

describe("page ownership and save concurrency", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.limited = false; });

  it("does not read or delete a page from another device", async () => {
    mocks.find.mockResolvedValue(null);
    mocks.remove.mockResolvedValue({ count: 0 });
    expect((await GET(request(), context)).status).toBe(404);
    expect((await DELETE(request(), context)).status).toBe(404);
    expect(mocks.find).toHaveBeenCalledWith({ where: { id: "p1", userId: "mine" } });
    expect(mocks.remove).toHaveBeenCalledWith({ where: { id: "p1", userId: "mine" } });
  });

  it("rejects stale writes and returns the latest owned page", async () => {
    mocks.update.mockResolvedValue({ count: 0 });
    mocks.find.mockResolvedValue(page);
    const result = await PATCH(request(), context);
    expect(result.status).toBe(409);
    expect((await result.json()).page).toEqual(page);
    expect(mocks.update.mock.calls[0][0].where).toEqual({ id: "p1", userId: "mine", version: 1 });
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

  it("updates title and blocks together and enforces the write limit", async () => {
    mocks.update.mockResolvedValue({ count: 1 });
    mocks.find.mockResolvedValue(page);
    expect((await PATCH(request(), context)).status).toBe(200);
    expect(mocks.update.mock.calls[0][0].data).toEqual({ title: "Mine", blocks: [], version: { increment: 1 } });
    mocks.limited = true;
    expect((await PATCH(request(), context)).status).toBe(429);
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });
});

describe("page metadata from older clients", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.limited = false; });

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
