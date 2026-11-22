import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { describe, expect, it } from "vitest";
import { hasDollarMath, normalizeMath } from "./math-markdown";
import { blocksToMarkdown, markdownToBlocks } from "./note-markdown";
import { previewMarkdown } from "@/components/note-history-dialog";

// 画面と同じ変換（assistant-markdown.tsx）に通して、整えた Markdown が意図どおりの数式になるかを見る。
function render(markdown: string) {
  return renderToStaticMarkup(
    <ReactMarkdown remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: true }]]}
      rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false }]]} skipHtml>
      {normalizeMath(markdown)}
    </ReactMarkdown>,
  );
}
const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("math through the real renderer", () => {
  it("closes a display block written with content on the fence lines, and keeps the text after it", () => {
    const html = render("$$\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}$$\n\nNext paragraph\n\n- item");
    expect(count(html, "katex-display")).toBe(1);
    expect(html).not.toContain("katex-error");
    expect(html).toContain("<p>Next paragraph</p>");
    expect(html).toContain("<li>item</li>");
  });

  it("shows a one-line $$ formula on its own line as a displayed formula", () => {
    const html = render("Formula:\n\n$$E = mc^2$$\n\nwhere");
    expect(count(html, "katex-display")).toBe(1);
  });

  it("renders \\( \\) and \\[ \\] and keeps prices as text", () => {
    const html = render("Euler \\( e^{i\\pi} = -1 \\) costs $5 and $10.\n\n\\[\nx = 1\n\\]");
    expect(count(html, 'class="katex"')).toBe(2);
    expect(count(html, "katex-display")).toBe(1);
    expect(html).toContain("costs $5 and $10.");
    expect(html).not.toContain("katex-error");
  });

  it("renders a formula that contains dollar signs as one formula", () => {
    const html = render("total $\\$100 \\times 1.05 = \\$105$ ok");
    expect(count(html, 'class="katex"')).toBe(1);
    expect(html).not.toContain("katex-error");
    expect(html).toContain(" ok");
  });

  it("keeps links whole", () => {
    const html = render("$a$ [Mercury](https://en.wikipedia.org/wiki/Mercury_\\(planet\\)) and [\\[1\\]](https://example.com/a)");
    expect(html).toContain('href="https://en.wikipedia.org/wiki/Mercury_(planet)"');
    expect(html).toContain(">[1]</a>");
    expect(count(html, 'class="katex"')).toBe(1);
  });
});

describe("escaped dollars in notes", () => {
  it("stores \\$ from an answer as a plain dollar sign", () => {
    const blocks = markdownToBlocks("It costs \\$5 and \\$10") as { content: { text: string }[] }[];
    expect(blocks[0].content.map((node) => node.text).join("")).toBe("It costs $5 and $10");
  });
});

describe("note history dollar-only math mode", () => {
  it("detects unescaped dollar math while ignoring escaped dollars and code", () => {
    expect(hasDollarMath("Price \\$5 and \\$10 and \\[brackets\\]")).toBe(false);
    expect(hasDollarMath("`$x$`\n```\n$y$\n```")).toBe(false);
    expect(hasDollarMath("Formula $x^2$")).toBe(true);
    expect(hasDollarMath("$$\nE = mc^2\n$$")).toBe(true);
  });

  it("renders note math blocks and inline math in previewMarkdown while keeping literal brackets and prices as text", () => {
    const blocks = [
      { id: "p1", type: "paragraph", props: {}, content: [
        { type: "text", text: "See [note] costing $5 and ", styles: {} },
        { type: "mathInline", props: { latex: "e^{i\\pi} = -1" } },
      ], children: [] },
      { id: "m1", type: "mathBlock", props: { latex: "E = mc^2" }, children: [] },
    ];
    const md = previewMarkdown(blocks);
    expect(hasDollarMath(md)).toBe(true);
    const html = renderToStaticMarkup(
      <ReactMarkdown remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: true }]]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false }]]} skipHtml>
        {md}
      </ReactMarkdown>,
    );
    expect(count(html, 'class="katex"')).toBe(2);
    expect(count(html, "katex-display")).toBe(1);
    expect(html).toContain("See [note] costing $5 and ");
    expect(html).not.toContain("katex-error");
    expect(blocksToMarkdown(blocks)).toContain("\\[note\\]");

    // 表のセルに | や \| を含む数式（$|x|$、$\|x\|$）があっても、履歴プレビューで列が増えず、| は単線、\| は二重線のまま描かれる。
    const tableBlocks = markdownToBlocks("| Norm | Escaped |\n| --- | --- |\n| $|x|$ | $\\|x\\|$ |");
    const tableMd = previewMarkdown(tableBlocks);
    expect(tableMd).toContain("\\vert");
    expect(tableMd).toContain("\\Vert");
    const tableHtml = renderToStaticMarkup(
      <ReactMarkdown remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: true }]]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false }]]} skipHtml>
        {tableMd}
      </ReactMarkdown>,
    );
    expect(count(tableHtml, "<td>")).toBe(2);
    expect(count(tableHtml, 'class="katex"')).toBe(2);
    expect(tableHtml).not.toContain("katex-error");

    // 履歴プレビューで \$ を含む行内数式もエラーにならず描かれる。
    const dollarMath = [{ id: "d1", type: "paragraph", props: {}, content: [
      { type: "mathInline", props: { latex: "\\$100" } },
    ], children: [] }];
    const dollarHtml = renderToStaticMarkup(
      <ReactMarkdown remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: true }]]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false }]]} skipHtml>
        {previewMarkdown(dollarMath)}
      </ReactMarkdown>,
    );
    expect(count(dollarHtml, 'class="katex"')).toBe(1);
    expect(dollarHtml).not.toContain("katex-error");

    // 隣接する 2 つの行内数式も、履歴プレビューでそれぞれ個別の数式として描かれる。
    const adjacent = [{ id: "a1", type: "paragraph", props: {}, content: [
      { type: "mathInline", props: { latex: "x" } },
      { type: "mathInline", props: { latex: "y" } },
    ], children: [] }];
    const adjacentHtml = renderToStaticMarkup(
      <ReactMarkdown remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: true }]]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false }]]} skipHtml>
        {previewMarkdown(adjacent)}
      </ReactMarkdown>,
    );
    expect(count(adjacentHtml, 'class="katex"')).toBe(2);
    expect(adjacentHtml).not.toContain("katex-error");
  });
});
