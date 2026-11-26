import { describe, expect, it } from "vitest";
import { MAX_SELECTION_IDS } from "@/lib/page-ai/types";
import {
  clampImageDimensions,
  expandWhiteboardSelection,
  MAX_SELECTION_IMAGE_SIDE,
  selectionImageScale,
} from "@/lib/whiteboard/selection-capture";

describe("expandWhiteboardSelection", () => {
  it("expands frame children and bound text, skipping deleted elements", () => {
    const elements = [
      { id: "f1", type: "frame", name: "Flow" },
      { id: "r1", type: "rectangle", frameId: "f1" },
      { id: "t1", type: "text", containerId: "r1", frameId: "f1", text: "Start", originalText: "Start" },
      { id: "s1", type: "stickynote", frameId: "f1", text: "Note inside frame" },
      { id: "other", type: "rectangle" },
      { id: "del", type: "stickynote", frameId: "f1", isDeleted: true, text: "Deleted" },
    ];
    const result = expandWhiteboardSelection(elements, new Set(["f1"]));
    expect(result.ids).toEqual(["f1"]);
    expect(result.elements.map((e) => e.id)).toEqual(["f1", "r1", "t1", "s1"]);
    expect(result.text).toBe("Flow\nStart\nNote inside frame");
  });

  it("includes bound text when its container shape is selected and ignores invalid/excess IDs", () => {
    const many = Array.from({ length: MAX_SELECTION_IDS + 10 }, (_, i) => ({
      id: i === 0 ? "bad id!" : `el_${i}`,
      type: "rectangle",
    }));
    const result = expandWhiteboardSelection(many, new Set(many.map((e) => e.id)));
    expect(result.ids).toHaveLength(MAX_SELECTION_IDS);
    expect(result.ids).not.toContain("bad id!");
  });

  it("includes container and maps canonical ID to container when bound text is selected directly", () => {
    const elements = [
      { id: "box1", type: "rectangle" },
      { id: "txt1", type: "text", containerId: "box1", text: "Label" },
    ];
    const result = expandWhiteboardSelection(elements, new Set(["txt1"]));
    expect(result.ids).toEqual(["box1"]);
    expect(result.elements.map((e) => e.id)).toEqual(["box1", "txt1"]);
    expect(result.text).toBe("Label");
  });
});

describe("collapsed mind map branches in a selection", () => {
  it("adds the hidden text under the collapsed node, even when a label repeats", () => {
    const stash = [
      { id: "c1", type: "rectangle", customData: { notefableMindmap: { v: 1, role: "node", tree: "n1", parent: "n1", order: 0 } } },
      { id: "c1-t", type: "text", containerId: "c1", originalText: "Evaporation" },
      { id: "c2", type: "rectangle", customData: { notefableMindmap: { v: 1, role: "node", tree: "n1", parent: "c1", order: 0 } } },
      { id: "c2-t", type: "text", containerId: "c2", originalText: "Heat" },
    ];
    const elements = [
      { id: "s1", type: "stickynote", text: "Water" },
      { id: "n1", type: "rectangle", customData: { notefableMindmap: { v: 1, role: "node", tree: "n1", parent: null, order: 0, collapsed: true, stash } } },
      { id: "n1-t", type: "text", containerId: "n1", originalText: "Water" },
    ];
    const result = expandWhiteboardSelection(elements, new Set(["s1", "n1"]));
    expect(result.text).toBe("Water\nWater\n  - Evaporation\n    - Heat");
    expect(result.ids).toEqual(["s1", "n1"]);
  });
});

describe("selection image scaling", () => {
  it("keeps scaled long edge within MAX_SELECTION_IMAGE_SIDE (1568 px)", () => {
    const scaleSmall = selectionImageScale(400, 300);
    expect(scaleSmall).toBe(2);
    expect(Math.max(400 * scaleSmall, 300 * scaleSmall)).toBeLessThanOrEqual(MAX_SELECTION_IMAGE_SIDE);

    const scaleWide = selectionImageScale(3200, 800);
    expect(Math.max(3200 * scaleWide, 800 * scaleWide)).toBeLessThanOrEqual(MAX_SELECTION_IMAGE_SIDE + 1e-6);

    const clamped = clampImageDimensions(2400, 1200);
    expect(clamped).toEqual({ width: 1568, height: 784, scaled: true });

    const unchanged = clampImageDimensions(1200, 800);
    expect(unchanged).toEqual({ width: 1200, height: 800, scaled: false });
  });
});
