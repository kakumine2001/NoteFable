import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findNote: vi.fn(),
  findSession: vi.fn(),
  findMessages: vi.fn(),
  proposalsByMessage: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getOrCreateUser: async () => ({ id: "user-1" }) }));
vi.mock("@/lib/note-proposals", () => ({ proposalsByMessage: mocks.proposalsByMessage }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    notePage: { findFirst: mocks.findNote },
    session: { findFirst: mocks.findSession },
    message: { findMany: mocks.findMessages },
  },
}));

import { GET } from "./route";

describe("GET /api/pages/[pageId]/assistant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findNote.mockResolvedValue({ id: "page-1" });
    mocks.findSession.mockResolvedValue(null);
    mocks.findMessages.mockResolvedValue([]);
    mocks.proposalsByMessage.mockResolvedValue(new Map());
  });

  it("returns 404 when the note is missing, trashed, or owned by another user", async () => {
    mocks.findNote.mockResolvedValue(null);
    const response = await GET(new Request("http://localhost/api/pages/page-1/assistant"), { params: Promise.resolve({ pageId: "page-1" }) });
    expect(response.status).toBe(404);
    expect(mocks.findNote).toHaveBeenCalledWith({
      where: { id: "page-1", userId: "user-1", deletedAt: null },
      select: { id: true },
    });
    expect(mocks.findSession).not.toHaveBeenCalled();
  });

  it("returns an empty history when the note has no assistant session yet", async () => {
    const response = await GET(new Request("http://localhost/api/pages/page-1/assistant"), { params: Promise.resolve({ pageId: "page-1" }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ sessionId: null, messages: [] });
  });

  it("returns active messages and bound proposals from the latest assistant session", async () => {
    mocks.findSession.mockResolvedValue({ id: "sess-latest" });
    mocks.findMessages.mockResolvedValue([
      {
        id: "m1",
        role: "USER",
        content: "> excerpt\n\nImprove this",
        model: "gpt-6-luna",
        reasoningEffort: "MEDIUM",
        activity: null,
        thinkingMs: null,
        createdAt: "2026-11-22T00:00:00.000Z",
        attachments: [{ id: "a1", filename: "shot.png", mimeType: "image/png", size: 42, imageStoragePath: "images/secret.png" }],
        notes: [{ note: { id: "ref-1", title: "Spec", icon: "📄" } }],
      },
      {
        id: "m2",
        role: "ASSISTANT",
        content: "Here is a suggestion.",
        model: "gpt-6-luna",
        reasoningEffort: "MEDIUM",
        activity: null,
        thinkingMs: 900,
        createdAt: "2026-11-22T00:00:02.000Z",
        attachments: [],
        notes: [],
      },
    ]);
    mocks.proposalsByMessage.mockResolvedValue(new Map([["m2", [{ id: "p1", kind: "edit", status: "pending" }]]]));

    const response = await GET(new Request("http://localhost/api/pages/page-1/assistant"), { params: Promise.resolve({ pageId: "page-1" }) });
    expect(response.status).toBe(200);
    expect(mocks.findSession).toHaveBeenCalledWith({
      where: { userId: "user-1", noteId: "page-1" },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      select: { id: true },
    });
    expect(mocks.findMessages).toHaveBeenCalledWith(expect.objectContaining({
      where: { sessionId: "sess-latest", active: true },
    }));
    const body = await response.json();
    expect(body.sessionId).toBe("sess-latest");
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].pages).toEqual([{ id: "ref-1", title: "Spec", icon: "📄" }]);
    expect(body.messages[0].attachments[0]).toEqual({
      id: "a1",
      filename: "shot.png",
      mimeType: "image/png",
      size: 42,
      dataUrl: "/api/attachments/a1/image",
    });
    expect(body.messages[0].attachments[0]).not.toHaveProperty("imageStoragePath");
    expect(body.messages[1].proposals).toEqual([{ id: "p1", kind: "edit", status: "pending" }]);
  });
});
