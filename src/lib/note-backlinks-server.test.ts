import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  sessionFindMany: vi.fn(),
  messageNoteFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  databaseSchema: "notefable",
  prisma: {
    $queryRaw: mocks.queryRaw,
    session: { findMany: mocks.sessionFindMany },
    messageNote: { findMany: mocks.messageNoteFindMany },
  },
}));

import { findNoteBacklinks } from "@/lib/note-backlinks-server";

const origin = "https://app.notefable.com";
const row = (overrides: Record<string, unknown>) => ({ kind: "note", title: "Page", icon: null, mentioned: false, hrefs: null, elements: null, ...overrides });
const session = (id: string, updatedAt: string, title = id) => ({ id, title, icon: null, updatedAt: new Date(updatedAt) });

describe("findNoteBacklinks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queryRaw.mockResolvedValue([]);
    mocks.sessionFindMany.mockResolvedValue([]);
    mocks.messageNoteFindMany.mockResolvedValue([]);
  });

  it("keeps mentions and confirmed links, drops candidates whose ids only look alike", async () => {
    mocks.queryRaw.mockResolvedValue([
      row({ id: "a", title: "Mentions", mentioned: true }),
      row({ id: "b", title: "Links", hrefs: ["/app?view=pages&page=target"] }),
      row({ id: "c", title: "Longer id", hrefs: ["/app?view=pages&page=target2"] }),
      row({ id: "d", title: "Other site", hrefs: ["https://evil.example/?view=pages&page=target"] }),
      row({ id: "w", kind: "whiteboard", title: "Board", icon: "🧩", elements: [{ id: "e", type: "rectangle", customData: { notefablePage: { id: "target", kind: "note" } } }] }),
      row({ id: "x", kind: "whiteboard", title: "Deleted card", elements: [{ id: "e", type: "rectangle", isDeleted: true, link: "/app?view=pages&page=target" }] }),
    ]);
    const result = await findNoteBacklinks("me", "target", origin);
    expect(result.pages).toEqual([
      { id: "a", kind: "note", title: "Mentions", icon: null },
      { id: "b", kind: "note", title: "Links", icon: null },
      { id: "w", kind: "whiteboard", title: "Board", icon: "🧩" },
    ]);
  });

  it("scopes the page query to the owner, live pages and other pages", async () => {
    await findNoteBacklinks("me", "target", origin);
    const sql = mocks.queryRaw.mock.calls[0][0] as { sql: string; values: unknown[] };
    expect(sql.sql).toContain('p."deletedAt" IS NULL');
    expect(sql.sql).toContain('p."id" <>');
    expect(sql.sql).toContain('"notefable"."NotePage"');
    expect(sql.values).toContain("me");
    expect(sql.values).toContain("target");
  });

  it("merges chats started in the note with chats that attached it, newest first", async () => {
    mocks.sessionFindMany.mockResolvedValue([session("panel", "2026-11-20T00:00:00Z")]);
    mocks.messageNoteFindMany.mockResolvedValue([
      { messageId: "m3", message: { session: session("attached", "2026-11-24T00:00:00Z") } },
      { messageId: "m2", message: { session: session("attached", "2026-11-24T00:00:00Z") } },
      { messageId: "m1", message: { session: session("panel", "2026-11-20T00:00:00Z") } },
    ]);
    const result = await findNoteBacklinks("me", "target", origin);
    expect(result.chats).toEqual([
      { id: "attached", title: "attached", icon: null, messageId: "m3" },
      { id: "panel", title: "panel", icon: null, messageId: null },
    ]);
    expect(mocks.sessionFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "me", noteId: "target" } }));
    expect(mocks.messageNoteFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { noteId: "target", message: { active: true, session: { userId: "me" } } },
    }));
  });
});
