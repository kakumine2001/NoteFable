import { describe, expect, it } from "vitest";
import { MAX_SLIDE_NOTES, MAX_SLIDES, validateCanvasData } from "@/lib/canvas-document";
import { createSlide } from "@/lib/slides/layouts";
import { DECK_FORMAT, normalizeDeck, SLIDE_HEIGHT, type Deck, type ImageElement, type Slide, type WhiteboardElement } from "@/lib/slides/model";
import { richDocFromText, richDocText } from "@/lib/slides/rich-text";
import {
  applySlidesEdits,
  assertDeckTextPreserved,
  buildAiSlidesDeck,
  extractDeckTextInventory,
  MAX_AI_SLIDES_OPS,
  measureRichDocHeight,
  SLIDE_THEME_IDS,
  SlidesEditError,
} from "@/lib/slides/ai-edit";

const NULL_OP = {
  slideId: null,
  elementId: null,
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
    expect(() => assertDeckTextPreserved(before, mutatedText)).toThrow(/Restyle invariant violated: content changed/);

    // Mutate speaker notes
    const mutatedNotes = JSON.parse(JSON.stringify(before)) as Deck;
    mutatedNotes.slides[0].notes = "Welcome everyone!!";
    expect(() => assertDeckTextPreserved(before, mutatedNotes)).toThrow(/speaker notes changed/);

    // Mutate table cell
    const mutatedTable = JSON.parse(JSON.stringify(before)) as Deck;
    const tbl = mutatedTable.slides[2].elements.find((e) => e.type === "table")!;
    if (tbl.type === "table") tbl.rows[0].cells[1].text = "Col C";
    expect(() => assertDeckTextPreserved(before, mutatedTable)).toThrow(/Restyle invariant violated: content changed/);

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
    expect(() => assertDeckTextPreserved(before, hallucinated)).toThrow(/Restyle invariant violated: elements added or removed/);
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

  it("handles quote without attribution (no index shift), Full image title fallback, and preserves rich untouched title on body-only rebuild", () => {
    const bareQuote: Slide = {
      ...createSlide("quote", { quote: "Original quote" }),
      id: "slide_bare_quote",
    };
    bareQuote.elements = bareQuote.elements.filter((el) => el.role !== "attribution");

    const fullImg: Slide = {
      ...createSlide("fullImage", { caption: "Hero shot" }),
      id: "slide_full_img",
    };

    const richTitleSlide: Slide = {
      ...createSlide("bullets", { title: "Bold Title", body: "Initial" }),
      id: "slide_rich_title",
    };
    const titleEl = richTitleSlide.elements.find((el) => el.type === "text" && el.role === "title");
    if (titleEl && titleEl.type === "text") {
      titleEl.doc = {
        type: "doc",
        content: [{ type: "paragraph", attrs: { align: null }, content: [{ type: "text", text: "Bold Title", marks: [{ type: "strong" }] }] }],
      };
    }

    const deck = normalizeDeck({ format: DECK_FORMAT, theme: { id: "simple", mode: "light" }, slides: [bareQuote, fullImg, richTitleSlide] });
    const res = applySlidesEdits(deck, [
      op({ op: "update_slide", slideId: "slide_bare_quote", title: "Author", body: "New quote" }),
      op({ op: "update_slide", slideId: "slide_full_img", title: "Full Image Title", body: "Updated caption" }),
      op({ op: "update_slide", slideId: "slide_rich_title", body: "| A | B |\n| --- | --- |\n| 1 | 2 |" }),
    ]);

    const q = res.deck.slides[0];
    const qText = q.elements.find((el) => el.type === "text" && el.role === "quote");
    const aText = q.elements.find((el) => el.type === "text" && el.role === "attribution");
    expect(qText?.type === "text" ? richDocText(qText.doc) : "").toBe("New quote");
    expect(aText?.type === "text" ? richDocText(aText.doc) : "").toBe("Author");

    const fi = res.deck.slides[1];
    const fiTitle = fi.elements.find((el) => el.type === "text" && el.role === "title");
    const fiCaption = fi.elements.find((el) => el.type === "text" && el.role === "caption");
    expect(fiTitle?.type === "text" ? richDocText(fiTitle.doc) : "").toBe("Full Image Title");
    expect(fiCaption?.type === "text" ? richDocText(fiCaption.doc) : "").toBe("Updated caption");

    const rt = res.deck.slides[2];
    const rtTitle = rt.elements.find((el) => el.type === "text" && el.role === "title");
    expect(rtTitle?.id).toBe(titleEl?.id);
    expect(rtTitle?.type === "text" ? JSON.stringify(rtTitle.doc) : "").toContain('"strong"');
  });

  it("enforces strict structural restyle invariant (links, marks, code lang, decorative shapes, and pre-normalized stored section length)", () => {
    const base = sampleDeck();
    // Add a link, code language, and empty decorative shape with a role.
    const slide = base.slides[1];
    const bodyEl = slide.elements.find((el) => el.type === "text" && el.role === "body");
    if (bodyEl && bodyEl.type === "text") {
      bodyEl.doc = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { align: null },
            content: [{ type: "text", text: "Docs", marks: [{ type: "link", attrs: { href: "https://example.com/a" } }] }],
          },
          { type: "code_block", attrs: { language: "ts" }, content: [{ type: "text", text: "const x = 1;" }] },
        ],
      };
    }
    slide.elements.push({
      id: "decor_shape_1",
      type: "shape",
      role: "body",
      shape: "roundRect",
      x: 100,
      y: 100,
      w: 200,
      h: 120,
      rotation: 0,
      fill: "accent",
      stroke: null,
      strokeWidth: 0,
      dash: "solid",
      doc: { type: "doc", content: [{ type: "paragraph", attrs: { align: null } }] },
      style: { font: "body", size: 28, color: "text", align: "center", valign: "middle", lineHeight: 1.2, bold: false, italic: false },
    });

    // Empty decorative shape survives layout change during restyle_deck!
    const restyled = applySlidesEdits(base, [
      op({ op: "restyle_deck", themeId: "tech", slideLayouts: [{ slideId: "slide_goals", layout: "twoColumn" }] }),
    ]);
    expect(restyled.deck.slides[1].elements.some((el) => el.id === "decor_shape_1" && el.type === "shape")).toBe(true);

    // Changing only link href or code language must be rejected by assertDeckTextPreserved.
    const alteredHref: Deck = JSON.parse(JSON.stringify(restyled.deck));
    const alteredBody = alteredHref.slides[1].elements.find((el) => el.id === bodyEl?.id);
    if (alteredBody && alteredBody.type === "text") {
      alteredBody.doc.content[0] = {
        type: "paragraph",
        attrs: { align: null },
        content: [{ type: "text", text: "Docs", marks: [{ type: "link", attrs: { href: "https://evil.example/b" } }] }],
      };
    }
    expect(() => assertDeckTextPreserved(base, alteredHref)).toThrow(/Restyle invariant violated/i);

    // Raw stored section > 200 chars must not be silently truncated by restyle_deck.
    const rawOversizedSection = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
    (rawOversizedSection.slides as Record<string, unknown>[])[0].section = "x".repeat(201);
    expect(() => applySlidesEdits(rawOversizedSection, [op({ op: "restyle_deck", themeId: "tech" })])).toThrow(/Restyle invariant violated/i);
  });

  it("supports scoped update_element without touching sibling boxes/tables, rejects colliding refs, blank/conflicting anchors, and silent noteToDeck truncation", () => {
    const deck = sampleDeck();
    deck.slides[1].elements.push(
      {
        id: "free_box_1",
        type: "text",
        x: 200,
        y: 600,
        w: 600,
        h: 160,
        rotation: 0,
        doc: { type: "doc", content: [{ type: "paragraph", attrs: { align: null }, content: [{ type: "text", text: "Original note box" }] }] },
        style: { font: "body", size: 32, color: "text", align: "left", valign: "top", lineHeight: 1.3, bold: false, italic: false },
        fill: null,
        autoHeight: false,
      },
      {
        id: "free_box_2",
        type: "text",
        x: 900,
        y: 600,
        w: 600,
        h: 160,
        rotation: 0,
        doc: { type: "doc", content: [{ type: "paragraph", attrs: { align: null }, content: [{ type: "text", text: "Keep untouched" }] }] },
        style: { font: "body", size: 32, color: "text", align: "left", valign: "top", lineHeight: 1.3, bold: false, italic: false },
        fill: null,
        autoHeight: false,
      },
    );

    const elemEdited = applySlidesEdits(deck, [
      op({ op: "update_element", slideId: "slide_goals", elementId: "free_box_1", body: "**Crisp rewritten box**" }),
    ]);
    const box1 = elemEdited.deck.slides[1].elements.find((el) => el.id === "free_box_1");
    const box2 = elemEdited.deck.slides[1].elements.find((el) => el.id === "free_box_2");
    expect(box1?.type === "text" ? richDocText(box1.doc) : "").toBe("Crisp rewritten box");
    expect(box2?.type === "text" ? richDocText(box2.doc) : "").toBe("Keep untouched");

    // Local ref cannot collide with an existing slide ID.
    expect(() => applySlidesEdits(deck, [
      op({ op: "add_slide", title: "Shadow", ref: "slide_cover" }),
    ])).toThrow(/conflicts with an existing slide ID/i);

    // Blank afterSlideId and conflicting afterSlideId + atStart=true are rejected.
    expect(() => applySlidesEdits(deck, [op({ op: "add_slide", title: "X", afterSlideId: "   " })])).toThrow(/afterSlideId/i);
    expect(() => applySlidesEdits(deck, [op({ op: "add_slide", title: "X", afterSlideId: "slide_cover", atStart: true })])).toThrow(/not both/i);

    // Two-column update with empty right placeholder distributes bullets across both columns.
    const twoColDeck = normalizeDeck({
      format: DECK_FORMAT,
      theme: { id: "simple", mode: "light" },
      slides: [{ ...createSlide("twoColumn", { title: "Compare" }), id: "tc1" }],
    });
    const updatedTwoCol = applySlidesEdits(twoColDeck, [
      op({ op: "update_slide", slideId: "tc1", body: "- One\n- Two\n- Three\n- Four" }),
    ]);
    const col1 = updatedTwoCol.deck.slides[0].elements.find((el) => el.type === "text" && el.role === "body");
    const col2 = updatedTwoCol.deck.slides[0].elements.find((el) => el.type === "text" && el.role === "body2");
    expect(col1?.type === "text" ? richDocText(col1.doc) : "").toContain("One");
    expect(col2?.type === "text" ? richDocText(col2.doc) : "").toContain("Three");

    // Subset reorder moving section head keeps section on remaining slides of that row.
    const sectionedDeck = normalizeDeck({
      format: DECK_FORMAT,
      theme: { id: "simple", mode: "light" },
      slides: [
        { ...createSlide("bullets", { title: "A1" }), id: "a1", section: "Alpha" },
        { ...createSlide("bullets", { title: "A2" }), id: "a2" },
        { ...createSlide("bullets", { title: "B1" }), id: "b1", section: "Beta" },
        { ...createSlide("bullets", { title: "B2" }), id: "b2" },
      ],
    });
    const moved = applySlidesEdits(sectionedDeck, [
      op({ op: "reorder_slides", slideIds: ["b1"], afterSlideId: "a1" }),
    ]);
    expect(moved.deck.slides.map((s) => s.id)).toEqual(["a1", "b1", "a2", "b2"]);
    expect(moved.deck.slides[0].section).toBe("Alpha");
    expect(moved.deck.slides[1].section).toBeUndefined();
    expect(moved.deck.slides[3].section).toBe("Beta");
  });

  it("rejects restyle_deck when raw stored text, math, code lang, nested list, or table cells would be truncated or in mixed-op runs", () => {
    const baseRawDeck = () => JSON.parse(JSON.stringify(sampleDeck())) as Record<string, unknown> & {
      slides: Array<{ id: string; elements: Array<Record<string, unknown>> }>;
    };

    // >20k text node on pure restyle
    const longTextRaw = baseRawDeck();
    (longTextRaw.slides[1].elements[1].doc as { content: unknown[] }).content = [
      { type: "paragraph", content: [{ type: "text", text: "a".repeat(20_004) }] },
    ];
    expect(() => applySlidesEdits(longTextRaw, [op({ op: "restyle_deck", themeId: "editorial" })])).toThrow(/Restyle invariant violated/);

    // >10k math latex (inline and block)
    const longMathInlineRaw = baseRawDeck();
    (longMathInlineRaw.slides[1].elements[1].doc as { content: unknown[] }).content = [
      { type: "paragraph", content: [{ type: "math_inline", attrs: { latex: "x".repeat(10_005) } }] },
    ];
    expect(() => applySlidesEdits(longMathInlineRaw, [op({ op: "restyle_deck", themeId: "editorial" })])).toThrow(/Restyle invariant violated/);

    const longMathBlockRaw = baseRawDeck();
    (longMathBlockRaw.slides[1].elements[1].doc as { content: unknown[] }).content = [
      { type: "math_block", attrs: { latex: "y".repeat(10_005) } },
    ];
    expect(() => applySlidesEdits(longMathBlockRaw, [op({ op: "restyle_deck", themeId: "editorial" })])).toThrow(/Restyle invariant violated/);

    // >2k table cell
    const longCellRaw = baseRawDeck();
    longCellRaw.slides[2].elements.push({
      id: "raw_tbl",
      type: "table",
      x: 120,
      y: 500,
      w: 1000,
      h: 200,
      rotation: 0,
      rows: [{ cells: [{ text: "z".repeat(2_005) }, { text: "ok" }] }],
      cols: [1, 1],
      header: true,
      style: { size: 28, color: "text", border: "line", headerFill: "surface", font: "body" },
    });
    expect(() => applySlidesEdits(longCellRaw, [op({ op: "restyle_deck", themeId: "editorial" })])).toThrow(/Restyle invariant violated/);

    // 7-level nested list (exceeds MAX_DEPTH = 6)
    let nestedNode: Record<string, unknown> = {
      type: "bullet_list",
      content: [{ type: "list_item", content: [{ type: "paragraph", content: [{ type: "text", text: "Deepest" }] }] }],
    };
    for (let d = 0; d < 6; d++) {
      nestedNode = {
        type: "bullet_list",
        content: [{
          type: "list_item",
          content: [{ type: "paragraph", content: [{ type: "text", text: `Level ${d}` }] }, nestedNode],
        }],
      };
    }
    const deepListRaw = baseRawDeck();
    (deepListRaw.slides[1].elements[1].doc as { content: unknown[] }).content = [nestedNode];
    expect(() => applySlidesEdits(deepListRaw, [op({ op: "restyle_deck", themeId: "editorial" })])).toThrow(/Restyle invariant violated/);

    // Mixed-op run: update_slide on slide_cover + restyle_deck still catches lossy untouched slide_goals
    const mixedLossyRaw = baseRawDeck();
    (mixedLossyRaw.slides[1].elements[1].doc as { content: unknown[] }).content = [
      { type: "paragraph", content: [{ type: "text", text: "b".repeat(20_004) }] },
    ];
    expect(() => applySlidesEdits(mixedLossyRaw, [
      op({ op: "update_slide", slideId: "slide_cover", title: "Updated Cover" }),
      op({ op: "restyle_deck", themeId: "editorial" }),
    ])).toThrow(/Restyle invariant violated/);
  });

  it("preserves >120-char titles and literal Markdown markers during default merge_slides", () => {
    const longTitle = "Strategic Architecture Roadmap Milestone Review — Cross-Platform Alignment and Reliability Metrics 2026 Overview (Phase One)";
    expect(longTitle.length).toBeGreaterThan(120);

    const s1 = { ...createSlide("bullets", { title: longTitle, body: "Intro" }), id: "m1" };
    const body1 = s1.elements.find((e) => e.type === "text" && e.role === "body");
    if (body1?.type === "text") {
      body1.doc = richDocFromText("Literal image syntax: ![alt](https://example.com/a.png)");
    }
    const s2 = { ...createSlide("bullets", { title: "Second Slide", body: "Item" }), id: "m2" };
    const body2 = s2.elements.find((e) => e.type === "text" && e.role === "body");
    if (body2?.type === "text") {
      body2.doc = richDocFromText("Literal divider: --- and **not-bold**");
    }
    const deck = normalizeDeck({ format: DECK_FORMAT, theme: { id: "simple", mode: "light" }, slides: [s1, s2] });

    const res = applySlidesEdits(deck, [op({ op: "merge_slides", slideIds: ["m1", "m2"] })]);
    const mergedSlide = res.deck.slides[0];
    const titleEl = mergedSlide.elements.find((e) => e.type === "text" && e.role === "title");
    expect(titleEl?.type === "text" ? richDocText(titleEl.doc) : "").toBe(longTitle);

    const bodyTexts = mergedSlide.elements
      .filter((e): e is Extract<typeof e, { type: "text" }> => e.type === "text" && e.role !== "title")
      .map((e) => richDocText(e.doc))
      .join("\n");
    expect(bodyTexts).toContain("![alt](https://example.com/a.png)");
    expect(bodyTexts).toContain("---");
    expect(bodyTexts).toContain("**not-bold**");

    // Ensure **not-bold** stayed plain literal text with no strong mark injected by Markdown reparsing.
    const allInlines = mergedSlide.elements
      .filter((e): e is Extract<typeof e, { type: "text" }> => e.type === "text" && e.role !== "title")
      .flatMap((e) => e.doc.content)
      .flatMap((b) => (b.type === "paragraph" ? (b.content ?? []) : []));
    const literalNode = allInlines.find((n) => n.type === "text" && n.text.includes("**not-bold**"));
    expect(literalNode).toBeDefined();
    expect(literalNode?.type === "text" ? literalNode.marks : undefined).toBeUndefined();
  });

  it("allows demoting placeholders on bullets->blank and twoColumn->bullets restyles while rejecting free/demoted style edits", () => {
    const twoCol = { ...createSlide("twoColumn", { title: "Compare", body: "Left side", body2: "Right side" }), id: "tc" };
    const bullets = { ...createSlide("bullets", { title: "List", body: "One" }), id: "bl" };
    const deck = normalizeDeck({ format: DECK_FORMAT, theme: { id: "simple", mode: "light" }, slides: [twoCol, bullets] });

    const demoted = applySlidesEdits(deck, [
      op({
        op: "restyle_deck",
        themeId: "editorial",
        slideLayouts: [
          { slideId: "tc", layout: "bullets" },
          { slideId: "bl", layout: "blank" },
        ],
      }),
    ]);
    expect(demoted.deck.slides[0].layout).toBe("bullets");
    expect(demoted.deck.slides[1].layout).toBe("blank");
    expect(() => assertDeckTextPreserved(deck, demoted.deck)).not.toThrow();

    // Tampering style on a demoted element (body2 now has role === undefined) must throw.
    const tamperedDemoted = JSON.parse(JSON.stringify(demoted.deck)) as Deck;
    const demotedRight = tamperedDemoted.slides[0].elements.find((e) => e.type === "text" && !e.role && richDocText(e.doc).includes("Right side"));
    if (demotedRight?.type === "text") demotedRight.style.size = 99;
    expect(() => assertDeckTextPreserved(deck, tamperedDemoted)).toThrow(/Restyle invariant violated: style changed/);

    // Tampering style on an already-free element must also throw.
    const withFree = normalizeDeck({
      ...deck,
      slides: [
        {
          ...bullets,
          elements: [
            ...bullets.elements,
            {
              id: "free_txt",
              type: "text",
              x: 100,
              y: 800,
              w: 400,
              h: 80,
              rotation: 0,
              doc: richDocFromText("Footnote"),
              style: { font: "body", size: 24, color: "muted", align: "left", valign: "top", lineHeight: 1.3, bold: false, italic: false },
              fill: null,
              autoHeight: false,
            },
          ],
        },
      ],
    });
    const tamperedFree = JSON.parse(JSON.stringify(withFree)) as Deck;
    const freeEl = tamperedFree.slides[0].elements.find((e) => e.id === "free_txt");
    if (freeEl?.type === "text") freeEl.style.bold = true;
    expect(() => assertDeckTextPreserved(withFree, tamperedFree)).toThrow(/Restyle invariant violated: style changed/);
  });

  it("keeps quote attribution out of the quote body when updating a quote slide with a Markdown table", () => {
    const quoteSlide = {
      ...createSlide("quote", { quote: "Imagination is critical.", attribution: "Ada Lovelace" }),
      id: "q1",
    };
    const deck = normalizeDeck({ format: DECK_FORMAT, theme: { id: "simple", mode: "light" }, slides: [quoteSlide] });

    const res = applySlidesEdits(deck, [
      op({
        op: "update_slide",
        slideId: "q1",
        body: "| Metric | Target |\n| --- | --- |\n| Latency | 50ms |",
      }),
    ]);

    const updated = res.deck.slides[0];
    expect(updated.layout).toBe("quote");
    expect(updated.elements.some((el) => el.type === "table")).toBe(true);
    const attrEls = updated.elements.filter((el) => el.type === "text" && el.role === "attribution");
    const quoteEls = updated.elements.filter((el) => el.type === "text" && el.role === "quote");
    expect(attrEls.length).toBe(1);
    expect(attrEls[0].type === "text" ? richDocText(attrEls[0].doc) : "").toBe("Ada Lovelace");
    for (const q of quoteEls) {
      expect(q.type === "text" ? richDocText(q.doc) : "").not.toContain("Ada Lovelace");
    }
  });

  it("enforces element bounding boxes on update_element including shape, fullImage caption, and autoHeight limits", () => {
    const fullImg = { ...createSlide("fullImage", { caption: "Short caption" }), id: "fi1" };
    const captionEl = fullImg.elements.find((e) => e.type === "text" && e.role === "caption")!;
    const deck = normalizeDeck({
      format: DECK_FORMAT,
      theme: { id: "simple", mode: "light" },
      slides: [
        {
          ...fullImg,
          elements: [
            ...fullImg.elements,
            {
              id: "small_shape",
              type: "shape",
              x: 100,
              y: 100,
              w: 180,
              h: 60,
              rotation: 0,
              shape: "rect",
              fill: "accent",
              stroke: null,
              strokeWidth: 0,
              dash: "solid",
              doc: richDocFromText("OK"),
              style: { font: "body", size: 32, color: "background", align: "center", valign: "middle", lineHeight: 1.3, bold: false, italic: false },
            },
            {
              id: "auto_box",
              type: "text",
              x: 100,
              y: 650,
              w: 600,
              h: 80,
              rotation: 0,
              doc: richDocFromText("Short"),
              style: { font: "body", size: 32, color: "text", align: "left", valign: "top", lineHeight: 1.3, bold: false, italic: false },
              fill: null,
              autoHeight: true,
            },
          ],
        },
      ],
    });

    // Reject 799-char rewrite into shallow fullImage caption box.
    expect(() =>
      applySlidesEdits(deck, [op({ op: "update_element", slideId: "fi1", elementId: captionEl.id, body: "Word ".repeat(159) + "end." })]),
    ).toThrow(/overflows text box/);

    // Reject overflowing shape rewrite.
    expect(() =>
      applySlidesEdits(deck, [op({ op: "update_element", slideId: "fi1", elementId: "small_shape", body: "This paragraph is far too large for the badge shape." })]),
    ).toThrow(/overflows shape element/);

    // autoHeight grows box when still within SLIDE_HEIGHT - y - 24...
    const expanded = applySlidesEdits(deck, [
      op({ op: "update_element", slideId: "fi1", elementId: "auto_box", body: "Line 1\n\nLine 2\n\nLine 3\n\nLine 4" }),
    ]);
    const grownEl = expanded.deck.slides[0].elements.find((e) => e.id === "auto_box");
    expect(grownEl?.type === "text" ? grownEl.h : 0).toBeGreaterThan(80);
    expect(grownEl?.type === "text" ? grownEl.y + grownEl.h : 0).toBeLessThanOrEqual(SLIDE_HEIGHT);

    // ...and rejects if required height exceeds SLIDE_HEIGHT - y - 24 (406px at y=650).
    const tooTallBody = Array.from({ length: 10 }, (_, idx) => `Line ${idx + 1}`).join("\n\n");
    expect(() =>
      applySlidesEdits(deck, [op({ op: "update_element", slideId: "fi1", elementId: "auto_box", body: tooTallBody })]),
    ).toThrow(/overflows slide bounds/);
  });

  it("preserves sections on full-deck reorder_slides even when atStart is true", () => {
    const deck = normalizeDeck({
      format: DECK_FORMAT,
      theme: { id: "simple", mode: "light" },
      slides: [
        { ...createSlide("bullets", { title: "A1" }), id: "s1", section: "Alpha" },
        { ...createSlide("bullets", { title: "A2" }), id: "s2" },
        { ...createSlide("bullets", { title: "B1" }), id: "s3", section: "Beta" },
        { ...createSlide("bullets", { title: "B2" }), id: "s4" },
      ],
    });

    const res = applySlidesEdits(deck, [
      op({ op: "reorder_slides", slideIds: ["s4", "s3", "s2", "s1"], atStart: true }),
    ]);

    expect(res.deck.slides.map((s) => s.id)).toEqual(["s4", "s3", "s2", "s1"]);
    expect(res.deck.slides[0].section).toBe("Beta");
    expect(res.deck.slides[1].section).toBeUndefined();
    expect(res.deck.slides[2].section).toBe("Alpha");
    expect(res.deck.slides[3].section).toBeUndefined();
  });

  it("rejects mixed restyle runs when untouched fields on an edited slide have >20k chars", () => {
    const baseRaw = () => JSON.parse(JSON.stringify(sampleDeck())) as Record<string, unknown> & {
      slides: Array<{ id: string; elements: Array<Record<string, unknown>> }>;
    };
    const overTitleDeck = () => {
      const raw = baseRaw();
      (raw.slides[1].elements[0].doc as { content: unknown[] }).content = [
        { type: "paragraph", content: [{ type: "text", text: "T".repeat(20_001) }] },
      ];
      return raw;
    };

    // Notes-only update_slide before or after restyle_deck must not exempt the untouched 20,001-char title.
    expect(() => applySlidesEdits(overTitleDeck(), [
      op({ op: "update_slide", slideId: "slide_goals", notes: "New speaker note" }),
      op({ op: "restyle_deck", themeId: "editorial" }),
    ])).toThrow(/Restyle invariant violated/);

    expect(() => applySlidesEdits(overTitleDeck(), [
      op({ op: "restyle_deck", themeId: "editorial" }),
      op({ op: "update_slide", slideId: "slide_goals", notes: "New speaker note" }),
    ])).toThrow(/Restyle invariant violated/);

    // Editing one element on slide_goals must not exempt the sibling untouched 20,001-char title element.
    const bodyDeck = overTitleDeck();
    const bodyElId = String(bodyDeck.slides[1].elements[1].id);
    expect(() => applySlidesEdits(bodyDeck, [
      op({ op: "update_element", slideId: "slide_goals", elementId: bodyElId, body: "Short replacement" }),
      op({ op: "restyle_deck", themeId: "editorial" }),
    ])).toThrow(/Restyle invariant violated/);
  });

  it("preserves same-text linked titles, custom colors/sizes, rich quote attribution, and table cell whitespace on default merge_slides", () => {
    const q1 = { ...createSlide("quote", { quote: "First quote" }), id: "mq1" };
    const attrEl = q1.elements.find((e) => e.type === "text" && e.role === "attribution");
    if (attrEl?.type === "text") {
      attrEl.doc = {
        type: "doc",
        content: [{
          type: "paragraph",
          content: [
            { type: "text", text: "Ada ", marks: [{ type: "strong" }] },
            { type: "text", text: "Lovelace", marks: [{ type: "strong" }, { type: "link", attrs: { href: "https://example.com/ada" } }] },
          ],
        }],
      };
    }
    const q2 = { ...createSlide("bullets", { title: "More notes", body: "Second item" }), id: "mq2" };
    const mergedQuoteDeck = normalizeDeck({ format: DECK_FORMAT, theme: { id: "simple", mode: "light" }, slides: [q1, q2] });
    const mergedQuoteRes = applySlidesEdits(mergedQuoteDeck, [op({ op: "merge_slides", slideIds: ["mq1", "mq2"] })]);
    const attrAfter = mergedQuoteRes.deck.slides[0].elements.find((e) => e.type === "text" && e.role === "attribution");
    expect(attrAfter?.type === "text" && attrAfter.doc.content[0]?.type === "paragraph"
      ? attrAfter.doc.content[0].content?.some((n) => n.type === "text" && n.marks?.some((m) => m.type === "strong") && n.marks?.some((m) => m.type === "link" && m.attrs.href === "https://example.com/ada"))
      : false).toBe(true);

    // Same visible title with different link, custom color/font size, and leading/trailing whitespace in table cell.
    const b1 = { ...createSlide("bullets", { body: "Alpha" }), id: "mb1" };
    const t1 = b1.elements.find((e) => e.type === "text" && e.role === "title");
    if (t1?.type === "text") {
      t1.doc = {
        type: "doc",
        content: [{
          type: "paragraph",
          content: [{ type: "text", text: "Topic", marks: [{ type: "link", attrs: { href: "https://example.com/one" } }] }],
        }],
      };
    }
    const p1 = b1.elements.find((e) => e.type === "text" && e.role === "body");
    if (p1?.type === "text") {
      p1.doc = {
        type: "doc",
        content: [{
          type: "paragraph",
          content: [{ type: "text", text: "Styled", marks: [{ type: "color", attrs: { color: "#123456" } }, { type: "size", attrs: { size: 54 } }] }],
        }],
      };
    }
    const b2 = { ...createSlide("bullets", { body: "Beta" }), id: "mb2" };
    const t2 = b2.elements.find((e) => e.type === "text" && e.role === "title");
    if (t2?.type === "text") {
      t2.doc = {
        type: "doc",
        content: [{
          type: "paragraph",
          content: [{ type: "text", text: "Topic", marks: [{ type: "link", attrs: { href: "https://example.com/two" } }] }],
        }],
      };
    }
    b2.elements.push({
      id: "tbl_ws",
      type: "table",
      x: 120,
      y: 600,
      w: 800,
      h: 200,
      rotation: 0,
      rows: [{ cells: [{ text: "  padded cell  " }] }],
      cols: [1],
      header: true,
      style: { size: 28, color: "text", border: "line", headerFill: "surface", font: "body" },
    });

    const richMerged = applySlidesEdits(
      normalizeDeck({ format: DECK_FORMAT, theme: { id: "simple", mode: "light" }, slides: [b1, b2] }),
      [op({ op: "merge_slides", slideIds: ["mb1", "mb2"] })],
    );
    const mergedEls = richMerged.deck.slides[0].elements;
    const allTextInlines = mergedEls
      .filter((e): e is Extract<typeof e, { type: "text" }> => e.type === "text")
      .flatMap((e) => e.doc.content)
      .flatMap((b) => (b.type === "paragraph" ? (b.content ?? []) : []));
    expect(allTextInlines.some((n) => n.type === "text" && n.marks?.some((m) => m.type === "link" && m.attrs.href === "https://example.com/two"))).toBe(true);
    expect(allTextInlines.some((n) => n.type === "text" && n.marks?.some((m) => m.type === "color" && m.attrs.color === "#123456") && n.marks?.some((m) => m.type === "size" && m.attrs.size === 54))).toBe(true);
    const tblAfter = mergedEls.find((e) => e.type === "table");
    expect(tblAfter?.type === "table" ? tblAfter.rows[0].cells[0].text : "").toBe("  padded cell  ");
  });

  it("allows sequential restyle transitions in one batch (bullets -> quote -> blank)", () => {
    const deck = normalizeDeck({
      format: DECK_FORMAT,
      theme: { id: "simple", mode: "light" },
      slides: [{ ...createSlide("bullets", { title: "Title", body: "Item 1" }), id: "r1" }],
    });
    const res = applySlidesEdits(deck, [
      op({ op: "restyle_deck", slideLayouts: [{ slideId: "r1", layout: "quote" }] }),
      op({ op: "restyle_deck", slideLayouts: [{ slideId: "r1", layout: "blank" }] }),
    ]);
    expect(res.deck.slides[0].layout).toBe("blank");
  });

  it("places attribution correctly when updating content and switching to quote layout in one op", () => {
    const deck = normalizeDeck({
      format: DECK_FORMAT,
      theme: { id: "simple", mode: "light" },
      slides: [{ ...createSlide("bullets", { title: "Old Title", body: "Old body" }), id: "b1" }],
    });
    const res = applySlidesEdits(deck, [
      op({
        op: "update_slide",
        slideId: "b1",
        layout: "quote",
        title: "Ada Lovelace",
        body: "Analytical engines weave algebra.\n\n| Metric | Value |\n| --- | --- |\n| P99 | 12ms |",
      }),
    ]);
    const slide = res.deck.slides[0];
    expect(slide.layout).toBe("quote");
    const attrEl = slide.elements.find((e) => e.type === "text" && e.role === "attribution");
    expect(attrEl?.type === "text" ? richDocText(attrEl.doc) : "").toBe("Ada Lovelace");
    const freeAda = slide.elements.filter((e) => e.type === "text" && !e.role && richDocText(e.doc).includes("Ada Lovelace"));
    expect(freeAda).toHaveLength(0);
  });

  it("rejects overflowing nested LaTeX formulas on update_element for fixed text, autoHeight bottom text, and shapes", () => {
    const nestedFrac = "\\dfrac{1}{1 + \\dfrac{1}{1 + \\dfrac{1}{1 + \\dfrac{1}{1 + \\dfrac{1}{2}}}}}";
    const slide = {
      ...createSlide("blank"),
      id: "math_box_slide",
      elements: [
        {
          id: "fixed_math_box",
          type: "text" as const,
          x: 100,
          y: 100,
          w: 600,
          h: 110,
          rotation: 0,
          doc: richDocFromText("short"),
          style: { font: "body" as const, size: 32, color: "text" as const, align: "left" as const, valign: "top" as const, lineHeight: 1.3, bold: false, italic: false },
          fill: null,
          autoHeight: false,
        },
        {
          id: "auto_bottom_box",
          type: "text" as const,
          x: 100,
          y: 900,
          w: 600,
          h: 110,
          rotation: 0,
          doc: richDocFromText("short"),
          style: { font: "body" as const, size: 32, color: "text" as const, align: "left" as const, valign: "top" as const, lineHeight: 1.3, bold: false, italic: false },
          fill: null,
          autoHeight: true,
        },
        {
          id: "shape_math_box",
          type: "shape" as const,
          x: 800,
          y: 100,
          w: 400,
          h: 110,
          rotation: 0,
          shape: "rect" as const,
          fill: "accent" as const,
          stroke: null,
          strokeWidth: 0,
          dash: "solid" as const,
          doc: richDocFromText("short"),
          style: { font: "body" as const, size: 32, color: "background" as const, align: "center" as const, valign: "middle" as const, lineHeight: 1.3, bold: false, italic: false },
        },
      ],
    };
    const deck = normalizeDeck({ format: DECK_FORMAT, theme: { id: "simple", mode: "light" }, slides: [slide] });

    expect(() =>
      applySlidesEdits(deck, [op({ op: "update_element", slideId: "math_box_slide", elementId: "fixed_math_box", body: `$$\n${nestedFrac}\n$$` })]),
    ).toThrow(/overflows text box/);

    expect(() =>
      applySlidesEdits(deck, [op({ op: "update_element", slideId: "math_box_slide", elementId: "auto_bottom_box", body: `$$\n${nestedFrac}\n$$` })]),
    ).toThrow(/overflows slide bounds/);

    expect(() =>
      applySlidesEdits(deck, [op({ op: "update_element", slideId: "math_box_slide", elementId: "shape_math_box", body: `$${nestedFrac}$` })]),
    ).toThrow(/overflows shape element/);
  });

  it("prioritizes changed layout slides over unchanged earlier slides in restyle_deck focusIds", () => {
    const slides = Array.from({ length: 8 }, (_, idx) => ({
      ...createSlide("bullets", { title: `Slide ${idx + 1}`, body: "Point" }),
      id: `s${idx + 1}`,
    }));
    const deck = normalizeDeck({ format: DECK_FORMAT, theme: { id: "simple", mode: "light" }, slides });

    const layoutOnly = applySlidesEdits(deck, [
      op({
        op: "restyle_deck",
        slideLayouts: [
          { slideId: "s6", layout: "twoColumn" },
          { slideId: "s8", layout: "imageText" },
        ],
      }),
    ]);
    expect(layoutOnly.focusIds.slice(0, 2)).toEqual(["s6", "s8"]);

    const withTheme = applySlidesEdits(deck, [
      op({
        op: "restyle_deck",
        themeId: "editorial",
        slideLayouts: [
          { slideId: "s6", layout: "twoColumn" },
          { slideId: "s8", layout: "imageText" },
        ],
      }),
    ]);
    expect(withTheme.focusIds.slice(0, 2)).toEqual(["s6", "s8"]);
    expect(withTheme.focusIds.length).toBeLessThanOrEqual(4);
  });

  it("preserves custom position, size, box style, fill, and autoHeight on same-layout restyle_deck and set_layout", () => {
    const slide = { ...createSlide("bullets", { title: "Custom Styled Title", body: "Point A" }), id: "custom_s1" };
    const titleEl = slide.elements.find((e) => e.type === "text" && e.role === "title");
    if (titleEl?.type === "text") {
      titleEl.x = 300;
      titleEl.y = 140;
      titleEl.w = 900;
      titleEl.h = 200;
      titleEl.style = { ...titleEl.style, color: "#cc2222", italic: true, size: 96, align: "center", bold: false };
      titleEl.fill = "surface";
      titleEl.autoHeight = true;
    }
    const deck = normalizeDeck({ format: DECK_FORMAT, theme: { id: "simple", mode: "light" }, slides: [slide] });

    const restyled = applySlidesEdits(deck, [
      op({ op: "restyle_deck", themeId: "tech", slideLayouts: [{ slideId: "custom_s1", layout: "bullets" }] }),
    ]);
    const afterTitle = restyled.deck.slides[0].elements.find((e) => e.type === "text" && e.role === "title");
    expect(afterTitle?.type === "text" ? afterTitle.x : null).toBe(300);
    expect(afterTitle?.type === "text" ? afterTitle.w : null).toBe(900);
    expect(afterTitle?.type === "text" ? afterTitle.style : null).toMatchObject({ color: "#cc2222", italic: true, size: 96, align: "center", bold: false });
    expect(afterTitle?.type === "text" ? afterTitle.fill : null).toBe("surface");
    expect(afterTitle?.type === "text" ? afterTitle.autoHeight : null).toBe(true);

    const sameLayout = applySlidesEdits(deck, [
      op({ op: "set_layout", slideId: "custom_s1", layout: "bullets" }),
    ]);
    const afterSetLayout = sameLayout.deck.slides[0].elements.find((e) => e.type === "text" && e.role === "title");
    expect(afterSetLayout?.type === "text" ? afterSetLayout.x : null).toBe(300);
    expect(afterSetLayout?.type === "text" ? afterSetLayout.style.color : null).toBe("#cc2222");

    // Invariant must reject mutating placeholder frame or style when layout did not change.
    const mutatedDeck = JSON.parse(JSON.stringify(deck)) as Deck;
    const mutatedTitle = mutatedDeck.slides[0].elements.find((e) => e.type === "text" && e.role === "title");
    if (mutatedTitle?.type === "text") mutatedTitle.x = 120;
    expect(() => assertDeckTextPreserved(deck, mutatedDeck)).toThrow(/Restyle invariant violated/);
  });

  it("preserves freeform text boxes and existing tables when update_slide rebuilds for a long body", () => {
    const slide = { ...createSlide("bullets", { title: "Annual Overview", body: "Initial" }), id: "keep_extras" };
    slide.elements.push(
      {
        id: "free_footnote",
        type: "text",
        x: 120,
        y: 960,
        w: 900,
        h: 70,
        rotation: 0,
        doc: richDocFromText("Source: Annual report 2025"),
        style: { font: "body", size: 24, color: "muted", align: "left", valign: "top", lineHeight: 1.2, bold: false, italic: true },
        fill: null,
        autoHeight: true,
      },
      {
        id: "existing_tbl",
        type: "table",
        x: 1100,
        y: 620,
        w: 700,
        h: 240,
        rotation: 0,
        rows: [{ cells: [{ text: "Quarter" }, { text: "Revenue" }] }, { cells: [{ text: "Q1" }, { text: "$10M" }] }],
        cols: [1, 1],
        header: true,
        style: { size: 24, color: "text", border: "line", headerFill: "surface", font: "body" },
      },
    );
    const deck = normalizeDeck({ format: DECK_FORMAT, theme: { id: "simple", mode: "light" }, slides: [slide] });
    const longBody = Array.from({ length: 14 }, (_, i) => `- Key milestone #${i + 1} with extended details for Q${(i % 4) + 1}`).join("\n");

    const updated = applySlidesEdits(deck, [
      op({ op: "update_slide", slideId: "keep_extras", body: longBody }),
    ]);
    const primary = updated.deck.slides[0];
    expect(primary.elements.some((el) => el.id === "free_footnote" && el.type === "text" && richDocText(el.doc) === "Source: Annual report 2025")).toBe(true);
    expect(primary.elements.some((el) => el.id === "existing_tbl" && el.type === "table")).toBe(true);
    // Rebuilt body narrows to avoid overlapping the preserved right-half table at x=1100 and fits without overflow.
    const rebuiltBody = primary.elements.find((el) => el.type === "text" && el.role === "body");
    expect(rebuiltBody && rebuiltBody.x + rebuiltBody.w <= 1052).toBe(true);
    if (rebuiltBody?.type === "text") {
      const m = measureRichDocHeight(rebuiltBody.doc, rebuiltBody);
      expect(m.requiredHeight).toBeLessThanOrEqual(m.innerHeight);
    }

    // When a preserved table is on the left/bottom half, rebuilt body stops above the table and overflows cleanly to continuation slides.
    const bottomTableSlide = JSON.parse(JSON.stringify(slide)) as Slide;
    const bottomTbl = bottomTableSlide.elements.find((el) => el.id === "existing_tbl");
    if (bottomTbl?.type === "table") { bottomTbl.x = 120; bottomTbl.y = 660; bottomTbl.w = 1600; }
    const bottomUpdated = applySlidesEdits(
      normalizeDeck({ format: DECK_FORMAT, theme: { id: "simple", mode: "light" }, slides: [bottomTableSlide] }),
      [op({ op: "update_slide", slideId: "keep_extras", body: longBody })],
    );
    const bottomBody = bottomUpdated.deck.slides[0].elements.find((el) => el.type === "text" && el.role === "body");
    expect(bottomBody && bottomBody.y + bottomBody.h <= 636).toBe(true);
    if (bottomBody?.type === "text") {
      const m = measureRichDocHeight(bottomBody.doc, bottomBody);
      expect(m.requiredHeight).toBeLessThanOrEqual(m.innerHeight);
    }
    const allBottomText = bottomUpdated.deck.slides
      .flatMap((s) => s.elements)
      .filter((el): el is Extract<typeof el, { type: "text" }> => el.type === "text" && el.role !== "title")
      .map((el) => richDocText(el.doc))
      .join("\n");
    expect(allBottomText).toContain("Key milestone #14");

    // delete_element lets the AI explicitly drop a table and replace it with bullets in one proposal.
    const tableToBullets = applySlidesEdits(deck, [
      op({ op: "delete_element", slideId: "keep_extras", elementId: "existing_tbl" }),
      op({ op: "update_slide", slideId: "keep_extras", body: "- Q1 revenue reached $10M" }),
    ]);
    expect(tableToBullets.deck.slides[0].elements.some((el) => el.type === "table")).toBe(false);
    expect(tableToBullets.deck.slides[0].elements.some((el) => el.id === "free_footnote")).toBe(true);
    expect(tableToBullets.changes[0]).toMatchObject({ op: "delete" });
    expect("after" in tableToBullets.changes[0]).toBe(false);

    // Title + top table slide (created via add_slide with table-only body): rewriting with bullets (short or long)
    // places the new body cleanly below the kept table with zero overlap.
    const tableOnlyCreated = applySlidesEdits(deck, [
      op({
        op: "add_slide",
        title: "Metrics",
        body: "| Metric | Value |\n| --- | --- |\n| P99 | 12ms |",
        ref: "tbl_slide",
      }),
    ]);
    const tblSlideId = tableOnlyCreated.deck.slides[1].id;
    const origTbl = tableOnlyCreated.deck.slides[1].elements.find((el) => el.type === "table")!;
    for (const bulletBody of [
      "- Point 1\n- Point 2\n- Point 3",
      Array.from({ length: 14 }, (_, i) => `- Bullet ${i + 1}`).join("\n"),
    ]) {
      const rewritten = applySlidesEdits(tableOnlyCreated.deck, [
        op({ op: "update_slide", slideId: tblSlideId, body: bulletBody }),
      ]);
      const slideAfter = rewritten.deck.slides[1];
      const keptTbl = slideAfter.elements.find((el) => el.id === origTbl.id)!;
      const bodyEls = slideAfter.elements.filter((el) => el.type === "text" && el.role !== "title");
      expect(keptTbl).toBeDefined();
      expect(bodyEls.length).toBeGreaterThan(0);
      for (const b of bodyEls) {
        const overlaps = b.x < keptTbl.x + keptTbl.w && b.x + b.w > keptTbl.x && b.y < keptTbl.y + keptTbl.h && b.y + b.h > keptTbl.y;
        expect(overlaps).toBe(false);
      }
    }

    // Title + 6-row table rewritten with 8 bullets: slide 1 body fits strictly inside its box below the table
    // with zero overlap, and remaining bullets continue onto a continuation slide.
    const sixRowMd = [
      "| Metric | Value |",
      "| --- | --- |",
      ...Array.from({ length: 6 }, (_, i) => `| Row ${i + 1} | ${i + 1}0ms |`),
    ].join("\n");
    const sixRowCreated = applySlidesEdits(deck, [
      op({ op: "add_slide", title: "Latency Breakdown", body: sixRowMd, ref: "six_row" }),
    ]);
    const sixRowId = sixRowCreated.deck.slides[1].id;
    const sixRowOrigTbl = sixRowCreated.deck.slides[1].elements.find((el) => el.type === "table")!;
    const eightBullets = Array.from({ length: 8 }, (_, i) => `- Finding #${i + 1} observed across regions`).join("\n");
    const sixRowRewritten = applySlidesEdits(sixRowCreated.deck, [
      op({ op: "update_slide", slideId: sixRowId, body: eightBullets }),
    ]);
    const sixRowSlide = sixRowRewritten.deck.slides[1];
    const sixRowKeptTbl = sixRowSlide.elements.find((el) => el.id === sixRowOrigTbl.id)!;
    const sixRowBody = sixRowSlide.elements.find((el) => el.type === "text" && el.role !== "title")!;
    expect(sixRowBody?.type).toBe("text");
    if (sixRowBody?.type === "text") {
      const overlaps = sixRowBody.x < sixRowKeptTbl.x + sixRowKeptTbl.w
        && sixRowBody.x + sixRowBody.w > sixRowKeptTbl.x
        && sixRowBody.y < sixRowKeptTbl.y + sixRowKeptTbl.h
        && sixRowBody.y + sixRowBody.h > sixRowKeptTbl.y;
      expect(overlaps).toBe(false);
      expect(sixRowBody.y + sixRowBody.h).toBeLessThanOrEqual(1080);
      const m = measureRichDocHeight(sixRowBody.doc, sixRowBody);
      expect(m.requiredHeight).toBeLessThanOrEqual(m.innerHeight);
    }
    expect(sixRowRewritten.deck.slides.length).toBeGreaterThan(2);
    const sixRowCombined = sixRowRewritten.deck.slides
      .slice(1)
      .flatMap((s) => s.elements)
      .filter((el): el is Extract<typeof el, { type: "text" }> => el.type === "text" && el.role !== "title")
      .map((el) => richDocText(el.doc))
      .join("\n");
    for (let i = 1; i <= 8; i++) {
      expect(sixRowCombined).toContain(`Finding #${i}`);
    }

    // When even a single unbreakable block cannot fit in the remaining space below a tall table, reject clearly.
    const tallBlockSlide = JSON.parse(JSON.stringify(sixRowCreated.deck.slides[1])) as Slide;
    const tallTbl = tallBlockSlide.elements.find((el) => el.type === "table");
    if (tallTbl?.type === "table") { tallTbl.y = 220; tallTbl.h = 640; }
    expect(() => applySlidesEdits(
      normalizeDeck({ format: DECK_FORMAT, theme: { id: "simple", mode: "light" }, slides: [tallBlockSlide] }),
      [op({ op: "update_slide", slideId: tallBlockSlide.id, body: "```ts\n" + Array.from({ length: 12 }, (_, i) => `const line${i} = ${i};`).join("\n") + "\n```" })],
    )).toThrow(/delete_element/);

    // When a kept table fills the entire content area leaving no room above or below, reject clearly.
    const fullTableSlide = JSON.parse(JSON.stringify(slide)) as Slide;
    const fullTbl = fullTableSlide.elements.find((el) => el.id === "existing_tbl");
    if (fullTbl?.type === "table") { fullTbl.x = 120; fullTbl.y = 240; fullTbl.w = 1680; fullTbl.h = 780; }
    expect(() => applySlidesEdits(
      normalizeDeck({ format: DECK_FORMAT, theme: { id: "simple", mode: "light" }, slides: [fullTableSlide] }),
      [op({ op: "update_slide", slideId: "keep_extras", body: "- Bullet 1\n- Bullet 2" })],
    )).toThrow(/delete_element/);

    // When the new body explicitly provides a replacement table, replace the old table while still keeping free text.
    const replacedTable = applySlidesEdits(deck, [
      op({ op: "update_slide", slideId: "keep_extras", body: "| Quarter | ARR |\n| --- | --- |\n| Q2 | $12M |" }),
    ]);
    const replacedPrimary = replacedTable.deck.slides[0];
    expect(replacedPrimary.elements.some((el) => el.id === "free_footnote")).toBe(true);
    expect(replacedPrimary.elements.some((el) => el.id === "existing_tbl")).toBe(false);
    expect(replacedPrimary.elements.some((el) => el.type === "table" && el.rows[1]?.cells[1]?.text === "$12M")).toBe(true);
  });
});
