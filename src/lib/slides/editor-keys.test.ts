import { describe, expect, it } from "vitest";
import { clipboardSource, editorKeyScope, inSlideList, SLIDE_LIST_SELECTOR } from "./editor-keys";

// closest() だけを持つ、DOM の要素の代わり。
const node = (insideList: boolean) => ({ closest: (selector: string) => (selector === SLIDE_LIST_SELECTOR && insideList ? {} : null) });

describe("slide editor key scope", () => {
  it("treats the grid view and focus inside the filmstrip as the slide list", () => {
    expect(inSlideList("grid", null)).toBe(true);
    expect(inSlideList("grid", node(false))).toBe(true);
    expect(inSlideList("slide", node(true))).toBe(true);
    expect(inSlideList("slide", node(false))).toBe(false);
    expect(inSlideList("slide", null)).toBe(false);
    expect(inSlideList("slide", {})).toBe(false);
  });

  it("never lets slide-list keys act on a selected element", () => {
    // 要素を選んだまま総覧に切り替えた・帯の縮小図にフォーカスを移した：Delete などは枚に効く。
    expect(editorKeyScope("grid", node(false), 2)).toBe("slides");
    expect(editorKeyScope("slide", node(true), 3)).toBe("slides");
    expect(editorKeyScope("slide", node(false), 1)).toBe("elements");
    expect(editorKeyScope("slide", node(false), 0)).toBe("stage");
  });

  it("copies slides from slide contexts and elements from the stage", () => {
    expect(clipboardSource(true, 2, 1)).toBe("slides");
    expect(clipboardSource(true, 2, 0)).toBeNull();
    expect(clipboardSource(false, 2, 1)).toBe("elements");
    expect(clipboardSource(false, 0, 3)).toBeNull();
  });
});
