import { describe, expect, it } from "vitest";
import { exportFileName, frameOrder } from "@/lib/whiteboard/export-utils";

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
