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

  it("returns errors for bad input and unknown tools", async () => {
    expect(await runPageTool("read_page", {}, "mine")).toMatchObject({ isError: true });
    expect(await runPageTool("search_pages", { query: 3 }, "mine")).toMatchObject({ isError: true });
    expect(await runPageTool("delete_page", {}, "mine")).toMatchObject({ isError: true });
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });
});
