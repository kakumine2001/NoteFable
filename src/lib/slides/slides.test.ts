import { describe, expect, it } from "vitest";
import { validateCanvasData, extractCanvasSegments } from "@/lib/canvas-document";
import { alignElements, distributeElements, lineEndpoints, lineFromEndpoints, resizeFrame, rotatedBounds, rotationFor, snapBox } from "./geometry";
import { applyLayout, createSlide, LAYOUTS } from "./layouts";
import { deckImageSources, normalizeDeck, slideRows, slideTransitionClass, type Deck, type Slide, type SlideElement, type TextElement } from "./model";
import { addSlide, cloneElements, deleteSlides, duplicateSlides, groupElements, moveSlides, moveSlidesToRow, parseClipboard, clipboardPayload, reorderElements, setHidden, setTransition } from "./ops";
import { normalizeRichDoc, richDocFromText, richDocLatex, richDocText, safeHref } from "./rich-text";
import { resolveColor, resolveTheme } from "./themes";
import { publicDeck } from "./public-deck";

const FILE = "/api/pages/files?key=note-files%2Fuser1%2F0e4b3f7c-1111-4c3a-9b1d-2f6f1f2a3b4c.png&name=a.png";
const text = (element: SlideElement | undefined) => (element && element.type === "text" ? richDocText(element.doc) : null);
const slide = (id: string, extra: Partial<Slide> = {}): Slide => ({ id, layout: "blank", elements: [], ...extra });
const deck = (slides: Slide[]): Deck => ({ format: 1, theme: { id: "simple", mode: "light" }, slides });

describe("deck normalization", () => {
  it("keeps valid content and repairs or drops the rest", () => {
    const result = normalizeDeck({
      theme: { id: "editorial", mode: "dark" },
      slides: [
        { id: "a", layout: "bullets", notes: "hi", section: "Intro", elements: [
          { id: "t", type: "text", x: 10, y: 20, w: 300, h: 100, doc: richDocFromText("Hello"), style: { color: "url(https://evil)", size: 1e9 } },
          { id: "i", type: "image", x: 0, y: 0, w: 10, h: 10, src: "https://tracker.example/pixel.png" },
          { id: "i2", type: "image", x: 0, y: 0, w: 10, h: 10, src: FILE },
          { id: "bad", type: "script" },
        ] },
        { id: "a", layout: "nope", elements: [{ id: "t", type: "line", x: 0, y: 0, w: 5, h: 5, rotation: 45 }] },
        "junk",
      ],
    });
    expect(result.theme).toEqual({ id: "editorial", mode: "dark" });
    expect(result.slides).toHaveLength(2);
    const [first, second] = result.slides;
    expect(first.notes).toBe("hi");
    expect(first.section).toBe("Intro");
    expect(first.elements.map((element) => element.id)).toEqual(["t", "i", "i2"]);
    const textElement = first.elements[0] as TextElement;
    expect(textElement.style.color).toBe("text");
    expect(textElement.style.size).toBe(800);
    expect((first.elements[1] as { src: string }).src).toBe("");
    expect((first.elements[2] as { src: string }).src).toBe(FILE);
    // Duplicate ids are replaced, unknown layouts become blank, lines never rotate.
    expect(second.id).not.toBe("a");
    expect(second.layout).toBe("blank");
    expect(second.elements[0].id).not.toBe("t");
    expect(second.elements[0].rotation).toBe(0);
    expect(deckImageSources(result)).toEqual([FILE]);
  });

  it("only allows safe links, known marks and math in rich text", () => {
    const doc = normalizeRichDoc({ type: "doc", content: [
      { type: "paragraph", content: [
        { type: "text", text: "x", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }, { type: "strong" }, { type: "blink" }] },
        { type: "math_inline", attrs: { latex: "a^2" } },
      ] },
      { type: "bullet_list", content: [{ type: "list_item", content: [{ type: "bullet_list", content: [] }] }] },
      { type: "math_block", attrs: { latex: "\\int x" } },
    ] });
    expect(doc.content[0]).toEqual({ type: "paragraph", attrs: { align: null }, content: [
      { type: "text", text: "x", marks: [{ type: "strong" }] }, { type: "math_inline", attrs: { latex: "a^2" } },
    ] });
    expect(doc.content[1]).toEqual({ type: "bullet_list", content: [{ type: "list_item", content: [{ type: "paragraph", attrs: { align: null } }] }] });
    expect(safeHref("https://example.com")).toBe("https://example.com");
    expect(safeHref("data:text/html,x")).toBeNull();
    expect([...richDocLatex(doc)]).toEqual(["i:a^2", "d:\\int x"]);
    expect(richDocText(normalizeRichDoc(null))).toBe("");
  });

  it("passes the server's canvas validation and yields searchable text including notes", () => {
    const value = deck([{ ...createSlide("title", { title: "Quarterly review", subtitle: "Numbers" }), notes: "Say hello" }]);
    expect(() => validateCanvasData("slides", value)).not.toThrow();
    const [segment] = extractCanvasSegments("slides", value);
    expect(segment.text).toContain("Quarterly review");
    expect(segment.text).toContain("Numbers");
    expect(segment.text).toContain("Say hello");
  });
});

describe("rows (sections)", () => {
  it("splits slides into rows at section markers and keeps titles on reorder and delete", () => {
    const slides = [slide("a", { section: "One" }), slide("b"), slide("c", { section: "Two" }), slide("d")];
    expect(slideRows(slides).map((row) => [row.title, row.slides.map((s) => s.id)])).toEqual([["One", ["a", "b"]], ["Two", ["c", "d"]]]);
    // Deleting a row's first slide hands the title to the next one.
    const removed = deleteSlides(deck(slides), new Set(["c"]));
    expect(removed.slides.map((s) => [s.id, s.section])).toEqual([["a", "One"], ["b", undefined], ["d", "Two"]]);
    // Moving the first slide of a row away keeps the row title on the row.
    const moved = moveSlides(deck(slides), new Set(["a"]), 4);
    expect(slideRows(moved.slides).map((row) => [row.title, row.slides.map((s) => s.id)])).toEqual([["One", ["b"]], ["Two", ["c", "d", "a"]]]);
    const toRow = moveSlidesToRow(deck(slides), new Set(["d"]), 0, 1);
    expect(slideRows(toRow.slides).map((row) => row.slides.map((s) => s.id))).toEqual([["a", "d", "b"], ["c"]]);
    const newRow = moveSlidesToRow(deck(slides), new Set(["b"]), 2, 0);
    expect(slideRows(newRow.slides).map((row) => row.slides.map((s) => s.id))).toEqual([["a"], ["c", "d"], ["b"]]);
  });

  it("adds, duplicates and hides slides", () => {
    const base = deck([slide("a"), slide("b")]);
    const { deck: added, slideId } = addSlide(base, 1, "bullets");
    expect(added.slides.map((s) => s.id)).toEqual(["a", slideId, "b"]);
    const { deck: copied, created } = duplicateSlides(base, new Set(["a"]));
    expect(copied.slides.map((s) => s.id)).toEqual(["a", created[0], "b"]);
    expect(setHidden(base, new Set(["b"]), true).slides[1].hidden).toBe(true);
    expect(setHidden(setHidden(base, new Set(["b"]), true), new Set(["b"]), false).slides[1]).not.toHaveProperty("hidden");
  });
});

describe("layouts", () => {
  it("has eight layouts", () => {
    expect(LAYOUTS.map((layout) => layout.id)).toEqual(["title", "section", "bullets", "twoColumn", "imageText", "quote", "fullImage", "blank"]);
  });

  it("keeps content when switching layouts", () => {
    const start = createSlide("twoColumn", { title: "Plan", body: "Left", body2: "Right" });
    const bullets = applyLayout(start, "bullets");
    expect(text(bullets.elements.find((element) => element.role === "title"))).toBe("Plan");
    expect(text(bullets.elements.find((element) => element.role === "body"))).toBe("Left");
    // The second column has no place in "bullets": it stays as a free element instead of being lost.
    const free = bullets.elements.find((element) => !element.role);
    expect(text(free)).toBe("Right");
    const quote = applyLayout(bullets, "quote");
    expect(text(quote.elements.find((element) => element.role === "quote"))).toBe("Left");
    // Blank keeps everything with content and drops empty placeholders.
    const blank = applyLayout(createSlide("title", { title: "Only title" }), "blank");
    expect(blank.elements.map(text)).toEqual(["Only title"]);
    expect(blank.elements[0].role).toBeUndefined();
  });
});

describe("geometry", () => {
  const box = (id: string, x: number, y: number, w = 100, h = 100, group?: string): SlideElement => ({
    id, type: "shape", x, y, w, h, rotation: 0, shape: "rect", fill: "accent", stroke: null, strokeWidth: 0, dash: "solid",
    doc: richDocFromText(""), style: { font: "body", size: 40, color: "text", align: "center", valign: "middle", lineHeight: 1.2, bold: false, italic: false },
    ...(group ? { group } : {}),
  });

  it("resizes from a handle keeping the opposite side fixed, also when rotated", () => {
    expect(resizeFrame({ x: 100, y: 100, w: 200, h: 100, rotation: 0 }, "se", 50, 20, false)).toEqual({ x: 100, y: 100, w: 250, h: 120, rotation: 0 });
    expect(resizeFrame({ x: 100, y: 100, w: 200, h: 100, rotation: 0 }, "w", 50, 0, false)).toEqual({ x: 150, y: 100, w: 150, h: 100, rotation: 0 });
    expect(resizeFrame({ x: 0, y: 0, w: 200, h: 100, rotation: 0 }, "e", 100, 0, true)).toMatchObject({ w: 300, h: 150 });
    // Rotated 90°: dragging the east handle down (screen y) grows the width; the west edge stays put.
    const rotated = resizeFrame({ x: 0, y: 0, w: 200, h: 100, rotation: 90 }, "e", 0, 40, false);
    expect(rotated.w).toBe(240);
    expect(rotated.x + rotated.w / 2).toBeCloseTo(100);
    expect(rotated.y + rotated.h / 2).toBeCloseTo(70);
  });

  it("computes rotated bounds and rotation angles", () => {
    const bounds = rotatedBounds({ x: 0, y: 0, w: 200, h: 100, rotation: 90 });
    expect(bounds.w).toBeCloseTo(100);
    expect(bounds.h).toBeCloseTo(200);
    expect(rotationFor({ x: 0, y: 0, w: 100, h: 100, rotation: 0 }, 150, 50, false)).toBe(90);
    expect(rotationFor({ x: 0, y: 0, w: 100, h: 100, rotation: 0 }, 150, 40, true)).toBe(90);
  });

  it("snaps to the slide center and other elements", () => {
    const result = snapBox({ x: 905, y: 300, w: 100, h: 50 }, [{ x: 0, y: 296, w: 50, h: 50 }], 8);
    expect(result.dx).toBe(5);
    expect(result.dy).toBe(-4);
    expect(result.guides.map((guide) => guide.axis).sort()).toEqual(["x", "y"]);
  });

  it("aligns and distributes, treating groups as one unit", () => {
    const elements = [box("a", 0, 0), box("b", 300, 50), box("c", 1000, 80, 100, 100, "g"), box("d", 1100, 200, 50, 50, "g")];
    const aligned = alignElements(elements, new Set(["a", "b", "c", "d"]), "top");
    expect(aligned.map((element) => element.y)).toEqual([0, 0, 0, 120]);
    const spread = distributeElements([box("a", 0, 0), box("b", 150, 0), box("c", 1000, 0)], new Set(["a", "b", "c"]), "x");
    expect(spread.map((element) => element.x)).toEqual([0, 500, 1000]);
    // A single unit aligns to the slide.
    expect(alignElements([box("a", 10, 10)], new Set(["a"]), "hcenter")[0].x).toBe(910);
  });

  it("converts between line endpoints and boxes", () => {
    const line = lineFromEndpoints(300, 100, 100, 400);
    expect(line).toEqual({ x: 100, y: 100, w: 200, h: 300, flipH: true, flipV: false });
    expect(lineEndpoints(line)).toEqual({ x1: 300, y1: 100, x2: 100, y2: 400 });
  });

  it("reorders, groups and clones elements", () => {
    const base: Slide = { id: "s", layout: "blank", elements: [box("a", 0, 0), box("b", 0, 0), box("c", 0, 0)] };
    expect(reorderElements(base, new Set(["a"]), "front").elements.map((e) => e.id)).toEqual(["b", "c", "a"]);
    expect(reorderElements(base, new Set(["c"]), "backward").elements.map((e) => e.id)).toEqual(["a", "c", "b"]);
    const { slide: grouped, group } = groupElements(base, new Set(["a", "c"]));
    expect(grouped.elements.map((e) => [e.id, e.group])).toEqual([["b", undefined], ["a", group], ["c", group]]);
    const clones = cloneElements(grouped.elements.slice(1), 20);
    expect(clones[0].group).toBe(clones[1].group);
    expect(clones[0].group).not.toBe(group);
    expect(clones[0].x).toBe(20);
  });

  it("round-trips elements through the clipboard with new ids", () => {
    const parsed = parseClipboard(clipboardPayload({ elements: [box("a", 5, 5)] }));
    expect(parsed?.elements).toHaveLength(1);
    expect(parsed?.elements[0].id).not.toBe("a");
    expect(parseClipboard("plain text")).toBeNull();
  });

  it("gives pasted elements a new group, so they are not tied to the originals", () => {
    const base: Slide = { id: "s", layout: "blank", elements: [box("a", 0, 0), box("b", 10, 10)] };
    const { slide: grouped, group } = groupElements(base, new Set(["a", "b"]));
    const parsed = parseClipboard(clipboardPayload({ elements: grouped.elements }));
    expect(parsed?.elements.map((element) => element.group)).toEqual([parsed?.elements[0].group, parsed?.elements[0].group]);
    expect(parsed?.elements[0].group).toBeTruthy();
    expect(parsed?.elements[0].group).not.toBe(group);
  });
});

describe("themes", () => {
  it("resolves color tokens per theme and mode, keeps fixed colors", () => {
    const light = resolveTheme({ id: "simple", mode: "light" });
    const dark = resolveTheme({ id: "simple", mode: "dark" });
    expect(resolveColor("background", light)).toBe("#ffffff");
    expect(resolveColor("background", dark)).not.toBe("#ffffff");
    expect(resolveColor("#123456", dark)).toBe("#123456");
    expect(resolveTheme({ id: "missing", mode: "light" }).theme.id).toBe("simple");
  });
});

import { slidesContextText, slidesSelectionIds } from "@/lib/slides/ai-context";
import { generateSlideImage } from "@/lib/slides/images";
import { captureSlideSelectionPng, MAX_SLIDE_SELECTION_SIDE, scaledSlideDimensions, slideSelectionCropRect } from "@/lib/slides/selection-capture";
import { UsageLimitError } from "@/lib/usage-plans";

describe("slides AI context and selection capture", () => {
  const sampleDeck: Deck = {
    format: 1,
    theme: { id: "simple", mode: "light" },
    slides: [
      {
        id: "s1",
        layout: "bullets",
        section: "Intro",
        notes: "Private speaker notes for slide 1",
        elements: [
          {
            id: "el1",
            type: "text",
            x: 100,
            y: 120,
            w: 400,
            h: 200,
            rotation: 0,
            doc: richDocFromText("Heading One"),
            style: { font: "heading", size: 48, color: "heading", align: "left", valign: "top", lineHeight: 1.2, bold: true, italic: false },
            fill: null,
            autoHeight: false,
          },
          {
            id: "el2",
            type: "whiteboard",
            x: 600,
            y: 200,
            w: 500,
            h: 300,
            rotation: 0,
            src: FILE,
            pageId: "wb_1",
            frameId: "fr_1",
            frameName: "Architecture",
          },
        ],
      },
    ],
  };

  it("omits speaker notes when only individual elements are selected unless includeNotes is true", () => {
    const elOnly = slidesContextText(sampleDeck, { slideIds: ["s1"], elementIds: ["el1"] });
    expect(elOnly).toContain("Heading One");
    expect(elOnly).not.toContain("Private speaker notes");

    const elWithNotes = slidesContextText(sampleDeck, { slideIds: ["s1"], elementIds: ["el1"] }, { includeNotes: true });
    expect(elWithNotes).toContain("Notes: Private speaker notes for slide 1");

    const wholeSlide = slidesContextText(sampleDeck, { slideIds: ["s1"], elementIds: [] });
    expect(wholeSlide).toContain("Heading One");
    expect(wholeSlide).toContain("[Whiteboard frame: Architecture]");
    expect(wholeSlide).toContain("Notes: Private speaker notes for slide 1");

    const localized = slidesContextText(sampleDeck, { slideIds: ["s1"], elementIds: [] }, {
      t: (key, vars) => ({
        "Slide {number}": `スライド ${vars?.number}`,
        "Section {number}": `セクション ${vars?.number}`,
        "Bullets": "箇条書き",
        "Whiteboard frame": "ホワイトボードの枠",
        "Speaker notes": "発表者ノート",
      }[key] ?? key),
    });
    expect(localized).toContain("スライド 1 (箇条書き, Intro):");
    expect(localized).toContain("[ホワイトボードの枠: Architecture]");
    expect(localized).toContain("発表者ノート: Private speaker notes for slide 1");

    const untitledSection = slidesContextText(
      { ...sampleDeck, slides: [{ ...sampleDeck.slides[0], section: undefined }] },
      { slideIds: ["s1"], elementIds: [] },
      {
        t: (key, vars) => ({
          "Slide {number}": `スライド ${vars?.number}`,
          "Section {number}": `セクション ${vars?.number}`,
          "Bullets": "箇条書き",
        }[key] ?? key),
      },
    );
    expect(untitledSection).toContain("スライド 1 (箇条書き, セクション 1):");
  });

  it("produces read_note-aligned selectionIds (element IDs when selected, otherwise slide IDs)", () => {
    expect(slidesSelectionIds(sampleDeck, { slideIds: ["s1"], elementIds: ["el1"] })).toEqual(["el1"]);
    expect(slidesSelectionIds(sampleDeck, { slideIds: ["s1"], elementIds: [] })).toEqual(["s1"]);
  });

  it("computes bounded crop rects for selected elements and caps long edge to 1568 px", () => {
    expect(slideSelectionCropRect(sampleDeck.slides[0], [])).toBeNull();
    expect(slideSelectionCropRect(sampleDeck.slides[0], ["el1"], 32)).toEqual({ x: 68, y: 88, w: 464, h: 264 });
    expect(scaledSlideDimensions(1920, 1080)).toEqual({ width: MAX_SLIDE_SELECTION_SIDE, height: 882 });
    expect(scaledSlideDimensions(464, 264)).toEqual({ width: 464, height: 264 });
  });

  it("returns null without rendering full slide when selected elements are off-slide, and settles cleanly on capture rejection or timeout", async () => {
    const offSlide: Slide = {
      id: "s_off",
      layout: "blank",
      elements: [
        { id: "off1", type: "text", x: 3000, y: 2000, w: 200, h: 100, rotation: 0, doc: richDocFromText("Off-slide"), style: { font: "body", size: 24, color: "text", align: "left", valign: "top", bold: false, italic: false, lineHeight: 1.2 }, fill: null, autoHeight: false },
      ],
    };
    let rendered = 0;
    let doneCount = 0;
    const theme = resolveTheme(sampleDeck.theme);
    const capture = {
      renderSlide: async () => { rendered += 1; return {} as HTMLElement; },
      renderNotesPage: async () => ({} as HTMLElement),
      done: () => { doneCount += 1; },
    };
    // Off-slide element selection must NOT fall back to rendering the whole slide.
    expect(await captureSlideSelectionPng(capture, offSlide, theme, ["off1"])).toBeNull();
    expect(rendered).toBe(0);

    // Rejected capture (e.g. editor unmounted while settling) resolves cleanly to null and runs done().
    const rejectedCapture = {
      renderSlide: async () => Promise.reject(new Error("Slide capture cancelled")),
      renderNotesPage: async () => ({} as HTMLElement),
      done: () => { doneCount += 1; },
    };
    expect(await captureSlideSelectionPng(rejectedCapture, sampleDeck.slides[0], theme, [])).toBeNull();
    expect(doneCount).toBe(1);

    // Hung capture settles via timeout and runs done().
    const hungCapture = {
      renderSlide: () => new Promise<HTMLElement>(() => {}),
      renderNotesPage: async () => ({} as HTMLElement),
      done: () => { doneCount += 1; },
    };
    expect(await captureSlideSelectionPng(hungCapture, sampleDeck.slides[0], theme, [], 25)).toBeNull();
    expect(doneCount).toBe(2);
  });

  it("throws UsageLimitError when /api/pages/images returns 429 usage_limit", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(
      JSON.stringify({ error: "You've used today's free image generations. Sign in for more, or try again tomorrow.", code: "usage_limit", tier: "guest", kind: "image" }),
      { status: 429, headers: { "Content-Type": "application/json" } },
    )) as typeof fetch;
    try {
      await expect(generateSlideImage("lighthouse", "1536x1024")).rejects.toSatisfy(
        (err: unknown) => err instanceof UsageLimitError && err.tier === "guest" && err.kind === "image",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("cross-review fixes", () => {
  it("keeps a slide in its own row when it is dropped onto itself", () => {
    const start = deck([slide("s1", { section: "Intro" }), slide("s2", { section: "Agenda" }), slide("s3")]);
    const moved = moveSlides(start, new Set(["s1"]), 0);
    expect(slideRows(moved.slides).map((row) => [row.title, row.slides.map((entry) => entry.id)])).toEqual([["Intro", ["s1"]], ["Agenda", ["s2", "s3"]]]);
  });

  it("pastes slides with their background and hidden flag", () => {
    const parsed = parseClipboard(clipboardPayload({ slides: [slide("s1", { hidden: true, background: "#112233" })] }));
    expect(parsed?.slides[0]).toMatchObject({ hidden: true, background: "#112233" });
    expect(parsed?.slides[0].id).not.toBe("s1");
  });

  it("drops text that is empty once NUL characters are removed", () => {
    const doc = normalizeRichDoc({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "\u0000" }, { type: "text", text: "ok" }] }] });
    expect(doc.content[0]).toEqual({ type: "paragraph", attrs: { align: null }, content: [{ type: "text", text: "ok" }] });
  });

  it("keeps section names and private whiteboard ids out of the public deck", () => {
    const board = { id: "w1", type: "whiteboard", x: 0, y: 0, w: 100, h: 100, rotation: 0, src: FILE, pageId: "privatePage", frameId: "frame-1", frameName: "Sketch" };
    const result = publicDeck({ slides: [{ id: "s1", layout: "blank", section: "Secret plan", elements: [board] }] });
    expect(result.slides[0].section).toBeUndefined();
    expect(result.slides[0].elements[0]).toMatchObject({ type: "whiteboard", pageId: "", frameId: "", frameName: "Sketch" });
  });

  it("normalizes slide transitions backward-compatibly, applies them via setTransition, and preserves them across clipboard & publicDeck", () => {
    const normalized = normalizeDeck({
      format: 1,
      theme: { id: "simple", mode: "light" },
      slides: [
        { id: "s1", layout: "blank", elements: [] },
        { id: "s2", layout: "blank", transition: "none", elements: [] },
        { id: "s3", layout: "blank", transition: "fade", elements: [] },
        { id: "s4", layout: "blank", transition: "slide", elements: [] },
        { id: "s5", layout: "blank", transition: "spin", elements: [] },
      ],
    });
    expect("transition" in normalized.slides[0]).toBe(false);
    expect("transition" in normalized.slides[1]).toBe(false);
    expect(normalized.slides[2].transition).toBe("fade");
    expect(normalized.slides[3].transition).toBe("slide");
    expect("transition" in normalized.slides[4]).toBe(false);

    const updated = setTransition(normalized, new Set(["s1", "s3"]), "slide");
    expect(updated.slides[0].transition).toBe("slide");
    expect(updated.slides[2].transition).toBe("slide");
    // すでに同じ値なら参照を変えない（無駄な取り消し履歴・保存を防ぐ）。
    expect(setTransition(updated, new Set(["s1", "s3"]), "slide")).toBe(updated);
    const cleared = setTransition(updated, new Set(["s1"]), "none");
    expect("transition" in cleared.slides[0]).toBe(false);
    expect(setTransition(cleared, new Set(["s1"]), "none")).toBe(cleared);

    const pasted = parseClipboard(clipboardPayload({ slides: [slide("s3", { transition: "fade" })] }));
    expect(pasted?.slides[0].transition).toBe("fade");

    const pub = publicDeck(updated);
    expect(pub.slides[0].transition).toBe("slide");
    expect(pub.slides[3].transition).toBe("slide");
  });

  it("computes slideTransitionClass respecting direction and prefers-reduced-motion", () => {
    expect(slideTransitionClass(undefined, "forward", false)).toBe("");
    expect(slideTransitionClass("none", "forward", false)).toBe("");
    expect(slideTransitionClass("fade", "forward", false)).toBe("slide-transition-fade");
    expect(slideTransitionClass("fade", "backward", false)).toBe("slide-transition-fade");
    expect(slideTransitionClass("slide", "forward", false)).toBe("slide-transition-slide-forward");
    expect(slideTransitionClass("slide", "backward", false)).toBe("slide-transition-slide-backward");
    expect(slideTransitionClass("fade", "forward", true)).toBe("");
    expect(slideTransitionClass("slide", "forward", true)).toBe("");
  });

  it("normalizes optional code_block language while omitting empty or plain defaults", () => {
    const doc = normalizeRichDoc({
      type: "doc",
      content: [
        { type: "code_block", attrs: { language: "TypeScript" }, content: [{ type: "text", text: "let a = 1;" }] },
        { type: "code_block", attrs: { language: "text" }, content: [{ type: "text", text: "plain" }] },
        { type: "code_block", content: [{ type: "text", text: "raw" }] },
      ],
    });
    expect(doc.content[0]).toEqual({ type: "code_block", attrs: { language: "TypeScript" }, content: [{ type: "text", text: "let a = 1;" }] });
    expect(doc.content[1]).toEqual({ type: "code_block", content: [{ type: "text", text: "plain" }] });
    expect(doc.content[2]).toEqual({ type: "code_block", content: [{ type: "text", text: "raw" }] });
  });
});
