import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getOrCreateUser: vi.fn(),
  findMany: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getOrCreateUser: mocks.getOrCreateUser }));
vi.mock("@/lib/prisma", () => ({
  prisma: { notePage: { findMany: mocks.findMany } },
}));
import { POST } from "./route";

function post(body: unknown) {
  return new Request("https://app.notefable.com/api/pages/card-previews", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getOrCreateUser.mockResolvedValue({ id: "user1" });
  mocks.findMany.mockResolvedValue([]);
});

describe("POST /api/pages/card-previews", () => {
  it("batches owned non-deleted pages with latest title, icon and short summary", async () => {
    mocks.findMany.mockResolvedValue([
      {
        id: "n1",
        kind: "note",
        title: "Renamed Note",
        icon: "🚀",
        blocks: [{ id: "b1", type: "paragraph", content: [{ type: "text", text: "First line of notes." }], children: [] }],
        canvas: null,
      },
      {
        id: "w1",
        kind: "whiteboard",
        title: "System Map",
        icon: null,
        blocks: [],
        canvas: { segments: [{ id: "e1", text: "API" }, { id: "e2", text: "Database" }] },
      },
    ]);

    const response = await POST(post({ ids: ["n1", "w1", "deleted_or_other", "n1", "bad id!"] }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ["n1", "w1", "deleted_or_other"] }, userId: "user1", deletedAt: null },
    }));

    const json = await response.json();
    expect(json.cards).toEqual({
      n1: { id: "n1", kind: "note", title: "Renamed Note", icon: "🚀", summary: "First line of notes." },
      w1: { id: "w1", kind: "whiteboard", title: "System Map", icon: null, summary: "API · Database" },
    });
    expect(json.cards.deleted_or_other).toBeUndefined();
  });

  it("returns empty map without querying DB when no valid ids are given", async () => {
    const response = await POST(post({ ids: ["bad id", ""] }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ cards: {} });
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("rejects malformed request bodies", async () => {
    const response = await POST(post({ ids: "not-an-array" }));
    expect(response.status).toBe(400);
  });
});
