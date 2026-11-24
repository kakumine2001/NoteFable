import { describe, expect, it } from "vitest";
import { MAX_SLIDES, validateCanvasData } from "@/lib/canvas-document";
import { normalizeDeck, SLIDE_HEIGHT, SLIDE_WIDTH, type ImageElement, type ShapeElement, type Slide, type TableElement, type TextElement } from "./model";
import { noteToDeck } from "./note-to-deck";
import { richDocLatex, richDocText, type RichBlock } from "./rich-text";

const VALID_IMG = "/api/pages/files?key=note-files%2Fuser1%2F0e4b3f7c-1111-4c3a-9b1d-2f6f1f2a3b4c.png&name=diagram.png";

const textBlock = (type: string, text: string, props: Record<string, unknown> = {}, children: unknown[] = []) => ({
  type,
  props,
  content: text ? [{ type: "text", text, styles: {} }] : [],
  children,
});

const slideTexts = (slide: Slide) =>
  slide.elements
    .filter((el): el is TextElement | ShapeElement => el.type === "text" || el.type === "shape")
    .map((el) => (el.doc ? richDocText(el.doc) : ""))
    .filter(Boolean);

const slideBlocks = (slide: Slide): RichBlock[] =>
  slide.elements
    .filter((el): el is TextElement | ShapeElement => el.type === "text" || el.type === "shape")
    .flatMap((el) => el.doc?.content ?? []);

const expectValidDeck = (deck: ReturnType<typeof noteToDeck>) => {
  expect(() => validateCanvasData("slides", deck)).not.toThrow();
  expect(deck.slides.length).toBeGreaterThan(0);
  expect(deck.slides.length).toBeLessThanOrEqual(MAX_SLIDES);
  // どの要素も 1920 × 1080 スライド枠内に収まり、normalizeDeck で壊れない。
  const normalized = normalizeDeck(deck);
  expect(normalized.slides.length).toBe(deck.slides.length);
  for (const slide of deck.slides) {
    for (const el of slide.elements) {
      expect(el.x).toBeGreaterThanOrEqual(0);
      expect(el.y).toBeGreaterThanOrEqual(0);
      expect(el.x + el.w).toBeLessThanOrEqual(SLIDE_WIDTH + 1);
      expect(el.y + el.h).toBeLessThanOrEqual(SLIDE_HEIGHT + 1);
    }
  }
};

describe("noteToDeck", () => {
  it("handles empty and untitled notes cleanly with localized fallback", () => {
    const empty = noteToDeck({ title: "Untitled", blocks: [], untitledLabel: "无标题" });
    expectValidDeck(empty);
    expect(empty.slides).toHaveLength(1);
    expect(empty.slides[0].layout).toBe("title");
    expect(slideTexts(empty.slides[0])).toEqual(["无标题"]);

    const titled = noteToDeck({ title: "Quarterly Review", blocks: [textBlock("paragraph", "")] });
    expectValidDeck(titled);
    expect(titled.slides).toHaveLength(1);
    expect(slideTexts(titled.slides[0])).toEqual(["Quarterly Review"]);
  });

  it("splits primarily on divider blocks and skips empty chunks from leading, trailing, and consecutive dividers", () => {
    const deck = noteToDeck({
      title: "Launch Deck",
      blocks: [
        { type: "divider" },
        textBlock("heading", "Launch Deck", { level: 1 }),
        textBlock("paragraph", "Q4 overview"),
        { type: "divider" },
        { type: "divider" },
        textBlock("heading", "Goals", { level: 2 }),
        textBlock("bulletListItem", "Ship fast"),
        textBlock("bulletListItem", "Keep quality high"),
        { type: "divider" },
        textBlock("heading", "Next Steps", { level: 1 }),
        textBlock("paragraph", "Schedule review"),
        { type: "divider" },
      ],
    });
    expectValidDeck(deck);
    expect(deck.slides).toHaveLength(3);
    expect(deck.slides[0].layout).toBe("title");
    expect(slideTexts(deck.slides[0])).toEqual(["Launch Deck", "Q4 overview"]);
    expect(slideTexts(deck.slides[1]).join("\n")).toContain("Goals");
    expect(slideTexts(deck.slides[1]).join("\n")).toContain("Ship fast");
    expect(slideTexts(deck.slides[2]).join("\n")).toContain("Next Steps");
  });

  it("falls back to splitting on top-level H1 headings without creating an empty slide when the first block is already H1", () => {
    const deckSame = noteToDeck({
      title: "Architecture",
      blocks: [
        textBlock("heading", "Architecture", { level: 1 }),
        textBlock("paragraph", "System summary"),
        textBlock("heading", "Storage", { level: 1 }),
        textBlock("bulletListItem", "Postgres metadata"),
        textBlock("bulletListItem", "Private Blob binaries"),
      ],
    });
    expectValidDeck(deckSame);
    expect(deckSame.slides).toHaveLength(2);
    expect(deckSame.slides[0].layout).toBe("title");
    expect(slideTexts(deckSame.slides[0])).toEqual(["Architecture", "System summary"]);
    expect(slideTexts(deckSame.slides[1]).join("\n")).toContain("Storage");

    // ノート題名と別の H1 が先頭のとき：表紙 + 各 H1 セクション（空スライドは作らない）。
    const deckDifferent = noteToDeck({
      title: "Design Doc",
      blocks: [
        textBlock("heading", "Problem", { level: 1 }, [textBlock("paragraph", "Toggleable H1 child")]),
        textBlock("heading", "Solution", { level: 1 }),
        textBlock("paragraph", "Use pure functions."),
      ],
    });
    expectValidDeck(deckDifferent);
    expect(deckDifferent.slides).toHaveLength(3);
    expect(slideTexts(deckDifferent.slides[0])).toEqual(["Design Doc"]);
    expect(slideTexts(deckDifferent.slides[1]).join("\n")).toContain("Toggleable H1 child");
    expect(slideTexts(deckDifferent.slides[2]).join("\n")).toContain("Use pure functions.");
  });

  it("creates title + content slides when there are neither dividers nor H1 headings", () => {
    const deck = noteToDeck({
      title: "Weekly Sync",
      blocks: [
        textBlock("heading", "Highlights", { level: 2 }),
        textBlock("bulletListItem", "Completed API migration"),
        textBlock("bulletListItem", "Zero regressions"),
      ],
    });
    expectValidDeck(deck);
    expect(deck.slides).toHaveLength(2);
    expect(deck.slides[0].layout).toBe("title");
    expect(slideTexts(deck.slides[0])).toEqual(["Weekly Sync"]);
    expect(slideTexts(deck.slides[1]).join("\n")).toContain("Highlights");
    expect(slideTexts(deck.slides[1]).join("\n")).toContain("Completed API migration");
  });

  it("preserves rich inline marks, links, mentions, math, code with language, callouts, quotes, checklists, toggles, and files", () => {
    const deck = noteToDeck({
      title: "Rich Blocks",
      blocks: [
        textBlock("heading", "Showcase", { level: 1 }),
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Bold", styles: { bold: true } },
            { type: "text", text: " ", styles: {} },
            { type: "text", text: "Italic", styles: { italic: true, underline: true, strike: true, code: true, textColor: "blue" } },
            { type: "text", text: " ", styles: {} },
            { type: "link", href: "https://example.com", content: [{ type: "text", text: "Docs", styles: {} }] },
            { type: "text", text: " ", styles: {} },
            { type: "mathInline", props: { latex: "E = mc^2" } },
            { type: "text", text: " ", styles: {} },
            { type: "mention", props: { kind: "page", title: "Roadmap" } },
          ],
          children: [],
        },
        { type: "mathBlock", props: { latex: "\\int_0^1 x^2 dx = \\frac{1}{3}" }, children: [] },
        textBlock("codeBlock", "const x = 42;\nconsole.log(x);", { language: "ts" }),
        textBlock("callout", "Remember to run tests", { emoji: "💡" }),
        textBlock("checkListItem", "Write unit tests", { checked: true }),
        textBlock("checkListItem", "Ship PR", { checked: false }),
        textBlock("toggleListItem", "Details", {}, [textBlock("paragraph", "Hidden detail inside toggle")]),
        textBlock("quote", "Simplicity is prerequisite for reliability."),
        { type: "file", props: { name: "budget.xlsx", url: VALID_IMG }, children: [] },
      ],
    });
    expectValidDeck(deck);
    const allText = deck.slides.flatMap(slideTexts).join("\n");
    expect(allText).toContain("Bold");
    expect(allText).toContain("Docs");
    expect(allText).toContain("@Roadmap");
    expect(allText).toContain("💡 Remember to run tests");
    expect(allText).toContain("☑ Write unit tests");
    expect(allText).toContain("☐ Ship PR");
    expect(allText).toContain("Hidden detail inside toggle");
    expect(allText).toContain("Simplicity is prerequisite for reliability.");
    expect(allText).toContain("[File: budget.xlsx]");

    // 数式（inline & block）とコード言語が保持される。
    const latexes = deck.slides.flatMap((s) => s.elements).flatMap((el) => ((el.type === "text" || el.type === "shape") && el.doc ? [...richDocLatex(el.doc)] : []));
    expect(latexes).toContain("i:E = mc^2");
    expect(latexes).toContain("d:\\int_0^1 x^2 dx = \\frac{1}{3}");

    const codeBlocks = deck.slides.flatMap(slideBlocks).filter((b) => b.type === "code_block");
    expect(codeBlocks).toHaveLength(1);
    expect(codeBlocks[0].attrs?.language).toBe("ts");

    // 段落のマーク（strong, em, underline, strike, code, link, color）が保持される。
    const paras = deck.slides.flatMap(slideBlocks).filter((b) => b.type === "paragraph");
    const allMarks = paras.flatMap((p) => p.content ?? []).flatMap((n) => (n.type === "text" ? n.marks ?? [] : []));
    expect(allMarks.some((m) => m.type === "strong")).toBe(true);
    expect(allMarks.some((m) => m.type === "em")).toBe(true);
    expect(allMarks.some((m) => m.type === "underline")).toBe(true);
    expect(allMarks.some((m) => m.type === "strike")).toBe(true);
    expect(allMarks.some((m) => m.type === "code")).toBe(true);
    expect(allMarks.some((m) => m.type === "link" && m.attrs.href === "https://example.com")).toBe(true);
    expect(allMarks.some((m) => m.type === "color")).toBe(true);
  });

  it("maps tables with header flag and splits very tall tables repeating the header row", () => {
    const rows = Array.from({ length: 24 }, (_, idx) => ({
      cells: [
        [{ type: "text", text: idx === 0 ? "Metric" : `Row ${idx}`, styles: {} }],
        [{ type: "text", text: idx === 0 ? "Value" : `${idx * 10}%`, styles: {} }],
      ],
    }));
    const deck = noteToDeck({
      title: "Metrics",
      blocks: [
        textBlock("heading", "Quarterly Table", { level: 1 }),
        {
          type: "table",
          content: { type: "tableContent", headerRows: 1, columnWidths: [200, 100], rows },
          children: [],
        },
      ],
    });
    expectValidDeck(deck);
    const tables = deck.slides.flatMap((s) => s.elements).filter((el): el is TableElement => el.type === "table");
    expect(tables.length).toBeGreaterThan(1);
    // 続ページにも表頭行が引き継がれる。
    for (const table of tables) {
      expect(table.header).toBe(true);
      expect(table.rows[0].cells.map((cell) => cell.text)).toEqual(["Metric", "Value"]);
      expect(table.cols[0]).toBeGreaterThan(table.cols[1]);
    }
    const allDataRows = tables.flatMap((t) => t.rows.slice(1).map((r) => r.cells[0].text));
    expect(allDataRows).toContain("Row 1");
    expect(allDataRows).toContain("Row 23");
  });

  it("maps safe internal images with captions and safely skips untrusted external URLs", () => {
    const deck = noteToDeck({
      title: "Visuals",
      blocks: [
        textBlock("heading", "Safe Image", { level: 1 }),
        textBlock("bulletListItem", "Left side copy"),
        { type: "image", props: { url: VALID_IMG, caption: "Architecture diagram" }, children: [] },
        textBlock("heading", "Blocked Image", { level: 1 }),
        { type: "image", props: { url: "https://evil.example/tracker.png", caption: "Should skip" }, children: [] },
        textBlock("paragraph", "Fallback text remains"),
      ],
    });
    expectValidDeck(deck);
    const images = deck.slides.flatMap((s) => s.elements).filter((el): el is ImageElement => el.type === "image");
    expect(images).toHaveLength(1);
    expect(images[0].src).toBe(VALID_IMG);
    expect(images[0].alt).toBe("Architecture diagram");
    expect(deck.slides.flatMap(slideTexts).join("\n")).toContain("Fallback text remains");
  });

  it("maps 2-column columnList side-by-side and flattens wider columnLists without dropping content", () => {
    const deck = noteToDeck({
      title: "Comparison",
      blocks: [
        textBlock("heading", "Two Columns", { level: 1 }),
        {
          type: "columnList",
          children: [
            { type: "column", props: { width: 1 }, children: [textBlock("paragraph", "Pros"), textBlock("bulletListItem", "Fast")] },
            { type: "column", props: { width: 1 }, children: [textBlock("paragraph", "Cons"), textBlock("bulletListItem", "Memory")] },
          ],
        },
        textBlock("heading", "Four Columns", { level: 1 }),
        {
          type: "columnList",
          children: [
            { type: "column", props: { width: 1 }, children: [textBlock("paragraph", "Col 1")] },
            { type: "column", props: { width: 1 }, children: [textBlock("paragraph", "Col 2")] },
            { type: "column", props: { width: 1 }, children: [textBlock("paragraph", "Col 3")] },
            { type: "column", props: { width: 1 }, children: [textBlock("paragraph", "Col 4")] },
          ],
        },
      ],
    });
    expectValidDeck(deck);
    const twoColSlide = deck.slides.find((s) => slideTexts(s).join("\n").includes("Two Columns"))!;
    const colTexts = twoColSlide.elements.filter((el): el is TextElement => el.type === "text" && el.role !== "title");
    expect(colTexts.length).toBeGreaterThanOrEqual(2);
    // 左右に分かれて配置され、body / body2 ロールが付く。
    expect(colTexts[1].x).toBeGreaterThan(colTexts[0].x + 200);
    expect(colTexts.map((el) => el.role)).toContain("body");
    expect(colTexts.map((el) => el.role)).toContain("body2");

    const allText = deck.slides.flatMap(slideTexts).join("\n");
    for (const label of ["Col 1", "Col 2", "Col 3", "Col 4"]) {
      expect(allText).toContain(label);
    }
  });

  it("auto-paginates overflowing sections into numbered continuation slides", () => {
    const manyBullets = Array.from({ length: 22 }, (_, i) =>
      textBlock("bulletListItem", `Point ${i + 1}: detailed explanation covering design constraints and rollout milestones.`),
    );
    const deck = noteToDeck({
      title: "Long Spec",
      blocks: [
        textBlock("heading", "Requirements", { level: 1 }),
        ...manyBullets,
      ],
    });
    expectValidDeck(deck);
    const reqSlides = deck.slides.filter((s) => slideTexts(s).some((txt) => txt.startsWith("Requirements")));
    expect(reqSlides.length).toBeGreaterThan(1);
    expect(slideTexts(reqSlides[0])[0]).toBe("Requirements");
    expect(slideTexts(reqSlides[1])[0]).toBe("Requirements (2)");
    const combined = reqSlides.flatMap(slideTexts).join("\n");
    expect(combined).toContain("Point 1:");
    expect(combined).toContain("Point 22:");
  });

  it("caps slides at MAX_SLIDES for huge notes", () => {
    const huge = Array.from({ length: MAX_SLIDES + 25 }, (_, i) => textBlock("heading", `Section ${i + 1}`, { level: 1 }));
    const deck = noteToDeck({ title: "Huge", blocks: huge });
    expectValidDeck(deck);
    expect(deck.slides.length).toBe(MAX_SLIDES);
  });

  it("handles nested lists, numbered start offset, standalone quote, full image, and intro text before first H1", () => {
    const deck = noteToDeck({
      title: "Deep Dive",
      blocks: [
        textBlock("paragraph", "Intro paragraph before any H1"),
        textBlock("heading", "Ordered List", { level: 1 }),
        textBlock("numberedListItem", "Step five", { start: 5 }, [
          textBlock("bulletListItem", "Sub-bullet A"),
          textBlock("bulletListItem", "Sub-bullet B"),
        ]),
        textBlock("numberedListItem", "Step six"),
        textBlock("heading", "Wisdom", { level: 1 }),
        textBlock("quote", "Make each program do one thing well."),
        textBlock("heading", "Diagram", { level: 1 }),
        { type: "image", props: { url: VALID_IMG, caption: "Full-bleed diagram" }, children: [] },
      ],
    });
    expectValidDeck(deck);
    // 先頭イントロはタイトル付きスライドに収まり、その後 3 つの H1 セクションが続く。
    expect(deck.slides.length).toBe(4);
    expect(slideTexts(deck.slides[0]).join("\n")).toContain("Deep Dive");
    expect(slideTexts(deck.slides[0]).join("\n")).toContain("Intro paragraph before any H1");

    const orderedBlocks = slideBlocks(deck.slides[1]).filter((b) => b.type === "ordered_list");
    expect(orderedBlocks).toHaveLength(1);
    expect(orderedBlocks[0].attrs?.order).toBe(5);
    expect(slideTexts(deck.slides[1]).join("\n")).toContain("Sub-bullet A");
    expect(slideTexts(deck.slides[1]).join("\n")).toContain("Step six");

    expect(slideTexts(deck.slides[2]).join("\n")).toContain("Make each program do one thing well.");

    const images = deck.slides[3].elements.filter((el): el is ImageElement => el.type === "image");
    expect(images).toHaveLength(1);
    expect(images[0].src).toBe(VALID_IMG);
    expect(slideTexts(deck.slides[3]).join("\n")).toContain("Full-bleed diagram");
  });
});
