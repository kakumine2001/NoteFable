import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findNoteBacklinks: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getOrCreateUser: async () => ({ id: "mine" }) }));
vi.mock("@/lib/note-backlinks-server", () => ({ findNoteBacklinks: mocks.findNoteBacklinks }));
vi.mock("@/lib/prisma", () => ({ prisma: { notePage: { findFirst: mocks.findFirst } } }));

import { GET } from "./route";

const context = { params: Promise.resolve({ pageId: "n1" }) };
const call = () => GET(new Request("https://app.notefable.com/api/pages/n1/backlinks"), context);

describe("GET /api/pages/:id/backlinks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findNoteBacklinks.mockResolvedValue({ pages: [{ id: "p1", kind: "note", title: "Links here", icon: null }], chats: [] });
  });

  it("returns the backlinks of an owned live page without caching", async () => {
    mocks.findFirst.mockResolvedValue({ id: "n1" });
    const response = await call();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ pages: [{ id: "p1", kind: "note", title: "Links here", icon: null }], chats: [] });
    expect(mocks.findFirst).toHaveBeenCalledWith({ where: { id: "n1", userId: "mine", deletedAt: null }, select: { id: true } });
    expect(mocks.findNoteBacklinks).toHaveBeenCalledWith("mine", "n1", "https://app.notefable.com");
  });

  it("answers 404 for another user's, missing or trashed page", async () => {
    mocks.findFirst.mockResolvedValue(null);
    const response = await call();
    expect(response.status).toBe(404);
    expect(await response.json()).not.toHaveProperty("pages");
  });
});
