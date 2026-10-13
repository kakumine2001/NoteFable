import { describe, expect, it } from "vitest";
import { validateNoteContent } from "./note-document";
import { blocksToMarkdown, flattenBlocks, markdownToBlocks } from "./note-markdown";

type Shape = { type: string; children: Shape[] };
const shape = (blocks: Shape[]): unknown[] => blocks.map((block) => [block.type, shape(block.children)]);

describe("markdownToBlocks", () => {
  const source = [
    "# Title",
    "Plain **bold** and *italic* with `code` and ~~gone~~ and [a link](https://example.com).",
    "- parent",
    "  - child",
    "    - [x] grandchild",
    "1. first",
    "> quote",
    "```ts",
    "const a = 1;",
    "const b = 2;",
    "```",
    "---",
  ].join("\n");

  it("builds blocks that pass the server's page validation", () => {
    const blocks = markdownToBlocks(source);
    expect(() => validateNoteContent({ title: "t", blocks })).not.toThrow();
    expect(shape(blocks as unknown as Shape[])).toEqual([
      ["heading", []], ["paragraph", []],
      ["bulletListItem", [["bulletListItem", [["checkListItem", []]]]]],
      ["numberedListItem", []], ["quote", []], ["codeBlock", []], ["divider", []],
    ]);
  });

  it("round-trips through blocksToMarkdown", () => {
    expect(blocksToMarkdown(markdownToBlocks(source))).toBe(source);
  });

  it("keeps styles and links in inline content", () => {
    const [paragraph] = markdownToBlocks("a **b *c* d** [e **f**](https://x.test) `g`");
    expect(paragraph.content).toEqual([
      { type: "text", text: "a ", styles: {} },
      { type: "text", text: "b ", styles: { bold: true } },
      { type: "text", text: "c", styles: { bold: true, italic: true } },
      { type: "text", text: " d", styles: { bold: true } },
      { type: "text", text: " ", styles: {} },
      { type: "link", href: "https://x.test", content: [{ type: "text", text: "e ", styles: {} }, { type: "text", text: "f", styles: { bold: true } }] },
      { type: "text", text: " ", styles: {} },
      { type: "text", text: "g", styles: { code: true } },
    ]);
  });

  it("leaves lone markers, spaced stars and unsafe links as text", () => {
    const [paragraph] = markdownToBlocks("2 * 3 * 4, **open, snake_case, [x](javascript:alert(1)) and \\*literal\\*");
    const nodes = paragraph.content as { type: string; text: string }[];
    expect(nodes.every((node) => node.type === "text")).toBe(true);
    expect(nodes.map((node) => node.text).join("")).toBe("2 * 3 * 4, **open, snake_case, [x](javascript:alert(1)) and *literal*");
  });

  it("handles code fences with indentation, blank lines and no language", () => {
    const [list] = markdownToBlocks("- item\n  ```\n  a\n\n  b\n  ```");
    const code = (list.children as { type: string; props: object; content: { text: string }[] }[])[0];
    expect(code.type).toBe("codeBlock");
    expect(code.props).toEqual({});
    expect(code.content[0].text).toBe("a\n\nb");
  });

  it("gives every block a unique id and skips blank lines", () => {
    const ids = flattenBlocks(markdownToBlocks("a\n\n\nb\n- c")).map((block) => block.id);
    expect(new Set(ids).size).toBe(3);
  });
});

describe("markdown round trips", () => {
  const text = (value: string, styles: Record<string, boolean> = {}) => ({ type: "text", text: value, styles });
  const block = (type: string, content: unknown[] | undefined, props: Record<string, unknown> = {}, children: unknown[] = []) => ({ id: "x", type, props, ...(content ? { content } : {}), children });
  // 生成 ID を除き、種類・props・本文・子を比べる。
  const plain = (blocks: unknown): unknown => (blocks as { type: string; props: unknown; content?: unknown; children: unknown }[]).map((b) => ({ type: b.type, props: b.props, content: b.content, children: plain(b.children) }));
  const roundTrip = (blocks: unknown[]) => plain(markdownToBlocks(blocksToMarkdown(blocks)));

  it("keeps bold+italic, literal markers and block-like text exactly", () => {
    const blocks = [
      block("paragraph", [text("word", { bold: true, italic: true }), text(" and *literal* and `tick` and [not](a link) and ~~x~~")]),
      block("paragraph", [text("# not a heading")]),
      block("paragraph", [text("- not a bullet")]),
      block("paragraph", [text("3. not a list")]),
      block("paragraph", [text("---")]),
      block("paragraph", [text("> not a quote")]),
    ];
    expect(roundTrip(blocks)).toEqual(plain(blocks));
  });

  it("moves whitespace outside emphasis markers", () => {
    const blocks = [block("paragraph", [text("a "), text("bold ", { bold: true }), text("b")])];
    expect(blocksToMarkdown(blocks)).toBe("a **bold** b");
  });

  it("keeps children of headings and paragraphs, empty list items and numbered starts", () => {
    const blocks = [
      block("heading", [text("Section")], { level: 2 }, [block("paragraph", [text("under heading")])]),
      block("checkListItem", [], { checked: true }),
      block("bulletListItem", []),
      block("numberedListItem", [text("seven")], { start: 7 }),
      block("numberedListItem", [text("eight")]),
    ];
    expect(roundTrip(blocks)).toEqual(plain(blocks));
  });

  it("keeps tabs and triple backticks inside code blocks", () => {
    const blocks = [block("codeBlock", [text("all:\n\tgo build\n```\nend")], { language: "make" })];
    expect(blocksToMarkdown(blocks)).toContain("````make");
    expect(roundTrip(blocks)).toEqual(plain(blocks));
  });

  it("keeps inline code that contains backticks", () => {
    const blocks = [
      block("paragraph", [text("use "), text("a`b", { code: true }), text(" and "), text("`edge`", { code: true }), text(" ok")]),
    ];
    expect(roundTrip(blocks)).toEqual(plain(blocks));
  });

  it("parses pathological input in time that grows roughly linearly", () => {
    const pieces = ["[a](", "**a ", "*a ", "~~a ", "`a ", "x ** ", "** ", "* ** "];
    const time = (size: number) => {
      const started = performance.now();
      for (const piece of pieces) markdownToBlocks(("x " + piece.repeat(size)).slice(0, size * 2));
      return performance.now() - started;
    };
    time(2_000); // warm up
    const small = time(10_000);
    const large = time(60_000);
    expect(large).toBeLessThan(2000);
    // 6 倍の入力で 40 倍以上かかるなら二乗に近い（小さい側が速すぎて比が暴れる場合は絶対値だけを見る）。
    if (small > 20) expect(large / small).toBeLessThan(40);
  });
});

describe("numbered blocksToMarkdown", () => {
  it("numbers every block depth-first, including empty ones, in flattenBlocks order", () => {
    const blocks = [
      { id: "a", type: "bulletListItem", props: {}, content: [{ type: "text", text: "one", styles: {} }], children: [{ id: "b", type: "paragraph", props: {}, content: [], children: [] }] },
      { id: "c", type: "divider", props: {}, children: [] },
    ];
    expect(blocksToMarkdown(blocks, 0, { n: 0 })).toBe("[1] - one\n  [2] \n[3] ---");
    expect(flattenBlocks(blocks).map((block) => block.id)).toEqual(["a", "b", "c"]);
  });
});
