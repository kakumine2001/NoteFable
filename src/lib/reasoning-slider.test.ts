import { describe, expect, it } from "vitest";
import {
  REASONING_SLIDER_POSITIONS,
  pointerPositionFromClientX,
  snapReasoningEffort,
  stepReasoningEffort,
} from "./reasoning-slider";

const allEfforts = ["none", "low", "medium", "high", "xhigh", "max"] as const;

describe("reasoning slider", () => {
  it("places all six GPT efforts at equal intervals", () => {
    expect(allEfforts.map((effort) => REASONING_SLIDER_POSITIONS[effort])).toEqual([
      0, 20, 40, 60, 80, 100,
    ]);
  });

  it("maps pointer coordinates to the thumb-center travel range", () => {
    expect(pointerPositionFromClientX(114, 100, 228)).toBe(0);
    expect(pointerPositionFromClientX(214, 100, 228)).toBe(50);
    expect(pointerPositionFromClientX(314, 100, 228)).toBe(100);
    expect(pointerPositionFromClientX(50, 100, 228)).toBe(0);
    expect(pointerPositionFromClientX(350, 100, 228)).toBe(100);
    expect(pointerPositionFromClientX(100, 100, 20)).toBe(0);
  });

  it("snaps to the nearest supported effort and resolves ties downward", () => {
    expect(snapReasoningEffort(0, allEfforts)).toBe("none");
    expect(snapReasoningEffort(11, allEfforts)).toBe("low");
    expect(snapReasoningEffort(40, allEfforts)).toBe("medium");
    expect(snapReasoningEffort(100, allEfforts)).toBe("max");
    expect(snapReasoningEffort(70, ["high", "xhigh"])).toBe("high");
    expect(snapReasoningEffort(79, ["high", "xhigh"])).toBe("xhigh");
  });

  it("steps through supported efforts without crossing the endpoints", () => {
    expect(stepReasoningEffort("medium", allEfforts, "increase")).toBe("high");
    expect(stepReasoningEffort("medium", allEfforts, "decrease")).toBe("low");
    expect(stepReasoningEffort("none", allEfforts, "decrease")).toBe("none");
    expect(stepReasoningEffort("max", allEfforts, "increase")).toBe("max");
    expect(stepReasoningEffort("high", ["high", "xhigh"], "increase")).toBe("xhigh");
  });
});
