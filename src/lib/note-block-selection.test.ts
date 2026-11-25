import { describe, expect, it } from "vitest";
import {
  adjacentSelectableBlockId,
  buildNoteBlockSelection,
  canStartMarqueeTarget,
  clampRect,
  collectSubtreeIds,
  expandSelectionRange,
  isContainerOnlyBlock,
  isNoOpBlockMove,
  normalizeBlockSelection,
  orderedSelectableBlockIds,
  rectFromPoints,
  rectsIntersect,
  type SelectableBlock,
} from "@/lib/note-block-selection";

const sampleDoc: SelectableBlock[] = [
  { id: "h1", type: "heading", content: [{ type: "text", text: "Intro", styles: {} }], children: [] },
  {
    id: "t1",
    type: "toggleListItem",
    content: [{ type: "text", text: "Parent", styles: {} }],
    children: [
      { id: "c1", type: "paragraph", content: [{ type: "text", text: "Child 1", styles: {} }], children: [] },
      { id: "c2", type: "paragraph", content: [{ type: "text", text: "Child 2", styles: {} }], children: [] },
    ],
  },
  {
    id: "cols",
    type: "columnList",
    children: [
      {
        id: "col-a",
        type: "column",
        props: { width: 1 },
        children: [
          { id: "left-1", type: "paragraph", content: [{ type: "text", text: "Left", styles: {} }], children: [] },
        ],
      },
      {
        id: "col-b",
        type: "column",
        props: { width: 1 },
        children: [
          { id: "right-1", type: "callout", props: { emoji: "💡" }, content: [{ type: "text", text: "Right", styles: {} }], children: [] },
        ],
      },
    ],
  },
  { id: "div", type: "divider", children: [] },
  { id: "math", type: "mathBlock", props: { latex: "E=mc^2" }, children: [] },
];

describe("note-block-selection geometry", () => {
  it("normalizes two points into a bounding rect", () => {
    expect(rectFromPoints(120, 80, 40, 200)).toEqual({ left: 40, top: 80, right: 120, bottom: 200 });
  });

  it("detects intersecting and disjoint rects", () => {
    const a = { left: 10, top: 10, right: 50, bottom: 50 };
    expect(rectsIntersect(a, { left: 45, top: 45, right: 90, bottom: 90 })).toBe(true);
    expect(rectsIntersect(a, { left: 51, top: 10, right: 80, bottom: 50 })).toBe(false);
  });

  it("clamps a rect to bounds and returns null when empty", () => {
    const bounds = { left: 0, top: 0, right: 100, bottom: 100 };
    expect(clampRect({ left: -20, top: 10, right: 40, bottom: 120 }, bounds)).toEqual({ left: 0, top: 10, right: 40, bottom: 100 });
    expect(clampRect({ left: 110, top: 10, right: 140, bottom: 50 }, bounds)).toBeNull();
  });
});

describe("note-block-selection tree helpers", () => {
  it("identifies container-only column nodes and returns DFS selectable block order", () => {
    expect(isContainerOnlyBlock("columnList")).toBe(true);
    expect(isContainerOnlyBlock("column")).toBe(true);
    expect(isContainerOnlyBlock("paragraph")).toBe(false);
    expect(orderedSelectableBlockIds(sampleDoc)).toEqual(["h1", "t1", "c1", "c2", "left-1", "right-1", "div", "math"]);
  });

  it("collects full subtree IDs including descendants", () => {
    const set = collectSubtreeIds(sampleDoc, ["t1"]);
    expect([...set].sort()).toEqual(["c1", "c2", "t1"]);
  });

  it("normalizes selection in document order and collapses parent+child to root", () => {
    const roots = normalizeBlockSelection(sampleDoc, ["c2", "t1", "cols", "h1"]);
    expect(roots.map((b) => b.id)).toEqual(["h1", "t1"]);
  });

  it("expands selection range across columns and nested blocks", () => {
    const range = expandSelectionRange(sampleDoc, "c2", "right-1");
    expect(range.map((b) => b.id)).toEqual(["c2", "left-1", "right-1"]);
    const reverse = expandSelectionRange(sampleDoc, "math", "left-1");
    expect(reverse.map((b) => b.id)).toEqual(["left-1", "right-1", "div", "math"]);
  });

  it("finds adjacent selectable blocks up and down", () => {
    expect(adjacentSelectableBlockId(sampleDoc, "h1", "up")).toBeNull();
    expect(adjacentSelectableBlockId(sampleDoc, "h1", "down")).toBe("t1");
    expect(adjacentSelectableBlockId(sampleDoc, "c2", "down")).toBe("left-1");
    expect(adjacentSelectableBlockId(sampleDoc, "math", "down")).toBeNull();
  });

  it("detects no-op contiguous sibling moves accurately", () => {
    expect(isNoOpBlockMove(sampleDoc, ["h1", "t1"], "cols", "before")).toBe(true);
    expect(isNoOpBlockMove(sampleDoc, ["div"], "math", "before")).toBe(true);
    expect(isNoOpBlockMove(sampleDoc, ["math"], "div", "after")).toBe(true);
    expect(isNoOpBlockMove(sampleDoc, ["h1"], "div", "before")).toBe(false);
    expect(isNoOpBlockMove(sampleDoc, ["c1"], "c2", "before")).toBe(true);
    expect(isNoOpBlockMove(sampleDoc, ["c1"], "c2", "after")).toBe(false);
  });

  it("builds Note AI selection payload with markdown quote and root IDs", () => {
    const sel = buildNoteBlockSelection(sampleDoc, ["h1", "div", "math", "c1", "t1"]);
    expect(sel?.ids).toEqual(["h1", "t1", "div", "math"]);
    expect(sel?.text).toContain("# Intro");
    expect(sel?.text).toContain("▸ Parent");
    expect(sel?.text).toContain("---");
    expect(sel?.text).toContain("E=mc^2");
    expect(buildNoteBlockSelection(sampleDoc, [])).toBeNull();
  });
});

describe("canStartMarqueeTarget", () => {
  it("allows empty workspace/margin/tail targets and blocks editor content and interactive controls", () => {
    const makeEl = (matches: string[] = [], inWorkspace = true) => {
      const el = {
        closest: (selector: string) => {
          const parts = selector.split(",").map((s) => s.trim());
          return parts.some((p) => matches.includes(p)) ? el : null;
        },
      } as unknown as Element;
      const ws = {
        contains: () => inWorkspace,
      } as unknown as Element;
      return { el, ws };
    };

    const margin = makeEl([]);
    expect(canStartMarqueeTarget(margin.el, margin.ws)).toBe(true);

    const content = makeEl([".bn-block-content"]);
    expect(canStartMarqueeTarget(content.el, content.ws)).toBe(false);

    const headerTitle = makeEl([".notes-title"]);
    expect(canStartMarqueeTarget(headerTitle.el, headerTitle.ws)).toBe(false);

    const aiBubble = makeEl([".note-ai-bubble"]);
    expect(canStartMarqueeTarget(aiBubble.el, aiBubble.ws)).toBe(false);

    const outside = makeEl([], false);
    expect(canStartMarqueeTarget(outside.el, outside.ws)).toBe(false);
  });
});
