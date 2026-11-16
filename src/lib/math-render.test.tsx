import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { describe, expect, it } from "vitest";
import { normalizeMath } from "./math-markdown";
import { markdownToBlocks } from "./note-markdown";

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
