import { describe, expect, it } from "vitest";
import {
  fitFormulaDisplaySize,
  formulaDataOf,
  hitTestFormulaElement,
  makeFormulaCustomData,
  MAX_WHITEBOARD_FORMULA_LATEX,
  sanitizeFormulaLatex,
} from "@/lib/whiteboard/formula";

describe("whiteboard formula helpers", () => {
  it("reads and sanitizes customData.notefableFormula", () => {
    expect(formulaDataOf({ notefableFormula: { v: 1, latex: "  E = mc^2 \u0000 " } })).toEqual({ v: 1, latex: "E = mc^2" });
    expect(formulaDataOf({ notefableFormula: { v: 2, latex: "x" } })).toBeNull();
    expect(formulaDataOf({ notefableFormula: { v: 1, latex: "   " } })).toBeNull();
    expect(formulaDataOf(null)).toBeNull();
    expect(makeFormulaCustomData("\\int_0^1 x^2 dx")).toEqual({ notefableFormula: { v: 1, latex: "\\int_0^1 x^2 dx" } });
    expect(makeFormulaCustomData("  ")).toBeNull();

    const oversized = "x".repeat(MAX_WHITEBOARD_FORMULA_LATEX + 50);
    expect(sanitizeFormulaLatex(oversized).length).toBe(MAX_WHITEBOARD_FORMULA_LATEX);
  });

  it("fits display dimensions while preserving aspect ratio", () => {
    expect(fitFormulaDisplaySize(200, 60)).toEqual({ width: 200, height: 60 });
    expect(fitFormulaDisplaySize(1120, 200)).toEqual({ width: 560, height: 100 });
    expect(fitFormulaDisplaySize(20, 10)).toEqual({ width: 48, height: 36 });
  });

  it("hit-tests top-most unlocked formula images including rotated ones", () => {
    const elements = [
      { id: "rect", type: "rectangle", x: 0, y: 0, width: 300, height: 300, customData: { notefableFormula: { v: 1, latex: "x" } } },
      { id: "img-plain", type: "image", x: 0, y: 0, width: 300, height: 300 },
      { id: "eq-bottom", type: "image", x: 10, y: 10, width: 120, height: 50, customData: { notefableFormula: { v: 1, latex: "a+b" } } },
      { id: "eq-top", type: "image", x: 50, y: 20, width: 120, height: 50, customData: { notefableFormula: { v: 1, latex: "c+d" } } },
      { id: "eq-locked", type: "image", x: 50, y: 20, width: 120, height: 50, locked: true, customData: { notefableFormula: { v: 1, latex: "locked" } } },
      { id: "eq-deleted", type: "image", x: 50, y: 20, width: 120, height: 50, isDeleted: true, customData: { notefableFormula: { v: 1, latex: "gone" } } },
      { id: "eq-rotated", type: "image", x: 300, y: 100, width: 200, height: 40, angle: Math.PI / 2, customData: { notefableFormula: { v: 1, latex: "\\pi" } } },
    ];
    expect(hitTestFormulaElement(elements, { x: 80, y: 40 })).toEqual({ id: "eq-top", latex: "c+d" });
    expect(hitTestFormulaElement(elements, { x: 20, y: 20 })).toEqual({ id: "eq-bottom", latex: "a+b" });
    // 中心 (400, 120) を 90 度回転しているので (400, 200) は範囲内、(480, 120) は範囲外。
    expect(hitTestFormulaElement(elements, { x: 400, y: 200 })).toEqual({ id: "eq-rotated", latex: "\\pi" });
    expect(hitTestFormulaElement(elements, { x: 480, y: 120 })).toBeNull();
  });
});
