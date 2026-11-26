import { describe, expect, it } from "vitest";
import { applyGeneratedSlideImage } from "./ai-build";
import { createImageElement, createLineElement, createTextElement } from "./factory";
import { applyGeometryPatch, applyGeometryPatches, geometryPatch } from "./geometry";
import type { Deck, ImageElement, LineElement, Slide, SlideElement, TextElement } from "./model";
import { replaceSlide } from "./ops";

const FILE = "/api/pages/files?key=note-files%2Fuser1%2F0e4b3f7c-1111-4c3a-9b1d-2f6f1f2a3b4c.png&name=a.png";

describe("drag geometry patches", () => {
  it("keeps an AI image that arrived while its placeholder was being dragged", () => {
    const placeholder: ImageElement = { ...createImageElement("", 400, 300), id: "img", src: "", pendingImagePrompt: "A lighthouse" };
    // ドラッグ中に生成した画像が届いた（src が入り、プロンプトが消えた）。
    const { pendingImagePrompt: _pending, ...rest } = placeholder;
    void _pending;
    const generated: ImageElement = { ...rest, src: "/api/pages/files?key=a.png", generated: { prompt: "A lighthouse" } };
    const patch = geometryPatch(placeholder, { ...placeholder, x: placeholder.x + 40, y: placeholder.y + 20 });
    expect(patch).toEqual({ x: placeholder.x + 40, y: placeholder.y + 20 });
    const committed = applyGeometryPatch(generated, patch) as ImageElement;
    expect(committed.src).toBe(generated.src);
    expect(committed.generated).toEqual({ prompt: "A lighthouse" });
    expect(committed.pendingImagePrompt).toBeUndefined();
    expect({ x: committed.x, y: committed.y, w: committed.w, h: committed.h }).toEqual({ x: placeholder.x + 40, y: placeholder.y + 20, w: placeholder.w, h: placeholder.h });
  });

  it("only carries the fields the drag changed", () => {
    const start = { ...createImageElement("/a.png", 400, 300), id: "img" };
    const resized = geometryPatch(start, { ...start, w: start.w + 10, h: start.h + 5, rotation: 15 });
    expect(resized).toEqual({ w: start.w + 10, h: start.h + 5, rotation: 15 });
    // ほかの所で位置が変わっていても、ドラッグで変えていない値は最新のまま。
    const latest = { ...start, x: start.x + 100 };
    expect(applyGeometryPatch(latest, resized)).toMatchObject({ x: start.x + 100, w: start.w + 10, h: start.h + 5, rotation: 15 });
  });

  it("carries the text auto height and line flips, only onto matching element types", () => {
    const text: TextElement = { ...createTextElement("Hi"), id: "t", autoHeight: true };
    const textPatch = geometryPatch(text, { ...text, h: text.h + 40, autoHeight: false });
    expect(textPatch).toEqual({ h: text.h + 40, autoHeight: false });
    expect(applyGeometryPatch(text, textPatch)).toMatchObject({ h: text.h + 40, autoHeight: false });

    const line: LineElement = { ...createLineElement(), id: "l" };
    const linePatch = geometryPatch(line, { ...line, flipH: !line.flipH, w: line.w + 5 });
    expect(linePatch).toEqual({ flipH: !line.flipH, w: line.w + 5 });
    expect(applyGeometryPatch(line, linePatch)).toMatchObject({ flipH: !line.flipH, w: line.w + 5 });

    const image = { ...createImageElement("/a.png", 10, 10), id: "i" };
    expect("flipH" in applyGeometryPatch(image, { flipH: true, x: 3 })).toBe(false);
    expect("autoHeight" in applyGeometryPatch(image, { autoHeight: false })).toBe(false);
  });

  it("keeps an AI image that lands in the same frame as the pointer release", () => {
    const placeholder: ImageElement = { ...createImageElement("", 400, 300), id: "img", src: "", pendingImagePrompt: "A lighthouse" };
    const other: Slide = { id: "s2", layout: "blank", elements: [] };
    const rendered: Deck = { format: 1, theme: { id: "simple", mode: "light" }, slides: [{ id: "s1", layout: "blank", elements: [placeholder] }, other] };
    // 画像は届いたが、まだ描いていない（描いている slide は古い占位のまま）。
    const arrived = applyGeneratedSlideImage(rendered, { slideId: "s1", elementId: "img", url: FILE, prompt: "A lighthouse" });
    expect(arrived.applied).toBe(true);
    const latest = arrived.deck;
    const patch = new Map([["img", geometryPatch(placeholder, { ...placeholder, x: placeholder.x + 30 })]]);
    // 指を離したときの確定（SlideStage の finish と同じ更新関数）。
    const committed = replaceSlide(latest, "s1", (slide) => {
      const elements = applyGeometryPatches(slide.elements, patch);
      return elements === slide.elements ? slide : { ...slide, elements };
    });
    const image = committed.slides[0].elements[0] as ImageElement;
    expect(image.src).toBe(FILE);
    expect(image.pendingImagePrompt).toBeUndefined();
    expect(image.x).toBe(placeholder.x + 30);
    expect(committed.slides[1]).toBe(other);
  });

  it("returns the same deck when a slide update changes nothing", () => {
    const slide: Slide = { id: "s1", layout: "blank", elements: [] };
    const deck: Deck = { format: 1, theme: { id: "simple", mode: "light" }, slides: [slide] };
    expect(replaceSlide(deck, "s1", (latest) => latest)).toBe(deck);
    expect(replaceSlide(deck, "s1", slide)).toBe(deck);
    expect(replaceSlide(deck, "missing", (latest) => ({ ...latest, notes: "x" }))).toBe(deck);
    const changed = replaceSlide(deck, "s1", (latest) => ({ ...latest, notes: "x" }));
    expect(changed).not.toBe(deck);
    expect(changed.slides[0].notes).toBe("x");
  });

  it("returns the same elements when nothing changes", () => {
    const elements: SlideElement[] = [{ ...createTextElement("A"), id: "a" }, { ...createImageElement("/b.png", 10, 10), id: "b" }];
    expect(applyGeometryPatches(elements, new Map())).toBe(elements);
    expect(applyGeometryPatches(elements, new Map([["b", geometryPatch(elements[1], elements[1])]]))).toBe(elements);
    expect(applyGeometryPatches(elements, new Map([["b", { x: elements[1].x }]]))).toBe(elements);
    const moved = applyGeometryPatches(elements, new Map([["b", { x: elements[1].x + 1 }], ["gone", { x: 5 }]]));
    expect(moved).not.toBe(elements);
    expect(moved[0]).toBe(elements[0]);
    expect(moved[1].x).toBe(elements[1].x + 1);
    expect(moved).toHaveLength(2);
  });
});
