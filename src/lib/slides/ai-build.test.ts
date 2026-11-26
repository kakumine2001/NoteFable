import { describe, expect, it } from "vitest";
import { extractCanvasSegments, MAX_SLIDE_NOTES, validateCanvasData } from "@/lib/canvas-document";
import { buildAiDeck } from "./ai-build";
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
    const sizes = JSON.stringify(slide.elements).match(/"type":"size","attrs":\{"size":\d+\}/g);
    expect(sizes).toEqual(['"type":"size","attrs":{"size":42}']);
    expect(textOf(deck)).toContain("after");
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
});
