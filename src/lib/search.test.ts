import { beforeEach, describe, expect, it, vi } from "vitest";
import { termMatcher } from "./search-fold";

const mocks = vi.hoisted(() => ({ queryRaw: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ databaseSchema: "studymate", prisma: { $queryRaw: mocks.queryRaw } }));
import { findMatchingBlock, parseSearchTerms, searchChats, searchNotes } from "./search";

const text = (value: string, styles = {}) => ({ type: "text", text: value, styles });
const link = (...content: unknown[]) => ({ type: "link", href: "https://example.com", content });
const block = (id: string | undefined, type: string, content: unknown[] | undefined, children: unknown[] = []) => ({ id, type, props: {}, content, children });
const updatedAt = new Date("2026-10-01T00:00:00Z");
const lastSql = () => mocks.queryRaw.mock.calls.at(-1)?.[0] as { sql: string; values: unknown[] };
const regexOf = (term: string) => termMatcher(term).regex;
const count = (haystack: string, needle: string | RegExp) => haystack.split(needle instanceof RegExp ? new RegExp(needle.source, "g") : needle).length - 1;

describe("parseSearchTerms", () => {
  it("lowercases, splits on any whitespace, removes duplicates and keeps at most 8 terms", () => {
    expect(parseSearchTerms("  Cell\tDIVISION \n cell mitosis ")).toEqual(["cell", "division", "mitosis"]);
    expect(parseSearchTerms("a b c d e f g h i j")).toEqual(["a", "b", "c", "d", "e", "f", "g", "h"]);
    expect(parseSearchTerms("   ")).toEqual([]);
  });

  it("folds width, kana and case before splitting, so spellings collapse into one term", () => {
    expect(parseSearchTerms("ＡＰＩ　設計 api")).toEqual(["api", "設計"]);
    expect(parseSearchTerms("でーた ﾃﾞｰﾀ データ")).toEqual(["データ"]);
    // 全角の ％ は LIKE の % と同じ意味になりうるので、エスケープの前に半角にそろえる。
    expect(parseSearchTerms("１２％")).toEqual(["12%"]);
    expect(parseSearchTerms("２０２６年")).toEqual(["2026年"]);
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

  it("prefers the block holding the most distinct terms, then the earlier one", () => {
    const blocks = [block("a", "paragraph", [text("cell")]), block("b", "paragraph", [text("cell division")]), block("c", "paragraph", [text("division cell")])];
    expect(findMatchingBlock(blocks, ["cell", "division"])?.blockId).toBe("b");
    expect(findMatchingBlock(blocks, ["cell"])?.blockId).toBe("a");
  });

  it("finds text written in another width or kana, with folded or unfolded terms", () => {
    const blocks = [block("a", "paragraph", [text("hello")]), block("b", "paragraph", [text("ＲＥＳＴ ＡＰＩ の でーた")])];
    expect(findMatchingBlock(blocks, ["api"])).toEqual({ blockId: "b", text: "ＲＥＳＴ ＡＰＩ の でーた" });
    expect(findMatchingBlock(blocks, ["データ"])?.blockId).toBe("b");
    expect(findMatchingBlock(blocks, ["ＡＰＩ"])?.blockId).toBe("b");
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

  it("queries only the user's live notes, schema-qualified, with parameterised patterns and a limit", async () => {
    mocks.queryRaw.mockResolvedValue([]);
    await searchNotes("mine", ["100%", "a_b"]);
    const { sql, values } = lastSql();
    expect(sql).toContain('FROM "studymate"."NotePage" p');
    expect(sql).toContain('p."userId" = ');
    expect(sql).toContain('p."deletedAt" IS NULL');
    expect(sql).toContain("jsonb_array_elements_text");
    expect(sql).toMatch(/ORDER BY [\s\S]*DESC, p\."updatedAt" DESC/);
    expect(sql).toMatch(/LIMIT /);
    expect(values).toContain("mine");
    expect(values).toEqual(expect.arrayContaining([regexOf("100%"), regexOf("a_b"), 15]));
    // ユーザーの入力を SQL 文に埋め込まない。
    expect(sql).not.toContain("100%");
    expect(sql).not.toContain("a_b");
    // 本文を畳み込む関数は使わない（語のほうを広げる）。
    expect(sql).not.toMatch(/normalize\(|translate\(|lower\(/i);
  });

  it("matches a regular expression for terms with other spellings and LIKE with ESCAPE for the rest", async () => {
    mocks.queryRaw.mockResolvedValue([]);
    await searchNotes("mine", ["100%", "期待値"]);
    const { sql, values } = lastSql();
    // % は全角の ％ とも当たるので正規表現。パターンは % を含むが、それはパラメーターの中にしかない。
    expect(regexOf("100%")).toContain("％");
    expect(sql).toMatch(/p\."title" ~ \?/);
    expect(sql).toMatch(/t\."body" ~ \?/);
    expect(sql).toContain("LIKE ? ESCAPE '!'");
    expect(values).toContain("%期待値%");
    expect(termMatcher("期待値").literal).toBe(true);
  });

  it("folds the terms it is given, so unfolded terms still find other spellings", async () => {
    mocks.queryRaw.mockResolvedValue([]);
    await searchNotes("mine", ["ＡＰＩ", "でーた"]);
    const { values } = lastSql();
    expect(values).toEqual(expect.arrayContaining([regexOf("api"), regexOf("データ")]));
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

  it("finds the block and snippet through a different spelling, keeping the original characters", async () => {
    mocks.queryRaw.mockResolvedValue([{
      id: "n1", title: "API設計ノート", icon: null, updatedAt,
      blocks: [block("h", "heading", [text("命名規則")]), block("p", "paragraph", [text("ＲＥＳＴ ＡＰＩ のパスは複数形にする。")])],
    }]);
    const [result] = await searchNotes("mine", ["api"]);
    expect(result.blockId).toBe("p");
    expect(result.snippet).toBe("ＲＥＳＴ ＡＰＩ のパスは複数形にする。");
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

  it("queries only the user's non-note sessions, messages and attachments, schema-qualified, DB-side", async () => {
    mocks.queryRaw.mockResolvedValue([]);
    await searchChats("mine", ["100%", "a_b"]);
    const { sql, values } = lastSql();
    expect(sql).toContain('FROM "studymate"."Session" s');
    expect(sql).toContain('FROM "studymate"."Message" m');
    expect(sql).toContain('FROM "studymate"."Attachment" a');
    expect(sql).toContain('JOIN "studymate"."Session" ms ON ms."id" = m."sessionId"');
    expect(sql).toContain("m.\"role\" IN ('USER', 'ASSISTANT')");
    // 利用者の絞り込みと noteId IS NULL は、メッセージ側・添付側・会話側のすべてにある。
    expect(count(sql, 'ms."userId" = ')).toBe(2);
    expect(count(sql, 'ms."noteId" IS NULL')).toBe(2);
    expect(count(sql, /(?<![a-z])s\."userId" = /)).toBe(1);
    expect(count(sql, /(?<![a-z])s\."noteId" IS NULL/)).toBe(1);
    expect(values.filter((value) => value === "mine")).toHaveLength(3);
    expect(sql).toMatch(/ORDER BY r\."tier", r\."titleTerms" DESC, r\."sortAt" DESC, r\."id" DESC/);
    expect(sql).toMatch(/LIMIT /);
    expect(values).toEqual(expect.arrayContaining([regexOf("100%"), regexOf("a_b"), 15]));
    // 利用者の入力は SQL 文に入れない。
    expect(sql).not.toContain("100%");
    expect(sql).not.toContain("a_b");
    // 抜粋の位置と長さは int のリテラル。パラメーターにしない。
    expect(sql).toContain("- 100)");
    expect(sql).toContain(", 600)");
  });

  it("scans each message and attachment once, never folding the stored text", async () => {
    mocks.queryRaw.mockResolvedValue([]);
    await searchChats("mine", ["alpha", "beta"]);
    const { sql, values } = lastSql();
    // 行ごとに lower()・normalize()・translate() をかけない。語のほうを正規表現に広げ、行ごとの結果は語ごとのビットにまとめる。
    expect(sql).not.toMatch(/normalize\(|translate\(|lower\(/i);
    expect(count(sql, 'm."content" ~')).toBe(2);
    expect(count(sql, 'a."extractedText" ~')).toBe(2);
    expect(count(sql, /(?<![a-z])s\."title" ~/)).toBe(2);
    // 抜粋を取る 1 通のメッセージ（添付）だけは、もう一度調べて一致の多いほうを選ぶ。
    expect(count(sql, 't."text" ~')).toBe(2);
    expect(sql).toMatch(/THEN 1 ELSE 0 END\) \| \(CASE WHEN [^\n]* THEN 2 ELSE 0 END\)/);
    expect(sql).toContain("OFFSET 0");
    expect(values.filter((value) => value === regexOf("alpha")).length).toBeGreaterThanOrEqual(4);
  });

  it("aggregates per session: every term in the title or in any message, not necessarily in one", async () => {
    mocks.queryRaw.mockResolvedValue([]);
    await searchChats("mine", ["alpha", "beta"]);
    const { sql } = lastSql();
    // 語ごとのビットを、メッセージごと・会話ごとに OR でまとめる。全部の語が揃うのは、タイトルのビットと会話全体のビットを足したとき。
    expect(sql).toContain('bit_or("mask") AS "allMask"');
    expect(sql).toContain('(tm."mask" | COALESCE(ag."allMask", 0)) = 3');
    // 1 つのメッセージに全語がある会話を、散らばった会話より先にする。
    expect(sql).toContain('bool_or("mask" = 3) AS "oneMessage"');
    expect(sql).toContain('WHEN tm."mask" = 3 THEN 0 WHEN COALESCE(ag."oneMessage", false) THEN 1 ELSE 2');
    // 最も多くの語を含む、同数なら新しいメッセージを選ぶ。bit_count() は使わない（PostgreSQL 14 以降のため）。
    expect(sql).toMatch(/array_agg\("messageId" ORDER BY \(\("mask" >> 0\) & 1\) \+ \(\("mask" >> 1\) & 1\) DESC, "createdAt" DESC, "messageId" DESC\)\)\[1\]/);
    expect(sql).not.toContain("bit_count");
  });

  it("filters by project on the message, attachment and session scans only when asked", async () => {
    mocks.queryRaw.mockResolvedValue([]);
    await searchChats("mine", ["alpha"]);
    expect(lastSql().sql).not.toContain('"projectId" =');

    await searchChats("mine", ["alpha"], { projectId: null });
    expect(lastSql().sql).not.toContain('"projectId" =');

    await searchChats("mine", ["alpha"], { projectId: "proj1" });
    const { sql, values } = lastSql();
    expect(count(sql, 'ms."projectId" = ')).toBe(2);
    expect(count(sql, /(?<![a-z])s\."projectId" = /)).toBe(1);
    expect(values.filter((value) => value === "proj1")).toHaveLength(3);
    // 利用者の絞り込みは外さない。
    expect(values.filter((value) => value === "mine")).toHaveLength(3);
    expect(sql).not.toContain("proj1");
  });

  it("finds the excerpt position with the same patterns, in the best message or its attachment", async () => {
    mocks.queryRaw.mockResolvedValue([]);
    await searchChats("mine", ["alpha", "beta"]);
    const { sql, values } = lastSql();
    expect(sql).toContain('strpos(c."text", substring(c."text" FROM ?))');
    expect(values).toContain(`(?:${regexOf("alpha")})|(?:${regexOf("beta")})`);
    expect(sql).toContain('FROM "studymate"."Attachment" a JOIN "studymate"."Message" m ON m."id" = a."messageId"');
    expect(sql).toContain('a."filename"');
  });

  it("maps a message hit, an attachment hit, a title-only hit and unknown roles", async () => {
    mocks.queryRaw.mockResolvedValue([
      { id: "s1", title: "Exam prep", icon: "📚", projectId: "p1", updatedAt, titleMatch: true, messageId: "m9", role: "ASSISTANT", attachmentName: null, excerpt: "Mitosis has four phases." },
      { id: "s2", title: "Mitosis", icon: null, projectId: null, updatedAt, titleMatch: true, messageId: null, role: null, attachmentName: null, excerpt: null },
      { id: "s3", title: "Other", icon: null, projectId: null, updatedAt, titleMatch: false, messageId: "m1", role: "SYSTEM", attachmentName: null, excerpt: "x mitosis y" },
      { id: "s4", title: "Paper", icon: null, projectId: null, updatedAt, titleMatch: false, messageId: "m2", role: "USER", attachmentName: "report.pdf", excerpt: "Notes on mitosis" },
    ]);
    expect(await searchChats("mine", ["mitosis"])).toEqual([
      { kind: "chat", id: "s1", title: "Exam prep", icon: "📚", snippet: "Mitosis has four phases.", messageId: "m9", role: "ASSISTANT", attachmentName: null, projectId: "p1", titleMatch: true, updatedAt: updatedAt.toISOString() },
      { kind: "chat", id: "s2", title: "Mitosis", icon: null, snippet: "", messageId: null, role: null, attachmentName: null, projectId: null, titleMatch: true, updatedAt: updatedAt.toISOString() },
      expect.objectContaining({ id: "s3", role: null, titleMatch: false, snippet: "x mitosis y", attachmentName: null }),
      expect.objectContaining({ id: "s4", role: "USER", messageId: "m2", attachmentName: "report.pdf", snippet: "Notes on mitosis" }),
    ]);
  });

  it("builds the snippet from the original text when the match was found through another spelling", async () => {
    mocks.queryRaw.mockResolvedValue([{
      id: "s1", title: "T", icon: null, projectId: null, updatedAt, titleMatch: false, messageId: "m1", role: "USER", attachmentName: null,
      excerpt: `${"あ".repeat(100)} でーたべーす ${"い".repeat(300)}`,
    }]);
    const [result] = await searchChats("mine", ["データ"]);
    expect(result.snippet.startsWith("…")).toBe(true);
    expect(result.snippet).toContain("でーたべーす");
  });

  it("adds ellipses around an excerpt cut out of a long message", async () => {
    const excerpt = `${"a".repeat(100)} mitosis ${"b".repeat(500)}`;
    mocks.queryRaw.mockResolvedValue([{ id: "s1", title: "T", icon: null, projectId: null, updatedAt, titleMatch: false, messageId: "m1", role: "USER", attachmentName: null, excerpt }]);
    const [result] = await searchChats("mine", ["mitosis"]);
    expect(result.snippet.startsWith("…")).toBe(true);
    expect(result.snippet.endsWith("…")).toBe(true);
    expect(result.snippet).toContain("mitosis");
    expect(result.snippet.length).toBeLessThan(170);
  });

  it("does not query without terms", async () => {
    expect(await searchChats("mine", [])).toEqual([]);
    expect(await searchChats("mine", [], { projectId: "p" })).toEqual([]);
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });
});
