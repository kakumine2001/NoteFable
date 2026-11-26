import { describe, expect, it } from "vitest";
import { MAX_SLIDE_NOTES, MAX_SLIDES, validateCanvasData } from "@/lib/canvas-document";
import { createSlide } from "@/lib/slides/layouts";
import { DECK_FORMAT, normalizeDeck, type Deck, type ImageElement, type Slide, type WhiteboardElement } from "@/lib/slides/model";
import { richDocFromText, richDocText } from "@/lib/slides/rich-text";
import {
  applySlidesEdits,
  assertDeckTextPreserved,
  buildAiSlidesDeck,
  extractDeckTextInventory,
  MAX_AI_SLIDES_OPS,
  SLIDE_THEME_IDS,
  SlidesEditError,
} from "@/lib/slides/ai-edit";

const NULL_OP = {
  slideId: null,
  slideIds: null,
  afterSlideId: null,
  atStart: null,
  ref: null,
  title: null,
  body: null,
  notes: null,
  layout: null,
  hidden: null,
  transition: null,
  section: null,
  secondTitle: null,
  secondBody: null,
  secondNotes: null,
  secondLayout: null,
  themeId: null,
  themeMode: null,
  slideLayouts: null,
};

function op(fields: Record<string, unknown>) {
  return { ...NULL_OP, ...fields };
}

function sampleDeck(): Deck {
  const s1: Slide = {
    ...createSlide("title", { title: "Q4 Launch", subtitle: "Product Roadmap" }),
    id: "slide_cover",
    notes: "Welcome everyone.",
  };
  const s2: Slide = {
    ...createSlide("bullets", { title: "Key Goals", body: "Ship v2\nImprove speed" }),
    id: "slide_goals",
    notes: "Highlight latency improvements.",
  };
  const s3: Slide = {
    ...createSlide("bullets", { title: "Timeline", body: "Oct: Beta\nNov: GA" }),
    id: "slide_timeline",
    section: "Execution",
    notes: "Discuss launch milestones.",
  };
  return normalizeDeck({ format: DECK_FORMAT, theme: { id: "simple", mode: "light" }, slides: [s1, s2, s3] });
}

describe("buildAiSlidesDeck (propose_slides_create)", () => {
  it("builds a valid deck supporting Markdown bullets, numbered lists, code blocks, math, tables, notes, theme and layouts", () => {
    const built = buildAiSlidesDeck({
      title: "Systems Design",
      theme: { themeId: "tech", mode: "dark" },
      slides: [
        { title: "Systems Design", body: "Architecture Overview", notes: "Intro notes", layout: "title", section: null },
        {
          title: "Core Concepts",
          body: "- Latency $L = t_1 + t_2$\n- Throughput\n\n1. Measure\n2. Optimize\n\n```ts\nconst x = 1;\n```\n\n$$\nE = mc^2\n$$",
          notes: "Walk through metrics.",
          layout: "bullets",
          section: "Foundations",
        },
        {
          title: "Comparison",
          body: "| Metric | Before | After |\n| --- | --- | --- |\n| P99 | 420ms | 95ms |",
          notes: null,
          layout: null,
          section: null,
        },
        {
          title: "Two Sides",
          body: "- Left point A\n- Left point B\n- Right point C\n- Right point D",
          notes: null,
          layout: "twoColumn",
          section: null,
        },
      ],
    });

    expect(built.deck.theme).toEqual({ id: "tech", mode: "dark" });
    expect(built.deck.slides.length).toBeGreaterThanOrEqual(4);
    expect(built.deck.slides[0].layout).toBe("title");
    expect(built.deck.slides[0].notes).toBe("Intro notes");
    expect(built.deck.slides[1].section).toBe("Foundations");
    expect(built.deck.slides[1].notes).toBe("Walk through metrics.");
    // Two-column layout populates both body and body2.
    const twoCol = built.deck.slides.find((s) => s.layout === "twoColumn");
    expect(twoCol).toBeDefined();
    expect(twoCol!.elements.some((el) => el.role === "body")).toBe(true);
    expect(twoCol!.elements.some((el) => el.role === "body2")).toBe(true);
    // Table is converted into a real table element.
    expect(built.deck.slides.some((s) => s.elements.some((el) => el.type === "table"))).toBe(true);
    expect(built.content).toContain("Theme: tech (dark)");
    expect(built.changes.length).toBeGreaterThan(0);
    expect(built.focusIds.length).toBeGreaterThan(0);
    expect(() => validateCanvasData("slides", built.data)).not.toThrow();
  });

  it("creates a cover slide when slides array is empty and rejects invalid themes or oversized notes", () => {
    const coverOnly = buildAiSlidesDeck({ title: "Quick Deck", theme: null, slides: [] });
    expect(coverOnly.deck.slides).toHaveLength(1);
    expect(coverOnly.deck.slides[0].layout).toBe("title");
    expect(() => validateCanvasData("slides", coverOnly.data)).not.toThrow();

    expect(() => buildAiSlidesDeck({ title: "Bad Theme", theme: { themeId: "neon", mode: "light" }, slides: [] })).toThrow(SlidesEditError);
    expect(() => buildAiSlidesDeck({
      title: "Huge Notes",
      slides: [{ title: "A", body: "B", notes: "x".repeat(MAX_SLIDE_NOTES + 1) }],
    })).toThrow(SlidesEditError);
  });
});

describe("applySlidesEdits (propose_slides_edit)", () => {
  it("targets slides strictly by stable slide.id and rejects unknown IDs or display numbers", () => {
    const deck = sampleDeck();
    expect(() => applySlidesEdits(deck, [op({ op: "update_slide", slideId: "2", title: "Nope" })])).toThrow(SlidesEditError);
    expect(() => applySlidesEdits(deck, [op({ op: "update_slide", slideId: "missing_id", title: "Nope" })])).toThrow(SlidesEditError);
  });

  it("supports update_slide for title, body Markdown, notes, hidden, transition, section, and preserves images & whiteboard frames", () => {
    const deck = sampleDeck();
    const img: ImageElement = {
      id: "img_keep",
      type: "image",
      x: 1100,
      y: 120,
      w: 700,
      h: 700,
      rotation: 0,
      src: "/api/pages/files?key=note-files/u1/123e4567-e89b-12d3-a456-426614174000.png&name=chart.png",
      alt: "Growth chart",
      fit: "contain",
      radius: 8,
    };
    const wb: WhiteboardElement = {
      id: "wb_keep",
      type: "whiteboard",
      x: 1100,
      y: 840,
      w: 400,
      h: 200,
      rotation: 0,
      src: "/api/pages/files?key=note-files/u1/223e4567-e89b-12d3-a456-426614174000.png&name=arch.png",
      pageId: "wb1",
      frameId: "f1",
      frameName: "Architecture",
    };
    deck.slides[1].elements.push(img, wb);

    const res = applySlidesEdits(deck, [
      op({
        op: "update_slide",
        slideId: "slide_goals",
        title: "Q4 Strategic Goals",
        body: "- Cut P99 latency in half\n- Launch native AI editing\n\n| KPI | Target |\n| --- | --- |\n| NPS | 65 |",
        notes: "Updated speaker script.",
        hidden: true,
        transition: "fade",
        section: "Strategy",
      }),
    ]);

    expect(res.unchanged).toBe(false);
    expect(res.focusIds).toContain("slide_goals");
    const updated = res.deck.slides.find((s) => s.id === "slide_goals")!;
    expect(updated.notes).toBe("Updated speaker script.");
    expect(updated.hidden).toBe(true);
    expect(updated.transition).toBe("fade");
    expect(updated.section).toBe("Strategy");
    // Image & whiteboard frame preserved untouched!
    expect(updated.elements.some((el) => el.type === "image" && el.id === "img_keep" && el.src === img.src)).toBe(true);
    expect(updated.elements.some((el) => el.type === "whiteboard" && el.id === "wb_keep" && el.src === wb.src)).toBe(true);
    // Table created cleanly.
    expect(updated.elements.some((el) => el.type === "table")).toBe(true);
    expect(() => validateCanvasData("slides", res.data)).not.toThrow();
  });

  it("supports set_layout without dropping content", () => {
    const deck = sampleDeck();
    const res = applySlidesEdits(deck, [op({ op: "set_layout", slideId: "slide_goals", layout: "imageText" })]);
    expect(res.unchanged).toBe(false);
    const updated = res.deck.slides.find((s) => s.id === "slide_goals")!;
    expect(updated.layout).toBe("imageText");
    const text = updated.elements
      .filter((el) => el.type === "text")
      .map((el) => richDocText(el.doc))
      .join("\n");
    expect(text).toContain("Key Goals");
    expect(text).toContain("Ship v2");
    expect(text).toContain("Improve speed");
  });

  it("supports split_slide, preserving media and anchor ID on first slide and creating second slide", () => {
    const deck = sampleDeck();
    const img: ImageElement = {
      id: "img_split",
      type: "image",
      x: 1100,
      y: 120,
      w: 600,
      h: 600,
      rotation: 0,
      src: "/api/pages/files?key=note-files/u1/123e4567-e89b-12d3-a456-426614174000.png&name=a.png",
      alt: "Diagram",
      fit: "contain",
      radius: 0,
    };
    deck.slides[1].elements.push(img);

    const res = applySlidesEdits(deck, [
      op({
        op: "split_slide",
        slideId: "slide_goals",
        ref: "slide_goals_part2",
        title: "Goals (Part 1)",
        body: "- Ship v2",
        notes: "Part 1 notes",
        layout: "bullets",
        secondTitle: "Goals (Part 2)",
        secondBody: "- Improve speed",
        secondNotes: "Part 2 notes",
        secondLayout: "bullets",
      }),
    ]);

    expect(res.deck.slides).toHaveLength(4);
    expect(res.deck.slides[1].id).toBe("slide_goals");
    expect(res.deck.slides[1].notes).toBe("Part 1 notes");
    expect(res.deck.slides[1].elements.some((el) => el.type === "image" && el.src === img.src)).toBe(true);
    expect(res.deck.slides[2].id).not.toBe("slide_goals");
    expect(res.deck.slides[2].notes).toBe("Part 2 notes");
    expect(res.focusIds).toContain("slide_goals");
    expect(res.focusIds).toContain(res.deck.slides[2].id);
    expect(() => validateCanvasData("slides", res.data)).not.toThrow();
  });

  it("supports merge_slides, combining slides cleanly and preserving media from all merged slides", () => {
    const deck = sampleDeck();
    const imgFromThird: ImageElement = {
      id: "img_from_3",
      type: "image",
      x: 1100,
      y: 100,
      w: 500,
      h: 500,
      rotation: 0,
      src: "/api/pages/files?key=note-files/u1/123e4567-e89b-12d3-a456-426614174000.png&name=b.png",
      alt: "Milestone",
      fit: "contain",
      radius: 0,
    };
    deck.slides[2].elements.push(imgFromThird);

    const res = applySlidesEdits(deck, [
      op({
        op: "merge_slides",
        slideIds: ["slide_goals", "slide_timeline"],
        title: "Goals & Timeline",
        body: "- Ship v2 in Oct (Beta)\n- GA in Nov",
      }),
    ]);

    expect(res.deck.slides).toHaveLength(2);
    expect(res.deck.slides[1].id).toBe("slide_goals");
    expect(res.deck.slides[1].elements.some((el) => el.type === "image" && el.src === imgFromThird.src)).toBe(true);
    // Combined speaker notes preserved when notes arg omitted.
    expect(res.deck.slides[1].notes).toContain("Highlight latency improvements.");
    expect(res.deck.slides[1].notes).toContain("Discuss launch milestones.");
    expect(() => validateCanvasData("slides", res.data)).not.toThrow();
  });

  it("supports add_slide (at start, after a slide ID, and at end), delete_slides, and reorder_slides", () => {
    const deck = sampleDeck();
    const res = applySlidesEdits(deck, [
      op({ op: "add_slide", atStart: true, ref: "new_start", title: "Opening", body: "Agenda", layout: "section" }),
      op({ op: "add_slide", afterSlideId: "slide_goals", ref: "new_mid", title: "Risks", body: "- Scope creep" }),
      op({ op: "delete_slides", slideIds: ["slide_timeline"] }),
      op({ op: "reorder_slides", slideIds: ["new_mid"], afterSlideId: "slide_cover" }),
    ]);

    expect(res.deck.slides).toHaveLength(4);
    expect(res.deck.slides.some((s) => s.id === "slide_timeline")).toBe(false);
    // Order: new_start, slide_cover, new_mid, slide_goals
    expect(res.deck.slides[1].id).toBe("slide_cover");
    expect(res.deck.slides[3].id).toBe("slide_goals");
    expect(() => validateCanvasData("slides", res.data)).not.toThrow();

    // Full permutation reorder works cleanly.
    const perm = applySlidesEdits(sampleDeck(), [
      op({ op: "reorder_slides", slideIds: ["slide_timeline", "slide_cover", "slide_goals"] }),
    ]);
    expect(perm.deck.slides.map((s) => s.id)).toEqual(["slide_timeline", "slide_cover", "slide_goals"]);
  });

  it("supports restyle_deck across built-in themes, light/dark modes, and per-slide layouts while enforcing the strict text-preservation invariant", () => {
    const deck = sampleDeck();
    // Add math, code, and table to verify ALL content types are preserved verbatim during restyle.
    deck.slides[1].elements.push({
      id: "math_el",
      type: "text",
      x: 120,
      y: 700,
      w: 800,
      h: 120,
      rotation: 0,
      doc: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Formula: " }, { type: "math_inline", attrs: { latex: "\\alpha + \\beta" } }] },
          { type: "math_block", attrs: { latex: "\\sum_{i=1}^n i" } },
          { type: "code_block", attrs: { language: "ts" }, content: [{ type: "text", text: "const k = 42;" }] },
        ],
      },
      style: { font: "body", size: 32, color: "text", align: "left", valign: "top", lineHeight: 1.3, bold: false, italic: false },
      fill: null,
      autoHeight: false,
    });
    deck.slides[2].elements.push({
      id: "tbl_1",
      type: "table",
      x: 120,
      y: 500,
      w: 1200,
      h: 300,
      rotation: 0,
      rows: [{ cells: [{ text: "Phase" }, { text: "Date" }] }, { cells: [{ text: "GA" }, { text: "Nov 15" }] }],
      cols: [1, 1],
      header: true,
      style: { size: 28, color: "text", border: "line", headerFill: "surface", font: "body" },
    });

    for (const themeId of SLIDE_THEME_IDS) {
      const res = applySlidesEdits(deck, [
        op({
          op: "restyle_deck",
          themeId,
          themeMode: "dark",
          slideLayouts: [{ slideId: "slide_goals", layout: "imageText" }],
        }),
      ]);
      expect(res.deck.theme).toEqual({ id: themeId, mode: "dark" });
      expect(res.deck.slides[1].layout).toBe("imageText");
      expect(extractDeckTextInventory(res.deck)).toEqual(extractDeckTextInventory(deck));
      expect(() => assertDeckTextPreserved(deck, res.deck)).not.toThrow();
      expect(() => validateCanvasData("slides", res.data)).not.toThrow();
    }
  });

  it("throws from assertDeckTextPreserved if even a single character of text, math, table cell, or speaker notes is altered, dropped, or added", () => {
    const before = sampleDeck();
    before.slides[2].elements.push({
      id: "tbl_inv",
      type: "table",
      x: 120,
      y: 500,
      w: 1000,
      h: 200,
      rotation: 0,
      rows: [{ cells: [{ text: "Col A" }, { text: "Col B" }] }],
      cols: [1, 1],
      header: true,
      style: { size: 28, color: "text", border: "line", headerFill: "surface", font: "body" },
    });

    // Mutate slide text
    const mutatedText = JSON.parse(JSON.stringify(before)) as Deck;
    const tEl = mutatedText.slides[1].elements.find((e) => e.type === "text" && e.role === "title")!;
    if (tEl.type === "text") tEl.doc = richDocFromText("Key Goals!");
    expect(() => assertDeckTextPreserved(before, mutatedText)).toThrow(/text content changed/);

    // Mutate speaker notes
    const mutatedNotes = JSON.parse(JSON.stringify(before)) as Deck;
    mutatedNotes.slides[0].notes = "Welcome everyone!!";
    expect(() => assertDeckTextPreserved(before, mutatedNotes)).toThrow(/speaker notes changed/);

    // Mutate table cell
    const mutatedTable = JSON.parse(JSON.stringify(before)) as Deck;
    const tbl = mutatedTable.slides[2].elements.find((e) => e.type === "table")!;
    if (tbl.type === "table") tbl.rows[0].cells[1].text = "Col C";
    expect(() => assertDeckTextPreserved(before, mutatedTable)).toThrow(/table content changed/);

    // Hallucinate extra text element
    const hallucinated = JSON.parse(JSON.stringify(before)) as Deck;
    hallucinated.slides[0].elements.push({
      id: "extra_hallucination",
      type: "text",
      x: 0,
      y: 0,
      w: 200,
      h: 100,
      rotation: 0,
      doc: richDocFromText("Bonus slogan"),
      style: { font: "body", size: 32, color: "text", align: "left", valign: "top", lineHeight: 1.3, bold: false, italic: false },
      fill: null,
      autoHeight: false,
    });
    expect(() => assertDeckTextPreserved(before, hallucinated)).toThrow(/text content changed/);
  });

  it("flags no-op edits as unchanged and enforces operation, slide count, and speaker notes limits", () => {
    const deck = sampleDeck();
    const emptyOps = applySlidesEdits(deck, []);
    expect(emptyOps.unchanged).toBe(true);

    const sameTheme = applySlidesEdits(deck, [op({ op: "restyle_deck", themeId: "simple", themeMode: "light" })]);
    expect(sameTheme.unchanged).toBe(true);

    const tooManyOps = Array.from({ length: MAX_AI_SLIDES_OPS + 1 }, () => op({ op: "restyle_deck", themeId: "tech" }));
    expect(() => applySlidesEdits(deck, tooManyOps)).toThrow(SlidesEditError);

    expect(() => applySlidesEdits(deck, [op({ op: "update_slide", slideId: "slide_cover", notes: "a".repeat(MAX_SLIDE_NOTES + 1) })])).toThrow(SlidesEditError);

    const fullDeck = normalizeDeck({
      format: DECK_FORMAT,
      theme: { id: "simple", mode: "light" },
      slides: Array.from({ length: MAX_SLIDES }, (_, i) => ({ id: `s_${i}`, layout: "blank", elements: [] })),
    });
    expect(() => applySlidesEdits(fullDeck, [op({ op: "add_slide", title: "Overflow" })])).toThrow(SlidesEditError);
  });

  it("updates quote slide attribution + quote together, preserves pendingImagePrompt on restyle, and rejects deleting all slides", () => {
    const quoteSlide: Slide = {
      ...createSlide("quote", { quote: "Old quote", attribution: "Old Author" }),
      id: "slide_quote",
    };
    const pendingImgSlide: Slide = {
      ...createSlide("imageText", { title: "Vision", body: "Future state" }),
      id: "slide_pending",
    };
    const imgPlaceholder = pendingImgSlide.elements.find((el) => el.type === "image");
    if (imgPlaceholder && imgPlaceholder.type === "image") {
      imgPlaceholder.pendingImagePrompt = "Futuristic studio diagram";
    }
    const deck = normalizeDeck({ format: DECK_FORMAT, theme: { id: "simple", mode: "light" }, slides: [quoteSlide, pendingImgSlide] });

    const updatedQuote = applySlidesEdits(deck, [
      op({ op: "update_slide", slideId: "slide_quote", title: "Ada Lovelace", body: "Imagination is the Discovering Faculty." }),
    ]);
    const q = updatedQuote.deck.slides[0];
    const qText = q.elements.find((el) => el.type === "text" && el.role === "quote");
    const aText = q.elements.find((el) => el.type === "text" && el.role === "attribution");
    expect(qText?.type === "text" ? richDocText(qText.doc) : "").toBe("Imagination is the Discovering Faculty.");
    expect(aText?.type === "text" ? richDocText(aText.doc) : "").toBe("Ada Lovelace");

    const restyled = applySlidesEdits(deck, [
      op({ op: "restyle_deck", themeId: "editorial", themeMode: "dark", slideLayouts: [{ slideId: "slide_pending", layout: "bullets" }] }),
    ]);
    const restyledPending = restyled.deck.slides[1].elements.find((el) => el.type === "image");
    expect(restyledPending?.type === "image" ? restyledPending.pendingImagePrompt : undefined).toBe("Futuristic studio diagram");

    expect(() => applySlidesEdits(deck, [op({ op: "delete_slides", slideIds: ["slide_quote", "slide_pending"] })])).toThrow(/at least one slide/i);
  });
});
