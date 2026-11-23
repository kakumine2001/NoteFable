import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Locale } from "@/lib/i18n/locale";
import { renderKatex, type KatexApi } from "@/lib/katex-render";
import type { ResolvedPublicShare } from "@/lib/note-share-server";

// 数式のスタイルは next/dynamic のチャンク（Next.js の中でだけ読み込める）なので、目印に置き換えて「出したか」だけを見る。
vi.mock("@/components/public-note-math-styles", () => ({ PublicMathStyles: () => <i data-katex-styles="" /> }));

// KaTeX 本体を読み込んだか（数式の無いページでは読み込まない）。テストごとにモジュールを読み直して数え直すので、順番に依存しない。
const katexLoads = { count: 0, fail: false };

beforeEach(() => {
  vi.resetModules();
  katexLoads.count = 0;
  katexLoads.fail = false;
  vi.doMock("katex", async (importOriginal) => {
    katexLoads.count++;
    if (katexLoads.fail) throw new Error("katex unavailable");
    return importOriginal();
  });
});

type Block = { id: string; type: string; props?: Record<string, unknown>; content?: unknown; children?: Block[] };

let nextId = 0;
const text = (value: string) => ({ type: "text", text: value, styles: {} });
const inlineMath = (latex: string) => ({ type: "mathInline", props: { latex } });
const paragraph = (content: unknown[], children: Block[] = []): Block => ({ id: `b${nextId++}`, type: "paragraph", props: {}, content, children });
const mathBlock = (latex: string, props: Record<string, unknown> = {}, children: Block[] = []): Block =>
  ({ id: `b${nextId++}`, type: "mathBlock", props: { latex, ...props }, children });

function share(blocks: Block[]): ResolvedPublicShare {
  return {
    token: "token",
    root: { id: "page", userId: "user", title: "Math", icon: null, shareIncludeSubpages: false, shareExpiresAt: null },
    page: {
      id: "page", userId: "user", title: "Math", icon: null, cover: null, coverPosition: null, blocks,
      fullWidth: false, smallText: false, font: "default", updatedAt: new Date(0),
    },
    breadcrumbs: [{ id: "page", title: "Math", icon: null }],
    children: [],
  };
}

async function render(blocks: Block[], locale: Locale = "en") {
  const { PublicNoteView } = await import("./public-note-view");
  return renderToStaticMarkup(await PublicNoteView({ data: share(blocks), locale }));
}

const count = (html: string, needle: string) => html.split(needle).length - 1;

async function realKatex() {
  const mod = await vi.importActual<{ default?: KatexApi }>("katex");
  return (mod.default ?? mod) as KatexApi;
}

describe("public note math", () => {
  it("loads neither KaTeX nor its styles for a page without math", async () => {
    const html = await render([
      paragraph([text("It costs $5 and $10, not $x$.")]),
      mathBlock("  "),
      paragraph([text("empty "), inlineMath("")]),
    ]);
    expect(katexLoads.count).toBe(0);
    expect(html).not.toContain("data-katex-styles");
    expect(html).not.toContain("katex");
    expect(html).not.toContain("notes-math");
    expect(html).toContain("It costs $5 and $10, not $x$.");
  });

  it("renders block and inline math exactly like the editor and loads the styles", async () => {
    const html = await render([
      paragraph([text("Euler: "), inlineMath("e^{i\\pi} + 1 = 0"), text(" holds.")]),
      mathBlock("\\int_0^1 x^2\\,dx = \\tfrac{1}{3}", { textColor: "red", backgroundColor: "blue" }),
    ]);
    const katex = await realKatex();
    expect(katexLoads.count).toBe(1);
    expect(count(html, "data-katex-styles")).toBe(1);
    expect(html).toContain(`<span dir="ltr" class="notes-math-inline"><span class="notes-math-rendered">${renderKatex(katex, "e^{i\\pi} + 1 = 0", false).html}</span></span>`);
    expect(html).toContain(
      `<div dir="ltr" class="notes-math-block public-note-math-block" style="color:#d44c47;background-color:#e7f3f8"><div class="notes-math-rendered">${renderKatex(katex, "\\int_0^1 x^2\\,dx = \\tfrac{1}{3}", true).html}</div></div>`,
    );
    expect(count(html, 'class="katex-display"')).toBe(1);
    expect(html).toContain("Euler: ");
    expect(html).toContain(" holds.");
    expect(html).not.toContain("notes-math-fallback");
  });

  it("renders math in toggles, tables, columns and nested blocks", async () => {
    const html = await render([
      { id: "toggle", type: "toggleListItem", props: {}, content: [text("Toggle "), inlineMath("t")], children: [] },
      {
        id: "table", type: "table", props: {}, children: [],
        content: { type: "tableContent", rows: [{ cells: [[inlineMath("a")], { type: "tableCell", props: {}, content: [inlineMath("b")] }] }] },
      },
      paragraph([text("parent")], [mathBlock("c")]),
      { id: "cols", type: "columnList", props: {}, children: [
        { id: "col1", type: "column", props: {}, children: [paragraph([inlineMath("d")])] },
        { id: "col2", type: "column", props: {}, children: [mathBlock("e")] },
      ] },
    ]);
    expect(count(html, 'class="notes-math-inline"')).toBe(4);
    expect(count(html, "notes-math-block public-note-math-block")).toBe(2);
    expect(count(html, "data-katex-styles")).toBe(1);
  });

  it("keeps equations left-to-right on an RTL page", async () => {
    const html = await render([paragraph([text("معادلة "), inlineMath("a+b")]), mathBlock("x \\to y")], "ar");
    expect(html).toMatch(/^<div class="public-note-shell [^"]*" lang="ar" dir="rtl">/);
    expect(count(html, '<span dir="ltr" class="notes-math-inline">')).toBe(1);
    expect(count(html, '<div dir="ltr" class="notes-math-block public-note-math-block">')).toBe(1);
  });

  it("shows a broken equation as its TeX source instead of dropping it, and keeps an empty equation's children", async () => {
    const html = await render([
      paragraph([inlineMath("\\frac{1}{")]),
      mathBlock("", {}, [paragraph([text("child of an empty equation")])]),
    ]);
    expect(html).toContain('class="katex-error"');
    expect(html).toContain("\\frac{1}{");
    expect(html).toContain("child of an empty equation");
    expect(html).not.toContain("notes-math-block");
  });

  it("still shows the page with TeX source when KaTeX cannot be loaded", async () => {
    katexLoads.fail = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const html = await render([paragraph([text("Area "), inlineMath("\\pi r^2")]), mathBlock("a^2")]);
    expect(katexLoads.count).toBe(1);
    expect(html).toContain('<span dir="ltr" class="notes-math-inline"><code class="notes-math-fallback">\\pi r^2</code></span>');
    expect(html).toContain('<code class="notes-math-fallback">a^2</code>');
    expect(html).not.toContain("data-katex-styles");
  });
});
