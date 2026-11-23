import { describe, expect, it } from "vitest";
import { exportFileName, frameOrder, planPdfPages, type FrameRelation, type PdfPagePlan } from "@/lib/whiteboard/export-utils";

type Box = { id: string; type: string; x: number; y: number; width: number; height: number; frameId?: string | null; containerId?: string | null };

const box = (id: string, type: string, x: number, y: number, width: number, height: number, extra: Partial<Box> = {}): Box => ({ id, type, x, y, width, height, ...extra });

// テスト用の位置の関係（外接矩形 = x, y, width, height）。
const relation = (element: Box, frame: Box): FrameRelation => {
  if (element.x + element.width < frame.x || element.x > frame.x + frame.width || element.y + element.height < frame.y || element.y > frame.y + frame.height) return "none";
  return element.x >= frame.x && element.y >= frame.y && element.x + element.width <= frame.x + frame.width && element.y + element.height <= frame.y + frame.height ? "inside" : "overlap";
};

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

  it("treats a child of a frame that is not on the board as a loose element", () => {
    const elements = [box("f", "frame", 0, 0, 300, 200), box("orphan", "freedraw", 600, 0, 50, 50, { frameId: "deleted-frame" })];
    expect(describePages(planPdfPages(elements, relation))).toEqual(["rest:orphan"]);
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
