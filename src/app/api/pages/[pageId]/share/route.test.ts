import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  resolveOwnerShareState: vi.fn(),
  updatePageShareMeta: vi.fn(),
  sharedPageSummary: vi.fn(),
  generateShareToken: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getOrCreateUser: async () => ({ id: "mine" }) }));
vi.mock("@/lib/prisma", () => ({
  databaseSchema: "notefable",
  prisma: { notePage: { findFirst: mocks.findFirst } },
}));
vi.mock("@/lib/note-share-server", async (original) => ({
  ...(await original<typeof import("@/lib/note-share-server")>()),
  resolveOwnerShareState: mocks.resolveOwnerShareState,
  updatePageShareMeta: mocks.updatePageShareMeta,
  sharedPageSummary: mocks.sharedPageSummary,
  generateShareToken: mocks.generateShareToken,
}));

import { GET, PUT } from "./route";

const context = { params: Promise.resolve({ pageId: "p1" }) };
const get = () => new Request("http://localhost:3000/api/pages/p1/share");
const put = (body: unknown) =>
  new Request("http://localhost:3000/api/pages/p1/share", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const sampleShare = {
  enabled: true,
  active: true,
  expired: false,
  token: "generated-token-123",
  url: "http://localhost:3000/s/generated-token-123",
  includeSubpages: true,
  expiresAt: null,
  excludeFromParent: false,
  inheritedFrom: null,
  inheritedUrl: null,
};

describe("/api/pages/[pageId]/share", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.generateShareToken.mockReturnValue("generated-token-123");
    mocks.findFirst.mockResolvedValue({ id: "p1", shareToken: null, shareEnabled: false, shareExpiresAt: null });
    mocks.updatePageShareMeta.mockResolvedValue(1);
    mocks.resolveOwnerShareState.mockResolvedValue(sampleShare);
    mocks.sharedPageSummary.mockResolvedValue({ id: "p1", shareEnabled: true, shareExpiresAt: null });
  });

  it("GET returns owner share state or 404 when missing", async () => {
    const ok = await GET(get(), context);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ share: sampleShare });

    mocks.resolveOwnerShareState.mockResolvedValueOnce(null);
    expect((await GET(get(), context)).status).toBe(404);
  });

  it("PUT generates a share token on first publish", async () => {
    const res = await PUT(put({ enabled: true }), context);
    expect(res.status).toBe(200);
    expect(mocks.updatePageShareMeta).toHaveBeenCalledWith("mine", "p1", {
      shareEnabled: true,
      shareToken: "generated-token-123",
    });
  });

  it("PUT clears past expiration when republishing without explicit expiresAt", async () => {
    mocks.findFirst.mockResolvedValueOnce({
      id: "p1",
      shareToken: "existing-token-999",
      shareEnabled: true,
      shareExpiresAt: new Date("2020-01-01T00:00:00.000Z"),
    });
    const res = await PUT(put({ enabled: true }), context);
    expect(res.status).toBe(200);
    expect(mocks.updatePageShareMeta).toHaveBeenCalledWith("mine", "p1", {
      shareEnabled: true,
      shareExpiresAt: null,
    });
  });

  it("PUT accepts future expiration, null expiration, includeSubpages and excludeFromParent", async () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    expect((await PUT(put({ includeSubpages: false, expiresAt: future, excludeFromParent: true }), context)).status).toBe(200);
    expect(mocks.updatePageShareMeta).toHaveBeenCalledWith("mine", "p1", {
      shareIncludeSubpages: false,
      shareExpiresAt: new Date(future),
      shareExcludeFromParent: true,
    });

    expect((await PUT(put({ expiresAt: null }), context)).status).toBe(200);
    expect(mocks.updatePageShareMeta).toHaveBeenLastCalledWith("mine", "p1", { shareExpiresAt: null });
  });

  it("PUT rejects past expiration, invalid fields, and empty bodies", async () => {
    for (const body of [
      { expiresAt: "2020-01-01T00:00:00.000Z" },
      { expiresAt: "not-a-date" },
      { enabled: "yes" },
      { includeSubpages: 1 },
      { excludeFromParent: "no" },
      {},
    ]) {
      expect((await PUT(put(body), context)).status).toBe(400);
    }
    expect(mocks.updatePageShareMeta).not.toHaveBeenCalled();
  });

  it("PUT returns 404 when page is not found", async () => {
    mocks.findFirst.mockResolvedValueOnce(null);
    expect((await PUT(put({ enabled: true }), context)).status).toBe(404);
  });
});
