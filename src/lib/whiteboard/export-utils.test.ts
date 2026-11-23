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
});
