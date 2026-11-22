import { describe, expect, it } from "vitest";
import { validateNoteContent } from "./note-document";
import { blocksToMarkdown, flattenBlocks, markdownToBlocks, splitTableRow } from "./note-markdown";

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

describe("toggles, callouts and tables", () => {
  const source = [
    "▸ Toggle",
    "  hidden **text**",
    "## ▸ Toggle heading",
    "  - inside",
    "> [!🔥] Watch *out*",
    "| Name | Note |",
    "| --- | --- |",
    "| a\\|b | `x|y` |",
    "| **c** |  |",
    "after",
  ].join("\n");

  it("parses them into blocks that pass validation and round-trip", () => {
    const blocks = markdownToBlocks(source);
    expect(() => validateNoteContent({ title: "t", blocks })).not.toThrow();
    expect(shape(blocks as unknown as Shape[])).toEqual([
      ["toggleListItem", [["paragraph", []]]], ["heading", [["bulletListItem", []]]], ["callout", []], ["table", []], ["paragraph", []],
    ]);
    expect(blocks[1].props).toEqual({ level: 2, isToggleable: true });
    expect(blocks[2].props).toEqual({ emoji: "🔥" });
    const table = blocks[3].content as { headerRows: number; rows: { cells: { content: { text: string; styles: object }[] }[] }[] };
    expect(table.headerRows).toBe(1);
    expect(table.rows.map((row) => row.cells.map((cell) => cell.content.map((entry) => entry.text).join("")))).toEqual([["Name", "Note"], ["a|b", "x|y"], ["c", ""]]);
    expect(table.rows[1].cells[1].content[0].styles).toEqual({ code: true });
    expect(blocksToMarkdown(blocks)).toBe(source.replace("`x|y`", "`x\\|y`"));
  });

  it("numbers a table as one block", () => {
    expect(blocksToMarkdown(markdownToBlocks("| a |\n| --- |\n| b |\nnext"), 0, { n: 0 })).toBe("[1] | a |\n| --- |\n| b |\n[2] next");
  });

  it("keeps look-alike text as plain blocks", () => {
    const paragraph = (value: string) => ({ id: value, type: "paragraph", props: {}, content: [{ type: "text", text: value, styles: {} }], children: [] });
    const heading = { id: "h", type: "heading", props: { level: 1 }, content: [{ type: "text", text: "▸ not a toggle", styles: {} }], children: [] };
    const quote = { id: "q", type: "quote", props: {}, content: [{ type: "text", text: "[!💡] not a callout", styles: {} }], children: [] };
    const blocks = [paragraph("▸ arrow"), paragraph("| a | b |"), paragraph("| --- | --- |"), heading, quote];
    const back = markdownToBlocks(blocksToMarkdown(blocks));
    expect(back.map((block) => block.type)).toEqual(["paragraph", "paragraph", "paragraph", "heading", "quote"]);
    expect(back.map((block) => (block.content as { text: string }[]).map((entry) => entry.text).join(""))).toEqual(["▸ arrow", "| a | b |", "| --- | --- |", "▸ not a toggle", "[!💡] not a callout"]);
    expect(back[3].props).toEqual({ level: 1 });
    // 区切り行の続かない | の行、絵文字でない [!x] は表やコールアウトにしない。
    expect(markdownToBlocks("| a | b |\nplain\n> [!NOTE] text").map((block) => block.type)).toEqual(["paragraph", "paragraph", "quote"]);
  });

  it("keeps long and wide tables as one table", () => {
    const wide = Array.from({ length: 60 }, () => "c").join(" | ");
    const long = ["| h | i |", "| --- | --- |", ...Array.from({ length: 600 }, (_, index) => `| r${index} |`)].join("\n");
    const blocks = markdownToBlocks(`${long}\n\n| ${wide} |\n| ${wide.replace(/c/g, "---")} |`);
    expect(blocks.map((block) => block.type)).toEqual(["table", "table"]);
    const rows = blocks.map((block) => (block.content as { rows: { cells: unknown[] }[] }).rows);
    // 短い行は列数に合わせて空のセルで埋める。
    expect([rows[0].length, rows[0][600].cells.length, rows[1].length, rows[1][0].cells.length]).toEqual([601, 2, 1, 60]);
    expect(() => validateNoteContent({ title: "t", blocks })).not.toThrow();
  });

  it("does not expand a ragged table into a huge grid", () => {
    // 列の多い 1 行と大量の短い行: 埋めるとセル数が膨らむので、表にしない。
    const ragged = [`|${" x |".repeat(400)}`, "| --- |", ...Array.from({ length: 400 }, () => "| y |")].join("\n");
    expect(ragged.length).toBeLessThan(5000);
    const blocks = markdownToBlocks(ragged);
    expect(blocks.some((block) => block.type === "table")).toBe(false);
    expect(JSON.stringify(blocks).length).toBeLessThan(200_000);
  });

  it("keeps adjacent tables apart when written without numbers", () => {
    const source = "| a |\n| --- |\n| b |\n\n| c |\n| --- |\n| d |";
    const blocks = markdownToBlocks(source);
    expect(blocks.map((block) => block.type)).toEqual(["table", "table"]);
    expect(blocksToMarkdown(blocks)).toBe(source);
    expect(markdownToBlocks(blocksToMarkdown(blocks)).map((block) => (block.content as { rows: unknown[] }).rows.length)).toEqual([2, 2]);
  });

  it("splits rows around code spans and escaped characters", () => {
    expect(splitTableRow("| a\\|b | `x|y` | c |")).toEqual(["a|b", "`x|y`", "c"]);
    // コードの外の \` はコードを開かない。閉じる列の無いバッククォートも同じ。
    expect(splitTableRow("| a\\`b | c |")).toEqual(["a\\`b", "c"]);
    expect(splitTableRow("| a`b | c |")).toEqual(["a`b", "c"]);
    // バッククォートを含むコードは、同じ長さの列で閉じるまでが 1 つのコード。
    expect(splitTableRow("| `` a`|b `` | c |")).toEqual(["`` a`|b ``", "c"]);
    expect(splitTableRow("| x\\\\ | y |")).toEqual(["x\\\\", "y"]);
  });

  it("round-trips cells that contain backticks, pipes and backslashes", () => {
    const cellOf = (content: unknown[]) => ({ type: "tableCell", props: {}, content });
    const text = (value: string, styles: Record<string, boolean> = {}) => ({ type: "text", text: value, styles });
    const table = { id: "t", type: "table", props: {}, children: [], content: { type: "tableContent", rows: [
      { cells: [cellOf([text("a`b")]), cellOf([text("p|q\\")])] },
      { cells: [cellOf([text("x`|y", { code: true })]), cellOf([text("\\|")])] },
    ] } };
    const back = markdownToBlocks(blocksToMarkdown([table]))[0].content as { rows: { cells: { content: { text: string; styles: object }[] }[] }[] };
    expect(back.rows.map((row) => row.cells.map((cell) => cell.content.map((entry) => entry.text).join("")))).toEqual([["a`b", "p|q\\"], ["x`|y", "\\|"]]);
    expect(back.rows[1].cells[0].content[0].styles).toEqual({ code: true });
  });

  it("leaves \\| inside ordinary text as written and parses inline math with \\|", () => {
    const [plain] = markdownToBlocks("norm \\|x\\|");
    expect((plain.content as { text: string }[]).map((entry) => entry.text).join("")).toBe("norm \\|x\\|");
    const [math] = markdownToBlocks("norm $\\|x\\|$");
    expect(math.content).toEqual([
      { type: "text", text: "norm ", styles: {} },
      { type: "mathInline", props: { latex: "\\|x\\|" } },
    ]);
  });
});

describe("math blocks and inline math", () => {
  it("parses block math ($$ fences, single-line $$, ```math) and inline math ($...$, $$...$$) and round-trips", () => {
    const source = [
      "Euler's identity $e^{i\\pi} + 1 = 0$ and price \\$5 and \\$10.",
      "$$",
      "\\begin{aligned}",
      "a &= b \\\\",
      "c &= d",
      "\\end{aligned}",
      "$$",
      "- Nested formula:",
      "  $$",
      "  E = mc^2",
      "  $$",
      "| Norm | Value |",
      "| --- | --- |",
      "| $|x|$ | $x^2$ |",
    ].join("\n");
    const blocks = markdownToBlocks(source);
    expect(() => validateNoteContent({ title: "Math", blocks })).not.toThrow();
    expect(shape(blocks as unknown as Shape[])).toEqual([
      ["paragraph", []],
      ["mathBlock", []],
      ["bulletListItem", [["mathBlock", []]]],
      ["table", []],
    ]);
    expect(blocks[0].content).toEqual([
      { type: "text", text: "Euler's identity ", styles: {} },
      { type: "mathInline", props: { latex: "e^{i\\pi} + 1 = 0" } },
      { type: "text", text: " and price $5 and $10.", styles: {} },
    ]);
    expect(blocks[1].props).toEqual({ latex: "\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}" });
    expect(blocks[2].children[0].props).toEqual({ latex: "E = mc^2" });
    expect(blocksToMarkdown(blocks)).toBe(source);
    expect(markdownToBlocks(blocksToMarkdown(blocks)).map((b) => b.type)).toEqual(["paragraph", "mathBlock", "bulletListItem", "table"]);
  });

  it("handles ```math fences, standalone inline $$ (preserving round-trip), two inline $$ on one line, and unclosed $$ safely", () => {
    const blocks = markdownToBlocks([
      "$$\\text{$x$}$$",
      "```math",
      "\\frac{1}{2}",
      "```",
      "$$a$$ and $$b$$",
      "$$ unclosed",
      "next line",
    ].join("\n"));
    expect(() => validateNoteContent({ title: "Math", blocks })).not.toThrow();
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "mathBlock", "paragraph", "paragraph", "paragraph"]);
    expect(blocks[0].content).toEqual([{ type: "mathInline", props: { latex: "\\text{$x$}" } }]);
    expect(blocksToMarkdown([blocks[0]])).toBe("$$\\text{$x$}$$");
    expect(blocks[1].props).toEqual({ latex: "\\frac{1}{2}" });
    expect(blocks[2].content).toEqual([
      { type: "mathInline", props: { latex: "a" } },
      { type: "text", text: " and ", styles: {} },
      { type: "mathInline", props: { latex: "b" } },
    ]);
  });

  it("preserves literal brackets, dollar prices, inline math followed by digits, standalone escaped-$ math, and code fences after unclosed $$", () => {
    const blocks = [
      { id: "p1", type: "paragraph", props: {}, content: [{ type: "text", text: "[hello] costs $5 and $10 and $x$", styles: {} }], children: [] },
      { id: "p2", type: "paragraph", props: {}, content: [{ type: "mathInline", props: { latex: "\\$100 \\times 2" } }], children: [] },
      { id: "p3", type: "paragraph", props: {}, content: [{ type: "mathInline", props: { latex: "x" } }, { type: "text", text: "2", styles: {} }], children: [] },
    ];
    const md = blocksToMarkdown(blocks);
    expect(md).toContain("\\[hello\\]");
    expect(md).toContain("\\$5");
    expect(md).toContain("$$x$$2");
    const back = markdownToBlocks(md);
    expect(back.map((b) => b.type)).toEqual(["paragraph", "paragraph", "paragraph"]);
    expect(back[0].content).toEqual([{ type: "text", text: "[hello] costs $5 and $10 and $x$", styles: {} }]);
    expect(back[1].content).toEqual([{ type: "mathInline", props: { latex: "\\$100 \\times 2" } }]);
    expect(back[2].content).toEqual([{ type: "mathInline", props: { latex: "x" } }, { type: "text", text: "2", styles: {} }]);

    // 未閉じの $$ の後にコードブロックがあっても、コード内の $$ を閉じとして吸い込まない。
    const fenced = markdownToBlocks(["$$ unclosed", "```tex", "$$", "```", "after"].join("\n"));
    expect(fenced.map((b) => b.type)).toEqual(["paragraph", "codeBlock", "paragraph"]);
    expect(fenced[2].content).toEqual([{ type: "text", text: "after", styles: {} }]);

    // 強調（*...*）の中の数式に含まれる * で強調が途中で閉じない。
    const emph = markdownToBlocks("*Value $x*y$*");
    expect(emph[0].content).toEqual([
      { type: "text", text: "Value ", styles: { italic: true } },
      { type: "mathInline", props: { latex: "x*y" } },
    ]);

    // 引用の中の $$ ブロックも mathBlock にする。上限超えはコードブロックに退避して本文を失わない。
    const quoted = markdownToBlocks(["> $$", "> x^2", "> $$"].join("\n"));
    expect(quoted.map((b) => b.type)).toEqual(["mathBlock"]);
    expect(quoted[0].props).toEqual({ latex: "x^2" });
    const hugeQuoted = markdownToBlocks(["> $$", `> ${"x".repeat(10_005)}`, "> $$"].join("\n"));
    expect(hugeQuoted[0].type).toBe("codeBlock");
    expect((hugeQuoted[0].content as { text: string }[])[0].text.length).toBe(10_005);

    // コードスパン内の $ が強調の閉じ記号（**）の探索を邪魔しない。
    const boldCode = markdownToBlocks("**Run `$HOME`** ($x$)");
    expect(boldCode[0].content).toEqual([
      { type: "text", text: "Run ", styles: { bold: true } },
      { type: "text", text: "$HOME", styles: { bold: true, code: true } },
      { type: "text", text: " (", styles: {} },
      { type: "mathInline", props: { latex: "x" } },
      { type: "text", text: ")", styles: {} },
    ]);
  });

  it("handles pathological dollar signs in roughly linear time", () => {
    const started = performance.now();
    markdownToBlocks("$a ".repeat(20_000));
    expect(performance.now() - started).toBeLessThan(1000);
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
