import { beforeEach, describe, expect, it, vi } from "vitest";
import { termMatcher } from "@/lib/search-fold";

const mocks = vi.hoisted(() => ({ queryRaw: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getOrCreateUser: async () => ({ id: "mine" }) }));
vi.mock("@/lib/prisma", () => ({ databaseSchema: "studymate", prisma: { $queryRaw: mocks.queryRaw } }));
import { GET } from "./route";

const updatedAt = new Date("2026-10-01T00:00:00Z");
const text = (value: string) => ({ type: "text", text: value, styles: {} });
const get = (query: string) => GET(new Request(`http://localhost/api/search${query}`));
const calls = (table: string) => mocks.queryRaw.mock.calls.filter(([sql]) => (sql as { sql: string }).sql.includes(table));
const valuesOf = (table: string) => (calls(table)[0][0] as { values: unknown[] }).values;
const regexOf = (term: string) => termMatcher(term).regex;

describe("GET /api/search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // SQL の対象テーブルで、ノートの行と会話の行を出し分ける。
    mocks.queryRaw.mockImplementation(async (query: { sql: string }) => query.sql.includes('"NotePage"')
      ? [{ id: "n1", title: "Biology", icon: "🧬", updatedAt, blocks: [{ id: "b1", type: "paragraph", props: {}, content: [text("Mitosis notes")], children: [] }] }]
      : [{ id: "s1", title: "Exam", icon: null, projectId: "p1", updatedAt, titleMatch: false, messageId: "m1", role: "USER", attachmentName: "notes.pdf", excerpt: "about mitosis" }]);
  });

  it("returns notes and chats for the current user with the documented shape", async () => {
    const response = await get("?q=%20Mitosis%20");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      query: "Mitosis",
      notes: [{ kind: "note", id: "n1", title: "Biology", icon: "🧬", snippet: "Mitosis notes", blockId: "b1", updatedAt: updatedAt.toISOString() }],
      chats: [{ kind: "chat", id: "s1", title: "Exam", icon: null, snippet: "about mitosis", messageId: "m1", role: "USER", attachmentName: "notes.pdf", projectId: "p1", titleMatch: false, updatedAt: updatedAt.toISOString() }],
    });
    expect(mocks.queryRaw).toHaveBeenCalledTimes(2);
    for (const [query] of mocks.queryRaw.mock.calls) expect((query as { values: unknown[] }).values).toContain("mine");
  });

  it("splits the query into folded lowercase terms", async () => {
    await get("?q=Cell%20DIVISION%20cell");
    const values = valuesOf('"NotePage"');
    expect(values).toEqual(expect.arrayContaining([regexOf("cell"), regexOf("division")]));
    // 重複した語は 1 つにまとまる（タイトルと本文で 2 回、並べ替えで 1 回）。
    expect(values.filter((value) => value === regexOf("cell"))).toHaveLength(3);
  });

  it("searches other spellings: full-width letters, half-width kana and hiragana fold to the same terms", async () => {
    await get(`?q=${encodeURIComponent("ＡＰＩ　でーた ﾃﾞｰﾀ")}&scope=notes`);
    const values = valuesOf('"NotePage"');
    expect(values).toEqual(expect.arrayContaining([regexOf("api"), regexOf("データ")]));
    // 全角の英字や半角カナのままの語は、DB に渡さない。
    expect(values).not.toContain(regexOf("ａｐｉ"));
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

  describe("projectId", () => {
    it("narrows the chats search to the project, leaving notes alone", async () => {
      const body = await (await get("?q=mitosis&projectId=cproj123")).json();
      expect(body.chats).toHaveLength(1);
      expect(body.notes).toHaveLength(1);
      expect(valuesOf('"Session"')).toContain("cproj123");
      expect(valuesOf('"NotePage"')).not.toContain("cproj123");
      // 絞り込んでも、利用者本人の分だけを探す。
      expect(valuesOf('"Session"').filter((value) => value === "mine")).toHaveLength(3);
      expect(valuesOf('"Session"').filter((value) => value === "cproj123")).toHaveLength(3);
    });

    it("also narrows scope=chats, and has no effect on scope=notes", async () => {
      await get("?q=mitosis&scope=chats&projectId=cproj123");
      expect(valuesOf('"Session"')).toContain("cproj123");

      mocks.queryRaw.mockClear();
      const notes = await (await get("?q=mitosis&scope=notes&projectId=cproj123")).json();
      expect(notes.notes).toHaveLength(1);
      expect(notes.chats).toEqual([]);
      expect(calls('"Message"')).toHaveLength(0);
      expect(valuesOf('"NotePage"')).not.toContain("cproj123");
    });

    it("does not narrow the search when projectId is missing or blank", async () => {
      await get("?q=mitosis");
      expect((calls('"Session"')[0][0] as { sql: string }).sql).not.toContain('"projectId" =');
      mocks.queryRaw.mockClear();
      await get("?q=mitosis&projectId=");
      expect((calls('"Session"')[0][0] as { sql: string }).sql).not.toContain('"projectId" =');
      mocks.queryRaw.mockClear();
      await get("?q=mitosis&projectId=%20%20");
      expect((calls('"Session"')[0][0] as { sql: string }).sql).not.toContain('"projectId" =');
    });

    it("returns whatever the database finds for an unknown project, which is simply no chats", async () => {
      mocks.queryRaw.mockImplementation(async (query: { sql: string }) => (query.sql.includes('"NotePage"') ? [] : []));
      const response = await get("?q=mitosis&projectId=someoneelses");
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ query: "mitosis", notes: [], chats: [] });
    });

    it.each([["a b"], ["x;y"], ["p'q"], ["../etc"], ["p".repeat(65)], ["日本語"]])("rejects a malformed project id: %s", async (projectId) => {
      const response = await get(`?q=mitosis&projectId=${encodeURIComponent(projectId)}`);
      expect(response.status).toBe(400);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await response.json()).toEqual({ error: expect.any(String) });
      expect(mocks.queryRaw).not.toHaveBeenCalled();
    });

    it("accepts ids made of letters, digits, hyphens and underscores up to 64 characters", async () => {
      expect((await get(`?q=x&projectId=${"p".repeat(64)}`)).status).toBe(200);
      expect((await get("?q=x&projectId=clx9_a-Z0")).status).toBe(200);
    });
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
