import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ updateMany: vi.fn(), findFirst: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getOrCreateAnonymousUser: async () => ({ id: "mine" }) }));
vi.mock("@/lib/prisma", () => ({ databaseSchema: "studymate", prisma: { notePage: { updateMany: mocks.updateMany, findFirst: mocks.findFirst } } }));
import { PUT } from "./route";

const context = { params: Promise.resolve({ pageId: "n1" }) };
const call = (body: unknown) => PUT(new Request("http://localhost/api/pages/n1/icon", { method: "PUT", body: JSON.stringify(body) }), context);

describe("PUT /api/pages/:id/icon", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("sets the icon on an owned, live note and bumps the version so stale saves conflict", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findFirst.mockResolvedValue({ id: "n1", icon: "📚", version: 4 });
    const response = await call({ icon: "📚" });
    expect(response.status).toBe(200);
    expect((await response.json()).page).toMatchObject({ id: "n1", icon: "📚", version: 4 });
    expect(mocks.updateMany).toHaveBeenCalledWith({ where: { id: "n1", userId: "mine", deletedAt: null }, data: { icon: "📚", version: { increment: 1 } } });
  });

  it("removes the icon with null", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findFirst.mockResolvedValue({ id: "n1", icon: null, version: 5 });
    expect((await call({ icon: null })).status).toBe(200);
    expect(mocks.updateMany.mock.calls[0][0].data.icon).toBeNull();
  });

  it("rejects anything that is not a single emoji without writing", async () => {
    for (const icon of ["abc", "", 5, ["📚"]]) expect((await call({ icon })).status).toBe(400);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("answers 404 for another user's, a missing or a trashed note", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    expect((await call({ icon: "📚" })).status).toBe(404);
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });
});
