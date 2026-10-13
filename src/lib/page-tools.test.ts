import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ queryRaw: vi.fn(), findFirst: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ databaseSchema: "studymate", prisma: { $queryRaw: mocks.queryRaw, notePage: { findFirst: mocks.findFirst } } }));
import { blocksToMarkdown, buildSnippet, likePattern, MAX_READ_CHARS, runPageTool } from "./page-tools";

const text = (value: string, styles = {}) => ({ type: "text", text: value, styles });
const block = (type: string, content: unknown[] | undefined, props = {}, children: unknown[] = []) => ({ id: Math.random().toString(), type, props, content, children });
const updatedAt = new Date("2026-10-01T00:00:00Z");

describe("page tools", () => {
  beforeEach(() => vi.clearAllMocks());

  it("converts note blocks to Markdown", () => {
    expect(blocksToMarkdown([
      block("heading", [text("Exam")], { level: 2 }),
      block("paragraph", [text("Read "), text("chapter 3", { bold: true }), { type: "link", href: "https://example.com", content: [text("here")] }]),
      block("bulletListItem", [text("parent")], {}, [block("checkListItem", [text("done")], { checked: true })]),
      block("codeBlock", [text("x = 1\ny = 2")], { language: "python" }),
      block("divider", undefined),
      block("paragraph", []),
    ])).toBe([
      "## Exam",
      "Read **chapter 3**[here](https://example.com)",
      "- parent",
      "  - [x] done",
      "```python", "x = 1", "y = 2", "```",
      "---",
    ].join("\n"));
  });

  it("builds snippets around the first matching term and escapes LIKE wildcards", () => {
    const body = `Intro ${"x".repeat(100)} cell division and mitosis ${"y".repeat(300)}`;
    expect(buildSnippet(body, ["mitosis"])).toMatch(/^…x+ cell division and mitosis y+…$/);
    expect(buildSnippet(body, ["absent"])).toMatch(/^Intro x+/);
    expect(buildSnippet(null, ["x"])).toBe("");
    expect(likePattern("100%_a!")).toBe("%100!%!_a!!%");
  });

  it("searches only the requesting user's pages in the database and returns snippets", async () => {
    mocks.queryRaw.mockResolvedValue([{ id: "p1", title: "Biology", updatedAt, body: "cell division and mitosis" }]);
    const result = await runPageTool("search_pages", { query: "Mitosis  cell" }, "mine");
    const sql = mocks.queryRaw.mock.calls[0][0] as { sql: string; values: unknown[] };
    expect(sql.sql).toContain('FROM "studymate"."NotePage"');
    expect(sql.sql).toContain("jsonb_array_elements_text");
    expect(sql.values).toContain("mine");
    expect(sql.values).toEqual(expect.arrayContaining(["%mitosis%", "%cell%"]));
    expect(JSON.parse(result.content).results).toEqual([{ id: "p1", title: "Biology", snippet: "cell division and mitosis", updatedAt: updatedAt.toISOString() }]);
    expect(result.label).toBe("Searched pages for “Mitosis  cell”");
  });

  it("only reads pages owned by the requesting user", async () => {
    mocks.findFirst.mockResolvedValue(null);
    const result = await runPageTool("read_page", { pageId: "p1", userId: "someone-else" }, "mine");
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "p1", userId: "mine" } }));
    expect(result).toMatchObject({ isError: true, content: "Page not found." });

    mocks.queryRaw.mockResolvedValue([]);
    expect(JSON.parse((await runPageTool("search_pages", { query: "" }, "mine")).content).note).toBe("No matching pages.");
    // 空の検索では ORDER BY に数値リテラル（列番号扱い）を入れない。
    expect((mocks.queryRaw.mock.calls.at(-1)?.[0] as { sql: string }).sql).toMatch(/ORDER BY p\."updatedAt" DESC/);
  });

  it("reads a page as Markdown and truncates long pages", async () => {
    mocks.findFirst.mockResolvedValue({ id: "p1", title: "Notes", blocks: [block("paragraph", [text("a".repeat(MAX_READ_CHARS + 10))])], updatedAt });
    const result = await runPageTool("read_page", { pageId: "p1" }, "mine");
    expect(result.label).toBe("Read “Notes”");
    expect(result.content).toContain("# Notes");
    expect(result.content).toContain("[Truncated");
  });

  it("numbers blocks and shows the version in read_page", async () => {
    mocks.findFirst.mockResolvedValue({ id: "p1", title: "Notes", version: 4, blocks: [block("heading", [text("A")], { level: 1 }), block("paragraph", [text("b")])], updatedAt });
    const result = await runPageTool("read_page", { pageId: "p1" }, "mine");
    expect(result.content).toContain("version: 4");
    expect(result.content).toContain("[1] # A\n[2] b");
  });

  describe("propose_page_edit", () => {
    const stored = () => ({ id: "p1", title: "Notes", version: 4, blocks: [block("heading", [text("A")], { level: 1 }), block("paragraph", [text("b")])] });
    const args = (extra = {}) => ({ pageId: "p1", version: 4, title: null, edits: [{ op: "replace", block: 2, markdown: "**new**" }], ...extra });

    it("returns a proposal event for the owner's page and does not write", async () => {
      mocks.findFirst.mockResolvedValue(stored());
      const result = await runPageTool("propose_page_edit", args({ title: "Renamed" }), "mine");
      expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "p1", userId: "mine" } }));
      expect(JSON.parse(result.content)).toMatchObject({ status: "proposed", applied: false });
      const [event] = result.events as { type: string; baseVersion: number; title: object; changes: object[]; proposed: { title: string; blocks: unknown[] } }[];
      expect(event).toMatchObject({ type: "studymate.proposal", pageId: "p1", baseVersion: 4, title: { before: "Notes", after: "Renamed" } });
      expect(event.changes).toEqual([{ op: "replace", block: 2, before: "b", after: "**new**" }]);
      expect(event.proposed.title).toBe("Renamed");
      expect(event.proposed.blocks).toHaveLength(2);
    });

    it("rejects a stale version, a missing page and bad edits as tool errors", async () => {
      mocks.findFirst.mockResolvedValue(stored());
      expect(await runPageTool("propose_page_edit", args({ version: 3 }), "mine")).toMatchObject({ isError: true, content: expect.stringContaining("now version 4") });
      expect(await runPageTool("propose_page_edit", args({ edits: [{ op: "delete", block: 9, markdown: null }] }), "mine")).toMatchObject({ isError: true, content: expect.stringContaining("1-2") });
      expect(await runPageTool("propose_page_edit", args({ edits: [] }), "mine")).toMatchObject({ isError: true, content: "The edits change nothing." });
      expect(await runPageTool("propose_page_edit", { ...args(), version: "4" }, "mine")).toMatchObject({ isError: true });
      expect(await runPageTool("propose_page_edit", args({ title: 5 }), "mine")).toMatchObject({ isError: true });
      mocks.findFirst.mockResolvedValue(null);
      expect(await runPageTool("propose_page_edit", args(), "mine")).toMatchObject({ isError: true, content: "Page not found." });
    });

    it("rejects edits whose result fails the page validation", async () => {
      mocks.findFirst.mockResolvedValue(stored());
      const result = await runPageTool("propose_page_edit", args({ title: "x".repeat(201) }), "mine");
      expect(result).toMatchObject({ isError: true, content: expect.stringContaining("title") });
      expect(result.events).toBeUndefined();
    });
  });

  describe("propose_page_create", () => {
    it("returns a create proposal event without touching the database", async () => {
      const result = await runPageTool("propose_page_create", { title: "  Study plan ", markdown: "# Week 1\n- read ch.1", icon: "📚" }, "mine");
      expect(JSON.parse(result.content)).toMatchObject({ status: "proposed", created: false });
      const [event] = result.events as { type: string; title: string; icon: string; content: string; proposed: { blocks: unknown[] } }[];
      expect(event).toMatchObject({ type: "studymate.create_proposal", title: "Study plan", icon: "📚", content: "# Week 1\n- read ch.1" });
      expect(event.proposed.blocks).toHaveLength(2);
      expect(mocks.findFirst).not.toHaveBeenCalled();
      expect(mocks.queryRaw).not.toHaveBeenCalled();
    });

    it("allows an empty body and null icon, and rejects bad input as tool errors", async () => {
      const empty = await runPageTool("propose_page_create", { title: "Blank", markdown: null, icon: null }, "mine");
      expect((empty.events as { content: string; icon: null }[])[0]).toMatchObject({ content: "", icon: null });
      expect(await runPageTool("propose_page_create", { title: " ", markdown: null, icon: null }, "mine")).toMatchObject({ isError: true });
      expect(await runPageTool("propose_page_create", { title: "t", markdown: 5, icon: null }, "mine")).toMatchObject({ isError: true });
      expect(await runPageTool("propose_page_create", { title: "t", markdown: null, icon: "not an emoji" }, "mine")).toMatchObject({ isError: true, content: expect.stringContaining("emoji") });
      expect(await runPageTool("propose_page_create", { title: "x".repeat(201), markdown: null, icon: null }, "mine")).toMatchObject({ isError: true });
      expect(await runPageTool("propose_page_create", { title: "t", markdown: "x".repeat(60_001), icon: null }, "mine")).toMatchObject({ isError: true, content: expect.stringContaining("longer than") });
    });
  });

  it("returns errors for bad input and unknown tools", async () => {
    expect(await runPageTool("read_page", {}, "mine")).toMatchObject({ isError: true });
    expect(await runPageTool("search_pages", { query: 3 }, "mine")).toMatchObject({ isError: true });
    expect(await runPageTool("delete_page", {}, "mine")).toMatchObject({ isError: true });
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });
});
