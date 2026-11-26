import { describe, expect, it } from "vitest";
import { extractCanvasSegments, MAX_SLIDE_NOTES, validateCanvasData } from "@/lib/canvas-document";
import { applyGeneratedSlideImage, buildAiDeck, clearPendingSlideImages, pendingSlideImageTasks } from "./ai-build";
import type { Slide, SlideElement } from "./model";

const theme = { id: "tech", mode: "dark" as const };

function textOf(value: unknown): string {
  return extractCanvasSegments("slides", value).map((segment) => segment.text).join(" ");
}
const types = (slide: Slide) => slide.elements.map((element) => element.type);
const find = <T extends SlideElement["type"]>(slide: Slide, type: T) => slide.elements.filter((element): element is Extract<SlideElement, { type: T }> => element.type === type);

describe("buildAiDeck", () => {
  it("makes a cover and one slide per block, with editable lists, code, math, tables and notes", () => {
    const { deck, truncatedSlides } = buildAiDeck({
      title: "排序算法",
      theme,
      slides: [
        { title: "快速排序", body: "- 分治\n- 平均 \\(O(n \\log n)\\)\n\n```python\ndef sort(a):\n    return a\n```", notes: "先讲分治。" },
        { title: "对比", body: "| 算法 | 复杂度 |\n| --- | --- |\n| 快排 | $O(n \\log n)$ |\n\n$$\nT(n) = 2T(n/2) + n\n$$", notes: "" },
      ],
    });
    expect(truncatedSlides).toBe(0);
    expect(deck.theme).toEqual(theme);
    expect(deck.slides).toHaveLength(3);
    const [cover, first, second] = deck.slides;
    expect(cover.layout).toBe("title");
    expect(cover.elements.map((element) => element.role)).toEqual(["title"]);
    expect(first.notes).toBe("先讲分治。");
    expect(second.notes).toBeUndefined();
    // 章の区切りは付けない（全部の枚が 1 行にまとまる）。
    expect(deck.slides.every((slide) => slide.section === undefined)).toBe(true);
    const doc = JSON.stringify(first.elements);
    expect(doc).toContain('"bullet_list"');
    expect(doc).toContain('"code_block"');
    expect(doc).toContain('"math_inline","attrs":{"latex":"O(n \\\\log n)"}');
    expect(types(second)).toContain("table");
    expect(find(second, "table")[0].rows[1].cells.map((cell) => cell.text)).toEqual(["快排", "$O(n \\log n)$"]);
    expect(JSON.stringify(second.elements)).toContain('"math_block"');
    expect(textOf(deck)).toContain("快速排序");
    // 保存の検証を通る。
    expect(() => validateCanvasData("slides", deck)).not.toThrow();
  });

  it("drops images, rules and tables of contents, and keeps level-1 headings smaller than the slide title", () => {
    const { deck } = buildAiDeck({
      title: "T",
      theme,
      slides: [{ title: "S", body: "# Big\n\n![x](/api/pages/files?key=note-files/u/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png)\n\n---\n\n[TOC]\n\nafter", notes: "" }],
    });
    expect(deck.slides).toHaveLength(2);
    const slide = deck.slides[1];
    expect(types(slide)).not.toContain("image");
    expect(types(slide)).not.toContain("line");
    expect(textOf({ slides: [slide] })).not.toContain("/api/pages/files");
    expect(JSON.stringify(slide.elements)).not.toContain("example.com");
    const sizes = JSON.stringify(slide.elements).match(/"type":"size","attrs":\{"size":\d+\}/g);
    expect(sizes).toEqual(['"type":"size","attrs":{"size":42}']);
    expect(textOf(deck)).toContain("after");
  });

  it("drops external Markdown images, skips empty extra slides, and allows literal file-URL text in code or notes", () => {
    const { deck } = buildAiDeck({
      title: "API",
      theme,
      slides: [
        { title: "Endpoints", body: "![chart](https://example.com/chart.png)\n\nUse `/api/pages/files?key=demo`.", notes: "/api/pages/files?key=example" },
        { title: "", body: "- \n> ", notes: "" },
        { title: "▸", body: "", notes: "" },
      ],
    });
    expect(deck.slides).toHaveLength(3);
    expect(JSON.stringify(deck.slides[1].elements)).not.toContain("https://example.com/chart.png");
    expect(textOf({ slides: [deck.slides[1]] })).toContain("/api/pages/files?key=demo");
    expect(textOf({ slides: [deck.slides[2]] })).toContain("▸");
    expect(textOf({ slides: [deck.slides[2]] })).not.toContain("Untitled");
    expect(() => validateCanvasData("slides", deck)).not.toThrow();
  });

  it("continues long slides and puts the speaker notes on the first of them only", () => {
    const body = Array.from({ length: 60 }, (_, index) => `- point number ${index}`).join("\n");
    const { deck } = buildAiDeck({ title: "T", theme, slides: [{ title: "Long", body, notes: "n".repeat(MAX_SLIDE_NOTES + 10) }, { title: "Next", body: "x", notes: "m" }] });
    expect(deck.slides.length).toBeGreaterThan(3);
    expect(textOf({ slides: [deck.slides[2]] })).toContain("Long (2)");
    expect(deck.slides[1].notes).toHaveLength(MAX_SLIDE_NOTES);
    expect(deck.slides[2].notes).toBeUndefined();
    expect(deck.slides.at(-1)!.notes).toBe("m");
    expect(() => validateCanvasData("slides", deck)).not.toThrow();
    expect(new Set(deck.slides.map((slide) => slide.id)).size).toBe(deck.slides.length);
  });

  it("keeps a slide that has only a title and removes characters that cannot be stored", () => {
    const { deck } = buildAiDeck({ title: "a\u0000b", theme, slides: [{ title: "Only title", body: "", notes: "" }, { title: "S", body: "bad \uD800 text\u0000", notes: "x\u0000" }] });
    expect(deck.slides).toHaveLength(3);
    expect(textOf(deck)).toContain("ab");
    expect(textOf(deck)).toContain("Only title");
    expect(() => validateCanvasData("slides", deck)).not.toThrow();
  });

  it("places pending image placeholders on imageText slides, applies generated images without overwriting filled slots, and clears pending prompts", () => {
    const longBody = Array.from({ length: 45 }, (_, index) => `- bullet ${index}`).join("\n");
    const { deck } = buildAiDeck({
      title: "Botany",
      theme,
      slides: [
        { title: "Chloroplast", body: longBody, notes: "Speak clearly.", imagePrompt: "Clean flat illustration of a green leaf cell" },
        { title: "Summary", body: "- Done", notes: "" },
      ],
    });
    expect(() => validateCanvasData("slides", deck)).not.toThrow();
    // First content slide uses imageText with a single placeholder; continuation slides do not duplicate the image placeholder.
    expect(deck.slides[1].layout).toBe("imageText");
    const placeholder = find(deck.slides[1], "image")[0];
    expect(placeholder).toBeDefined();
    const tasks = pendingSlideImageTasks(deck);
    expect(tasks).toEqual([{
      slideId: deck.slides[1].id,
      elementId: placeholder.id,
      slideTitle: "Chloroplast",
      prompt: "Clean flat illustration of a green leaf cell",
    }]);
    expect(deck.slides.slice(2).every((s) => find(s, "image").length === 0)).toBe(true);

    // Apply generated image sets src + generated.prompt and removes pendingImagePrompt.
    const url = "/api/pages/files?key=note-files%2Fu1%2F00000000-0000-4000-8000-000000000000.png&name=leaf.png";
    const applied = applyGeneratedSlideImage(deck, {
      slideId: deck.slides[1].id,
      elementId: placeholder.id,
      url,
      name: "leaf.png",
      prompt: "Clean flat illustration of a green leaf cell",
    });
    expect(applied.applied).toBe(true);
    expect(pendingSlideImageTasks(applied.deck)).toEqual([]);
    const imageEl = find(applied.deck.slides[1], "image")[0];
    expect(imageEl).toMatchObject({ src: url, generated: { prompt: "Clean flat illustration of a green leaf cell" } });
    expect(imageEl.pendingImagePrompt).toBeUndefined();

    // Never overwrites a slide that already received an image.
    const second = applyGeneratedSlideImage(applied.deck, {
      slideId: deck.slides[1].id,
      elementId: placeholder.id,
      url: "/api/pages/files?key=note-files%2Fu1%2F11111111-1111-4111-8111-111111111111.png&name=other.png",
      prompt: "Other",
    });
    expect(second.applied).toBe(false);
    expect(find(second.deck.slides[1], "image")[0].src).toBe(url);

    // Dismissing clears pendingImagePrompt while preserving the slide itself.
    const cleared = clearPendingSlideImages(deck);
    expect(cleared).not.toBe(deck);
    expect(pendingSlideImageTasks(cleared)).toEqual([]);
    expect(clearPendingSlideImages(cleared)).toBe(cleared);
  });

  it("keeps overflow items strictly in document order when a tall block is followed by a short line on an imageText slide", () => {
    const body = [
      "- intro line",
      "",
      "```python\n" + Array.from({ length: 24 }, (_, i) => `line_${i} = ${i}`).join("\n") + "\n```",
      "",
      "TAIL_MARKER_AFTER_CODE",
    ].join("\n");
    const { deck } = buildAiDeck({
      title: "Code",
      theme,
      slides: [{ title: "Example", body, notes: "", imagePrompt: "Clean illustration of code blocks" }],
    });
    expect(deck.slides.length).toBeGreaterThanOrEqual(3);
    // TAIL_MARKER_AFTER_CODE must appear on a continuation slide AFTER the tall code block, never jumped ahead onto slide 1.
    expect(textOf({ slides: [deck.slides[1]] })).not.toContain("TAIL_MARKER_AFTER_CODE");
    expect(textOf({ slides: deck.slides.slice(2) })).toContain("TAIL_MARKER_AFTER_CODE");
  });
});
