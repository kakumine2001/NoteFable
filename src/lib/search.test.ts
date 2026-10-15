import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ queryRaw: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ databaseSchema: "studymate", prisma: { $queryRaw: mocks.queryRaw } }));
import { findMatchingBlock, parseSearchTerms, searchChats, searchNotes } from "./search";

const text = (value: string, styles = {}) => ({ type: "text", text: value, styles });
const link = (...content: unknown[]) => ({ type: "link", href: "https://example.com", content });
const block = (id: string | undefined, type: string, content: unknown[] | undefined, children: unknown[] = []) => ({ id, type, props: {}, content, children });
const updatedAt = new Date("2026-10-01T00:00:00Z");
const lastSql = () => mocks.queryRaw.mock.calls.at(-1)?.[0] as { sql: string; values: unknown[] };

describe("parseSearchTerms", () => {
  it("lowercases, splits on any whitespace, removes duplicates and keeps at most 8 terms", () => {
    expect(parseSearchTerms("  Cell\tDIVISION \n cell mitosis ")).toEqual(["cell", "division", "mitosis"]);
    expect(parseSearchTerms("a b c d e f g h i j")).toEqual(["a", "b", "c", "d", "e", "f", "g", "h"]);
    expect(parseSearchTerms("   ")).toEqual([]);
  });
});

describe("findMatchingBlock", () => {
  it("returns the first block in document order whose own text contains any term", () => {
    const blocks = [
      block("a", "heading", [text("Intro")]),
      block("b", "paragraph", [text("nothing here")], [
        block("c", "bulletListItem", [text("a Mitosis detail")], [block("d", "paragraph", [text("deeper mitosis")])]),
      ]),
      block("e", "paragraph", [text("mitosis again")]),
    ];
    // 親 → 子 → 次の兄弟の順。子の c が、後ろの兄弟 e より先に見つかる。
    expect(findMatchingBlock(blocks, ["mitosis"])).toEqual({ blockId: "c", text: "a Mitosis detail" });
    // 親自身の文字列に無ければ、子の文字列は親の一致にならない。
    expect(findMatchingBlock([block("p", "paragraph", [text("parent")], [block("k", "paragraph", [text("child term")])])], ["term"])?.blockId).toBe("k");
  });

  it("matches when any term is present, case-insensitively", () => {
    const blocks = [block("a", "paragraph", [text("Photosynthesis")]), block("b", "paragraph", [text("Krebs cycle")])];
    expect(findMatchingBlock(blocks, ["krebs", "photo"])?.blockId).toBe("a");
    expect(findMatchingBlock(blocks, ["krebs"])?.blockId).toBe("b");
  });

  it("reads link text and joins text split by styles", () => {
    const blocks = [
      block("a", "paragraph", [text("see "), link(text("chapter "), text("three", { bold: true }))]),
      block("b", "paragraph", [text("mito"), text("sis", { italic: true })]),
    ];
    expect(findMatchingBlock(blocks, ["three"])).toEqual({ blockId: "a", text: "see chapter three" });
    expect(findMatchingBlock(blocks, ["mitosis"])).toEqual({ blockId: "b", text: "mitosis" });
  });

  it("does not match the link target or block props, only the text", () => {
    expect(findMatchingBlock([block("a", "paragraph", [link(text("here"))])], ["example"])).toBeNull();
    expect(findMatchingBlock([{ id: "a", type: "image", props: { name: "mitosis.png", caption: "mitosis" } }], ["mitosis"])).toBeNull();
  });

  it("finds text inside code blocks", () => {
    const blocks = [block("a", "paragraph", [text("x")]), { id: "code", type: "codeBlock", props: { language: "python" }, content: [text("def division():\n    return 1")], children: [] }];
    expect(findMatchingBlock(blocks, ["division"])).toEqual({ blockId: "code", text: "def division():\n    return 1" });
  });

  it("returns null when nothing matches or the input is unusable", () => {
    const blocks = [block("a", "paragraph", [text("hello")]), block("b", "divider", undefined), block("c", "paragraph", [])];
    expect(findMatchingBlock(blocks, ["absent"])).toBeNull();
    expect(findMatchingBlock(blocks, [])).toBeNull();
    expect(findMatchingBlock(null, ["hello"])).toBeNull();
    expect(findMatchingBlock("hello", ["hello"])).toBeNull();
    expect(findMatchingBlock([null, 5, "x"], ["x"])).toBeNull();
  });

  it("skips blocks without an ID because they cannot be jumped to", () => {
    const blocks = [block(undefined, "paragraph", [text("mitosis first")]), block("b", "paragraph", [text("mitosis second")])];
    expect(findMatchingBlock(blocks, ["mitosis"])).toEqual({ blockId: "b", text: "mitosis second" });
  });

  it("handles deeply nested blocks without recursion limits", () => {
    let deepest: unknown = block("leaf", "paragraph", [text("needle")]);
    for (let depth = 0; depth < 20_000; depth++) deepest = block(`n${depth}`, "paragraph", [text("x")], [deepest]);
    expect(findMatchingBlock([deepest], ["needle"])?.blockId).toBe("leaf");
  });
});

describe("searchNotes", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("queries only the user's live notes, schema-qualified, with escaped patterns and a limit", async () => {
    mocks.queryRaw.mockResolvedValue([]);
    await searchNotes("mine", ["100%", "a_b"]);
    const { sql, values } = lastSql();
    expect(sql).toContain('FROM "studymate"."NotePage" p');
    expect(sql).toContain('p."userId" = ');
    expect(sql).toContain('p."deletedAt" IS NULL');
    expect(sql).toContain("jsonb_array_elements_text");
    expect(sql).toContain("ESCAPE '!'");
    expect(sql).toMatch(/ORDER BY [\s\S]*DESC, p\."updatedAt" DESC/);
    expect(sql).toMatch(/LIMIT /);
    expect(values).toContain("mine");
    expect(values).toEqual(expect.arrayContaining(["%100!%%", "%a!_b%", 15]));
    // ユーザーの入力を SQL 文に埋め込まない。
    expect(sql).not.toContain("100%");
  });

  it("returns the matching block, a snippet from it and an ISO date", async () => {
    mocks.queryRaw.mockResolvedValue([{
      id: "n1", title: "Biology", icon: "🧬", updatedAt,
      blocks: [block("h", "heading", [text("Cells")]), block("p", "paragraph", [text("Mitosis is how a cell divides.")])],
    }]);
    expect(await searchNotes("mine", ["mitosis"])).toEqual([{
      kind: "note", id: "n1", title: "Biology", icon: "🧬", snippet: "Mitosis is how a cell divides.", blockId: "p", updatedAt: updatedAt.toISOString(),
    }]);
  });

  it("takes the snippet from the matching block, not the start of the note", async () => {
    const long = `${"intro ".repeat(40)}`;
    mocks.queryRaw.mockResolvedValue([{
      id: "n1", title: "Long", icon: null, updatedAt,
      blocks: [block("a", "paragraph", [text(long)]), block("b", "paragraph", [text("the answer is photosynthesis here")])],
    }]);
    const [result] = await searchNotes("mine", ["photosynthesis"]);
    expect(result.blockId).toBe("b");
    expect(result.snippet).toBe("the answer is photosynthesis here");
  });

  it("falls back to the start of the note when only the title matches", async () => {
    mocks.queryRaw.mockResolvedValue([{
      id: "n1", title: "Mitosis", icon: null, updatedAt,
      blocks: [block("a", "paragraph", []), block("b", "paragraph", [text("Opening line")], [block("c", "paragraph", [text("nested")])])],
    }]);
    expect(await searchNotes("mine", ["mitosis"])).toEqual([expect.objectContaining({ blockId: null, snippet: "Opening line nested" })]);
  });

  it("returns an empty snippet for a note with no text, and does not query without terms", async () => {
    mocks.queryRaw.mockResolvedValue([{ id: "n1", title: "Mitosis", icon: null, updatedAt, blocks: [] }]);
    expect(await searchNotes("mine", ["mitosis"])).toEqual([expect.objectContaining({ blockId: null, snippet: "" })]);
    mocks.queryRaw.mockClear();
    expect(await searchNotes("mine", [])).toEqual([]);
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });
});

describe("searchChats", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("queries only the user's non-note sessions and their messages, schema-qualified, DB-side", async () => {
    mocks.queryRaw.mockResolvedValue([]);
    await searchChats("mine", ["100%", "a_b"]);
    const { sql, values } = lastSql();
    expect(sql).toContain('FROM "studymate"."Session" s');
    expect(sql).toContain('FROM "studymate"."Message" m');
    expect(sql).toContain('JOIN "studymate"."Session" ms ON ms."id" = m."sessionId"');
    expect(sql).toContain("DISTINCT ON (m.\"sessionId\")");
    expect(sql).toContain("m.\"role\" IN ('USER', 'ASSISTANT')");
    // 利用者の絞り込みと noteId IS NULL は、メッセージ側と会話側の両方にある。
    expect(sql).toContain('ms."userId" = ');
    expect(sql).toContain('ms."noteId" IS NULL');
    expect(sql).toContain('s."userId" = ');
    expect(sql).toContain('s."noteId" IS NULL');
    expect(sql).toContain("ESCAPE '!'");
    expect(sql).toMatch(/ORDER BY r\."titleMatch" DESC, r\."sortAt" DESC/);
    expect(sql).toMatch(/LIMIT /);
    expect(values.filter((value) => value === "mine")).toHaveLength(2);
    expect(values).toEqual(expect.arrayContaining(["%100!%%", "%a!_b%", 15]));
    expect(sql).not.toContain("100%");
    // 抜粋の位置と長さは int のリテラル。パラメーターにしない。
    expect(sql).toContain("- 100)");
    expect(sql).toContain(", 600)");
  });

  it("every term has to be in the same message content or in the title", async () => {
    mocks.queryRaw.mockResolvedValue([]);
    await searchChats("mine", ["alpha", "beta"]);
    const { sql, values } = lastSql();
    // 本文の lower() は 1 行につき 1 回だけ（LATERAL で一度小文字にして、語ごとにはかけ直さない）。
    expect(sql.match(/lower\(m\."content"\)/g)).toHaveLength(1);
    expect(sql).toContain('CROSS JOIN LATERAL (SELECT lower(m."content") AS "lc") l');
    expect(sql.match(/l\."lc" LIKE/g)).toHaveLength(2);
    expect(sql.match(/lower\(s\."title"\) LIKE/g)).toHaveLength(2);
    expect(sql).toMatch(/l\."lc" LIKE [^\n]* AND l\."lc" LIKE/);
    expect(sql).toContain('WHERE r."titleMatch" OR r."messageId" IS NOT NULL');
    expect(values.filter((value) => value === "%alpha%")).toHaveLength(2);
  });

  it("maps a message hit, a title-only hit and unknown roles", async () => {
    mocks.queryRaw.mockResolvedValue([
      { id: "s1", title: "Exam prep", icon: "📚", projectId: "p1", updatedAt, titleMatch: true, messageId: "m9", role: "ASSISTANT", excerpt: "Mitosis has four phases." },
      { id: "s2", title: "Mitosis", icon: null, projectId: null, updatedAt, titleMatch: true, messageId: null, role: null, excerpt: null },
      { id: "s3", title: "Other", icon: null, projectId: null, updatedAt, titleMatch: false, messageId: "m1", role: "SYSTEM", excerpt: "x mitosis y" },
    ]);
    expect(await searchChats("mine", ["mitosis"])).toEqual([
      { kind: "chat", id: "s1", title: "Exam prep", icon: "📚", snippet: "Mitosis has four phases.", messageId: "m9", role: "ASSISTANT", projectId: "p1", titleMatch: true, updatedAt: updatedAt.toISOString() },
      { kind: "chat", id: "s2", title: "Mitosis", icon: null, snippet: "", messageId: null, role: null, projectId: null, titleMatch: true, updatedAt: updatedAt.toISOString() },
      expect.objectContaining({ id: "s3", role: null, titleMatch: false, snippet: "x mitosis y" }),
    ]);
  });

  it("adds ellipses around an excerpt cut out of a long message", async () => {
    const excerpt = `${"a".repeat(100)} mitosis ${"b".repeat(500)}`;
    mocks.queryRaw.mockResolvedValue([{ id: "s1", title: "T", icon: null, projectId: null, updatedAt, titleMatch: false, messageId: "m1", role: "USER", excerpt }]);
    const [result] = await searchChats("mine", ["mitosis"]);
    expect(result.snippet.startsWith("…")).toBe(true);
    expect(result.snippet.endsWith("…")).toBe(true);
    expect(result.snippet).toContain("mitosis");
    expect(result.snippet.length).toBeLessThan(170);
  });

  it("does not query without terms", async () => {
    expect(await searchChats("mine", [])).toEqual([]);
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });
});
