import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ queryRaw: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getOrCreateAnonymousUser: async () => ({ id: "mine" }) }));
vi.mock("@/lib/prisma", () => ({ databaseSchema: "studymate", prisma: { $queryRaw: mocks.queryRaw } }));
import { GET } from "./route";

const updatedAt = new Date("2026-10-01T00:00:00Z");
const text = (value: string) => ({ type: "text", text: value, styles: {} });
const get = (query: string) => GET(new Request(`http://localhost/api/search${query}`));
const calls = (table: string) => mocks.queryRaw.mock.calls.filter(([sql]) => (sql as { sql: string }).sql.includes(table));

describe("GET /api/search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // SQL の対象テーブルで、ノートの行と会話の行を出し分ける。
    mocks.queryRaw.mockImplementation(async (query: { sql: string }) => query.sql.includes('"NotePage"')
      ? [{ id: "n1", title: "Biology", icon: "🧬", updatedAt, blocks: [{ id: "b1", type: "paragraph", props: {}, content: [text("Mitosis notes")], children: [] }] }]
      : [{ id: "s1", title: "Exam", icon: null, projectId: "p1", updatedAt, titleMatch: false, messageId: "m1", role: "USER", excerpt: "about mitosis" }]);
  });

  it("returns notes and chats for the current user with the documented shape", async () => {
    const response = await get("?q=%20Mitosis%20");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      query: "Mitosis",
      notes: [{ kind: "note", id: "n1", title: "Biology", icon: "🧬", snippet: "Mitosis notes", blockId: "b1", updatedAt: updatedAt.toISOString() }],
      chats: [{ kind: "chat", id: "s1", title: "Exam", icon: null, snippet: "about mitosis", messageId: "m1", role: "USER", projectId: "p1", titleMatch: false, updatedAt: updatedAt.toISOString() }],
    });
    expect(mocks.queryRaw).toHaveBeenCalledTimes(2);
    for (const [query] of mocks.queryRaw.mock.calls) expect((query as { values: unknown[] }).values).toContain("mine");
  });

  it("splits the query into lowercase terms", async () => {
    await get("?q=Cell%20DIVISION%20cell");
    const { values } = calls('"NotePage"')[0][0] as { values: unknown[] };
    expect(values).toEqual(expect.arrayContaining(["%cell%", "%division%"]));
    expect(values.filter((value) => value === "%cell%")).toHaveLength(3);
  });

  it("searches only notes for scope=notes and only chats for scope=chats", async () => {
    const notes = await (await get("?q=mitosis&scope=notes")).json();
    expect(notes.chats).toEqual([]);
    expect(notes.notes).toHaveLength(1);
    expect(calls('"Message"')).toHaveLength(0);

    mocks.queryRaw.mockClear();
    const chats = await (await get("?q=mitosis&scope=chats")).json();
    expect(chats.notes).toEqual([]);
    expect(chats.chats).toHaveLength(1);
    expect(calls('"NotePage"')).toHaveLength(0);

    mocks.queryRaw.mockClear();
    await get("?q=mitosis&scope=all");
    expect(mocks.queryRaw).toHaveBeenCalledTimes(2);
  });

  it.each([[""], ["?q="], ["?q=%20%20%09"], [`?q=${"a".repeat(101)}`], ["?scope=notes"]])("rejects a missing, blank or too long query: %s", async (query) => {
    const response = await get(query);
    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: expect.any(String) });
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });

  it("accepts a query of exactly 100 characters after trimming", async () => {
    expect((await get(`?q=%20${"a".repeat(100)}%20`)).status).toBe(200);
  });

  it.each([["?q=x&scope=everything"], ["?q=x&scope="], ["?q=x&scope=NOTES"]])("rejects an unknown scope: %s", async (query) => {
    expect((await get(query)).status).toBe(400);
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });

  it("returns a JSON 503 when the database fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.queryRaw.mockRejectedValue(new Error("down"));
    const response = await get("?q=mitosis");
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "Database is unavailable.", notes: [], chats: [] });
  });
});
