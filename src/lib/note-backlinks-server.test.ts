import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  sessionFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  databaseSchema: "notefable",
  prisma: {
    $queryRaw: mocks.queryRaw,
    session: { findMany: mocks.sessionFindMany },
  },
}));

import { findNoteBacklinks } from "@/lib/note-backlinks-server";

const origin = "https://app.notefable.com";
const row = (overrides: Record<string, unknown>) => ({ kind: "note", title: "Page", icon: null, mentioned: false, hrefs: [], ...overrides });

describe("findNoteBacklinks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queryRaw.mockResolvedValue([]);
    mocks.sessionFindMany.mockResolvedValue([]);
  });

  it("keeps mentions and confirmed links of any page kind, drops candidates whose ids only look alike", async () => {
    mocks.queryRaw.mockResolvedValue([
      row({ id: "a", title: "Mentions", mentioned: true }),
      row({ id: "b", title: "Links", hrefs: ["/app?view=pages&page=target"] }),
      row({ id: "c", title: "Longer id", hrefs: ["/app?view=pages&page=target2"] }),
      row({ id: "d", title: "Other site", hrefs: ["https://evil.example/?view=pages&page=target"] }),
      row({ id: "w", kind: "whiteboard", title: "Board", icon: "🧩", hrefs: ["/app?view=pages&page=target"] }),
      row({ id: "s", kind: "slides", title: "Deck", hrefs: [`${origin}/?view=pages&page=target`] }),
    ]);
    const result = await findNoteBacklinks("me", "target", origin);
    expect(result.pages).toEqual([
      { id: "a", kind: "note", title: "Mentions", icon: null },
      { id: "b", kind: "note", title: "Links", icon: null },
      { id: "w", kind: "whiteboard", title: "Board", icon: "🧩" },
      { id: "s", kind: "slides", title: "Deck", icon: null },
    ]);
  });

  it("scopes the page query to the owner, live pages and other pages, and never reads canvas bodies", async () => {
    await findNoteBacklinks("me", "target", origin);
    const sql = mocks.queryRaw.mock.calls[0][0] as { sql: string; values: unknown[] };
    expect(sql.sql).toContain('p."deletedAt" IS NULL');
    expect(sql.sql).toContain('p."id" <>');
    expect(sql.sql).toContain('"notefable"."NotePage"');
    expect(sql.sql).toContain('c."links"');
    // Links that cannot be page links (such as public share URLs holding the id) never take a candidate slot.
    expect(sql.sql).toContain("strpos(h, 'view=pages') > 0");
    expect(sql.sql).not.toContain('c."data"');
    expect(sql.values).toContain("me");
    expect(sql.values).toContain("target");
  });

  it("selects chats as units: started in the note, or with an active message attaching it", async () => {
    mocks.sessionFindMany.mockResolvedValue([
      { id: "attached", title: "Attached", icon: null, noteId: null, messages: [{ id: "m3" }] },
      { id: "panel", title: "Panel", icon: "💬", noteId: "target", messages: [{ id: "m1" }] },
      { id: "other-panel", title: "Elsewhere", icon: null, noteId: "another", messages: [{ id: "m9" }] },
    ]);
    const result = await findNoteBacklinks("me", "target", origin);
    // A chat started in this note opens at its end; one that attached it opens at that message.
    expect(result.chats).toEqual([
      { id: "attached", title: "Attached", icon: null, messageId: "m3" },
      { id: "panel", title: "Panel", icon: "💬", messageId: null },
      { id: "other-panel", title: "Elsewhere", icon: null, messageId: "m9" },
    ]);
    const attaching = { active: true, notes: { some: { noteId: "target" } } };
    expect(mocks.sessionFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "me", OR: [{ noteId: "target" }, { messages: { some: attaching } }] },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: 50,
      select: expect.objectContaining({ messages: { where: attaching, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1, select: { id: true } } }),
    }));
  });
});
