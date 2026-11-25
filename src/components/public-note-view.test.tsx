import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Locale } from "@/lib/i18n/locale";
import { renderKatex, type KatexApi } from "@/lib/katex-render";
import type { ResolvedPublicShare } from "@/lib/note-share-server";
// 変換を収集時に済ませておく（各テストは resetModules 後に読み直すので、最初のテストが重くならないように）。
import "./public-note-view";

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
      id: "page", kind: "note", data: null, userId: "user", title: "Math", icon: null, cover: null, coverPosition: null, blocks,
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

describe("public note math", { timeout: 30_000 }, () => {
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
      `<div dir="ltr" class="notes-math-block public-note-math-block" style="color:var(--public-note-red-text);background-color:var(--public-note-blue-bg)"><div class="notes-math-rendered">${renderKatex(katex, "\\int_0^1 x^2\\,dx = \\tfrac{1}{3}", true).html}</div></div>`,
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

// ライトの色（文字・背景）は以前の Notion の色のまま。
const LIGHT_COLORS: Record<string, [text: string, background: string]> = {
  gray: ["#787774", "#f1f1ef"], brown: ["#9f6b53", "#f4eeee"], red: ["#d44c47", "#fdebec"],
  orange: ["#d9730d", "#fbecdd"], yellow: ["#cb912f", "#fbf3db"], green: ["#448361", "#edf3ec"],
  blue: ["#337ea9", "#e7f3f8"], purple: ["#9065b0", "#f6f3f9"], pink: ["#c14c8a", "#faf1f5"],
};

// CSS の中で、セレクターがちょうど selector の宣言ブロック（同じセレクターが複数あれば全部）の宣言を集める。
function declarations(css: string, selector: RegExp) {
  const found: Record<string, string> = {};
  for (const [, body] of css.matchAll(new RegExp(`(?:^|[\\n}])${selector.source}\\s*\\{([^}]*)\\}`, "g"))) {
    for (const [, name, value] of body.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([\w-]+)\s*:\s*([^;]+?)\s*(?:;|$)/g)) found[name] = value;
  }
  return found;
}

describe("public note colors", { timeout: 30_000 }, () => {
  it("colors blocks, highlights and table cells with theme variables instead of fixed colors", async () => {
    const html = await render([
      { id: "h", type: "heading", props: { level: 2, textColor: "red", backgroundColor: "blue", textAlignment: "center" }, content: [text("Title")], children: [] },
      paragraph([
        { type: "text", text: "marked", styles: { textColor: "green", backgroundColor: "yellow" } },
        { type: "text", text: "tinted", styles: { textColor: "pink" } },
      ]),
      {
        id: "t", type: "table", props: {}, children: [],
        content: { type: "tableContent", headerRows: 1, rows: [
          { cells: [{ type: "tableCell", props: { backgroundColor: "gray" }, content: [text("head")] }] },
          { cells: [{ type: "tableCell", props: { textColor: "orange", backgroundColor: "purple", textAlignment: "right" }, content: [text("cell")] }] },
        ] },
      },
    ]);
    expect(html).toContain('<div class="public-note-block" style="color:var(--public-note-red-text);background-color:var(--public-note-blue-bg);text-align:center"><h2 id="heading-h" class="public-note-h2">');
    expect(html).toContain('<span style="color:var(--public-note-green-text);background-color:var(--public-note-yellow-bg)" class="public-note-highlight">marked</span>');
    expect(html).toContain('<span style="color:var(--public-note-pink-text)">tinted</span>');
    expect(html).toContain('<th style="background-color:var(--public-note-gray-bg)">');
    expect(html).toContain('<td style="color:var(--public-note-orange-text);background-color:var(--public-note-purple-bg);text-align:right">');
    expect(html).not.toMatch(/style="[^"]*#[0-9a-f]{3,8}/i);
  });

  it("gives the default callout the editor's callout background and outlines a 'default' one", async () => {
    const html = await render([
      { id: "c1", type: "callout", props: { emoji: "💡" }, content: [text("no stored color")], children: [] },
      { id: "c2", type: "callout", props: { backgroundColor: "gray", textColor: "red" }, content: [text("gray")], children: [] },
      { id: "c3", type: "callout", props: { backgroundColor: "blue" }, content: [text("blue")], children: [] },
      { id: "c4", type: "callout", props: { backgroundColor: "default" }, content: [text("outlined")], children: [] },
    ]);
    expect(html).toContain('<div class="public-note-callout " style="background-color:var(--public-note-callout-bg)">');
    expect(html).toContain('<div class="public-note-callout " style="color:var(--public-note-red-text);background-color:var(--public-note-callout-bg)">');
    expect(html).toContain('<div class="public-note-callout " style="background-color:var(--public-note-blue-bg)">');
    expect(html).toContain('<div class="public-note-callout is-outlined">');
    expect(html).not.toContain("--public-note-gray-bg");
  });

  it("ignores unknown color names, including inherited object keys", async () => {
    const html = await render([
      paragraph([{ type: "text", text: "plain", styles: { textColor: "constructor", backgroundColor: "default" } }]),
      { id: "p", type: "paragraph", props: { textColor: "toString", backgroundColor: "teal" }, content: [text("block")], children: [] },
    ]);
    expect(html).toContain('<div class="public-note-block public-note-paragraph"><p><span>plain</span></p></div>');
    expect(html).toContain('<div class="public-note-block public-note-paragraph"><p><span>block</span></p></div>');
  });

  it("renders tableOfContents anchor links targeting headings in the shared note", async () => {
    const html = await render([
      { id: "toc", type: "tableOfContents", props: {}, children: [] },
      { id: "h-intro", type: "heading", props: { level: 1 }, content: [text("Intro")], children: [] },
      { id: "h-detail", type: "heading", props: { level: 2 }, content: [text("Detail")], children: [] },
    ]);
    expect(html).toContain('<h1 id="heading-h-intro" class="public-note-h1"><span>Intro</span></h1>');
    expect(html).toContain('<h2 id="heading-h-detail" class="public-note-h2"><span>Detail</span></h2>');
    expect(html).toContain('<a href="#heading-h-intro" class="public-note-toc-link">Intro</a>');
    expect(html).toContain('<a href="#heading-h-detail" class="public-note-toc-link">Detail</a>');
  });

  it("caps rendered tableOfContents links across repeated TOC blocks on one shared page", async () => {
    const headings = Array.from({ length: 120 }, (_, i) => ({
      id: `h-${i}`,
      type: "heading",
      props: { level: 1 },
      content: [text(`Heading ${i}`)],
      children: [],
    }));
    const tocs = Array.from({ length: 12 }, (_, i) => ({
      id: `toc-${i}`,
      type: "tableOfContents",
      props: {},
      children: [],
    }));
    const html = await render([...tocs, ...headings]);
    expect(html.match(/class="public-note-toc-link"/g)?.length).toBe(1000);
  });

  it("keeps the light colors and uses the editor's colors in dark mode", () => {
    const css = readFileSync(fileURLToPath(new URL("../app/globals.css", import.meta.url)), "utf8");
    const light = declarations(css, /\.public-note-shell/);
    const dark = declarations(css, /:root\[data-theme="dark"\] \.public-note-shell/);
    // エディターの色は、note-editor.tsx が読み込む BlockNote のテーマのダークの色。
    const editorTheme = readFileSync(createRequire(import.meta.url).resolve("@blocknote/ariakit/style.css"), "utf8");
    const editorDark = declarations(editorTheme, /\.bn-root\[data-color-scheme=dark\]/);
    for (const [color, [lightText, lightBackground]] of Object.entries(LIGHT_COLORS)) {
      expect(light[`--public-note-${color}-text`]).toBe(lightText);
      expect(light[`--public-note-${color}-bg`]).toBe(lightBackground);
      expect(dark[`--public-note-${color}-text`]).toMatch(/^#[0-9a-f]{6}$/);
      expect(dark[`--public-note-${color}-text`]).toBe(editorDark[`--bn-colors-highlights-${color}-text`]);
      expect(dark[`--public-note-${color}-bg`]).toMatch(/^#[0-9a-f]{6}$/);
      expect(dark[`--public-note-${color}-bg`]).toBe(editorDark[`--bn-colors-highlights-${color}-background`]);
    }
    // 既定のコールアウトの地は、エディターの色を付けていないコールアウトと同じ。
    const editorCallout = /\.notes-block-editor \.bn-block-content\[data-content-type="callout"\]:not\(\[data-background-color\]\)/;
    expect(light["--public-note-callout-bg"]).toBe(declarations(css, editorCallout).background);
    expect(dark["--public-note-callout-bg"]).toBe(declarations(css, new RegExp(`:root\\[data-theme="dark"\\] ${editorCallout.source}`)).background);
    expect(dark["--public-note-callout-bg"]).toBe("rgba(255, 255, 255, 0.05)");
  });
});
