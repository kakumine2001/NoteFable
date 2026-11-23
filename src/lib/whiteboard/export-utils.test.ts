import { describe, expect, it } from "vitest";
import { boundsRelation, exportFileName, frameOrder, planPdfPages, type PdfPagePlan } from "@/lib/whiteboard/export-utils";

type Box = { id: string; type: string; x: number; y: number; width: number; height: number; frameId?: string | null; containerId?: string | null };

const box = (id: string, type: string, x: number, y: number, width: number, height: number, extra: Partial<Box> = {}): Box => ({ id, type, x, y, width, height, ...extra });

// テスト用の位置の関係（外接矩形 = x, y, width, height）。
const boundsOf = (element: Box) => [element.x, element.y, element.x + element.width, element.y + element.height] as const;
const relation = (element: Box, frame: Box) => boundsRelation(boundsOf(element), boundsOf(frame));

describe("boundsRelation", () => {
  it("tells inside, overlap and none apart; touching edges do not overlap (as in Excalidraw's frame export)", () => {
    expect(boundsRelation([10, 10, 20, 20], [0, 0, 100, 100])).toBe("inside");
    expect(boundsRelation([0, 0, 100, 100], [0, 0, 100, 100])).toBe("inside");
    expect(boundsRelation([90, 90, 120, 120], [0, 0, 100, 100])).toBe("overlap");
    expect(boundsRelation([100, 0, 150, 50], [0, 0, 100, 100])).toBe("none");
    expect(boundsRelation([0, -50, 50, -1], [0, 0, 100, 100])).toBe("none");
    // 枠の上の辺に重ねた水平線（高さ 0）は枠のページに描かれない。中を通る水平線は描かれる。
    expect(boundsRelation([20, 0, 80, 0], [0, 0, 100, 100])).toBe("none");
    expect(boundsRelation([20, 50, 80, 50], [0, 0, 100, 100])).toBe("inside");
  });
});

const describePages = (pages: PdfPagePlan<Box>[]) => pages.map((page) => page.kind === "frame" ? `frame:${page.frame.id}` : page.kind === "rest" ? `rest:${page.elements.map((element) => element.id).join(",")}` : "all");

describe("planPdfPages", () => {
  it("puts the whole board on one page when there are no frames", () => {
    expect(describePages(planPdfPages([box("s", "freedraw", 0, 0, 100, 50)], relation))).toEqual(["all"]);
  });

  it("skips an empty frame and keeps the strokes outside it (it used to export one blank page)", () => {
    const elements = [box("f", "frame", 500, 0, 200, 150), box("s", "freedraw", 0, 200, 300, 100)];
    expect(describePages(planPdfPages(elements, relation))).toEqual(["rest:s"]);
  });

  it("gives each frame with content a page, in reading order, and the loose elements a last page", () => {
    const elements = [
      box("lower", "frame", 0, 400, 300, 200),
      box("upper", "frame", 0, 0, 300, 200),
      box("a", "rectangle", 20, 20, 50, 50, { frameId: "upper" }),
      box("b", "freedraw", 20, 420, 50, 50, { frameId: "lower" }),
      box("note", "text", 600, 0, 120, 30),
    ];
    expect(describePages(planPdfPages(elements, relation))).toEqual(["frame:upper", "frame:lower", "rest:note"]);
  });

  it("falls back to the whole board when there are only empty frames", () => {
    const elements = [box("f1", "frame", 0, 0, 200, 150), box("f2", "magicframe", 400, 0, 200, 150)];
    expect(describePages(planPdfPages(elements, relation))).toEqual(["all"]);
  });

  it("does not repeat a loose element that sits inside a frame, but keeps one that only overlaps it", () => {
    const elements = [
      box("f", "frame", 0, 0, 300, 200),
      box("inside", "rectangle", 10, 10, 50, 50),
      box("half", "ellipse", 280, 100, 60, 60),
    ];
    expect(describePages(planPdfPages(elements, relation))).toEqual(["frame:f", "rest:half"]);
  });

  it("counts a frame as having content when only a loose element overlaps it", () => {
    const elements = [box("f", "frame", 0, 0, 300, 200), box("half", "ellipse", 280, 100, 60, 60)];
    expect(describePages(planPdfPages(elements, relation))).toEqual(["frame:f", "rest:half"]);
  });

  it("does not count another frame's child as this frame's content", () => {
    const elements = [
      box("f1", "frame", 0, 0, 300, 200),
      box("f2", "frame", 250, 0, 300, 200),
      box("child", "rectangle", 260, 10, 30, 30, { frameId: "f2" }),
    ];
    expect(describePages(planPdfPages(elements, relation))).toEqual(["frame:f2"]);
  });

  it("keeps text in a container with the container's frame", () => {
    const elements = [
      box("f", "frame", 0, 0, 300, 200),
      box("shape", "rectangle", 20, 20, 100, 60, { frameId: "f" }),
      box("label", "text", 30, 40, 80, 20, { containerId: "shape" }),
    ];
    expect(describePages(planPdfPages(elements, relation))).toEqual(["frame:f"]);
  });

  it("keeps a label with its container even when the label's own frame says otherwise", () => {
    const elements = [
      box("f", "frame", 0, 0, 300, 200),
      box("shape", "rectangle", 600, 20, 100, 60),
      box("label", "text", 610, 40, 80, 20, { containerId: "shape", frameId: "f" }),
    ];
    expect(describePages(planPdfPages(elements, relation))).toEqual(["rest:shape,label"]);
  });

  it("puts an arrow's label on the last page with the arrow, even if the label sits inside a frame", () => {
    const elements = [
      box("f", "frame", 0, 0, 300, 200),
      box("arrow", "arrow", 200, 50, 300, 100),
      box("label", "text", 210, 60, 60, 20, { containerId: "arrow" }),
    ];
    expect(describePages(planPdfPages(elements, relation))).toEqual(["frame:f", "rest:arrow,label"]);
  });

  it("treats a child of a frame that is not on the board as a loose element", () => {
    const elements = [box("f", "frame", 0, 0, 300, 200), box("orphan", "freedraw", 600, 0, 50, 50, { frameId: "deleted-frame" })];
    expect(describePages(planPdfPages(elements, relation))).toEqual(["rest:orphan"]);
  });

  it("puts a child of a deleted frame on the last page even when it sits inside another frame (no frame page draws it)", () => {
    const elements = [box("f", "frame", 0, 0, 300, 200), box("orphan", "freedraw", 10, 10, 50, 50, { frameId: "deleted-frame" })];
    expect(describePages(planPdfPages(elements, relation))).toEqual(["rest:orphan"]);
  });

  it("keeps the outside part of an arrow that belongs to a frame (frames do not clip arrows)", () => {
    const elements = [
      box("f", "frame", 0, 0, 300, 200),
      box("start", "rectangle", 20, 20, 60, 60, { frameId: "f" }),
      box("arrow", "arrow", 80, 50, 420, 40, { frameId: "f" }),
      box("end", "rectangle", 500, 40, 60, 60),
    ];
    expect(describePages(planPdfPages(elements, relation))).toEqual(["frame:f", "rest:arrow,end"]);
  });

  it("gives an otherwise empty frame a page when another frame's arrow reaches into it", () => {
    const elements = [
      box("f1", "frame", 0, 0, 300, 200),
      box("f2", "frame", 400, 0, 300, 200),
      box("arrow", "arrow", 100, 50, 350, 20, { frameId: "f1" }),
    ];
    expect(describePages(planPdfPages(elements, relation))).toEqual(["frame:f1", "frame:f2", "rest:arrow"]);
  });

  it("keeps an arrow that stays inside its own frame on that frame's page only", () => {
    const elements = [box("f", "frame", 0, 0, 300, 200), box("arrow", "arrow", 20, 20, 200, 100, { frameId: "f" })];
    expect(describePages(planPdfPages(elements, relation))).toEqual(["frame:f"]);
  });

  it("puts a line lying on a frame's edge on the last page (the frame page does not draw it)", () => {
    const elements = [
      box("f", "frame", 0, 0, 300, 200),
      box("shape", "rectangle", 20, 20, 60, 60, { frameId: "f" }),
      box("line", "line", 20, 0, 260, 0),
    ];
    expect(describePages(planPdfPages(elements, relation))).toEqual(["frame:f", "rest:line"]);
  });
});

describe("exportFileName", () => {
  it("uses the title without characters file systems reject", () => {
    expect(exportFileName("Plan: Q4/Q1 *draft*", "png")).toBe("Plan Q4Q1 draft.png");
    expect(exportFileName("Untitled", "pdf")).toBe("Whiteboard.pdf");
    expect(exportFileName("  ", "svg")).toBe("Whiteboard.svg");
  });
});

describe("frameOrder", () => {
  it("reads frames top to bottom, and left to right within a row", () => {
    const frames = [
      { id: "b", x: 600, y: 10, height: 300 },
      { id: "c", x: 0, y: 500, height: 300 },
      { id: "a", x: 0, y: 0, height: 300 },
    ];
    expect(frameOrder(frames).map((frame) => frame.id)).toEqual(["a", "b", "c"]);
  });

  it("gives the same order whatever order the frames come in", () => {
    // 縦に少しずつずれた枠（2 つずつ比べると A < C < B < A になる並び）。
    const frames = [
      { id: "A", x: 200, y: 0, height: 100 },
      { id: "B", x: 0, y: 40, height: 100 },
      { id: "C", x: -100, y: 80, height: 100 },
    ];
    const orders = [[0, 1, 2], [2, 1, 0], [1, 2, 0], [2, 0, 1]].map((order) => frameOrder(order.map((index) => frames[index])).map((frame) => frame.id).join(""));
    expect(new Set(orders).size).toBe(1);
    expect(orders[0]).toBe("BAC");
  });
});
