import { describe, expect, it } from "vitest";
import {
  applyExplicitSelection,
  applyLiveSelection,
  clearActiveSelection,
  resolveActiveSelection,
  selectionKey,
} from "@/lib/canvas-selection-state";

describe("canvas-selection-state", () => {
  it("attaches live selection automatically without opening signal", () => {
    const state = applyLiveSelection(null, "board-1", { ids: ["el-1"], text: "test" });
    expect(state?.signal).toBe(0);
    expect(resolveActiveSelection(state, "board-1")).toEqual({ ids: ["el-1"], text: "test" });
    expect(resolveActiveSelection(state, "board-2")).toBeNull();
  });

  it("suppresses live selection after clear/send until selection changes or is re-selected", () => {
    let state = applyLiveSelection(null, "board-1", { ids: ["el-1"], text: "test" });
    state = clearActiveSelection(state, "board-1");
    expect(resolveActiveSelection(state, "board-1")).toBeNull();

    // Same live selection update stays dismissed.
    state = applyLiveSelection(state, "board-1", { ids: ["el-1"], text: "test" });
    expect(resolveActiveSelection(state, "board-1")).toBeNull();

    // Selecting a different element immediately re-attaches.
    state = applyLiveSelection(state, "board-1", { ids: ["el-2"], text: "other" });
    expect(resolveActiveSelection(state, "board-1")).toEqual({ ids: ["el-2"], text: "other" });

    // Clearing, deselecting, and re-selecting the same element re-attaches cleanly.
    state = clearActiveSelection(state, "board-1");
    expect(resolveActiveSelection(state, "board-1")).toBeNull();
    state = applyLiveSelection(state, "board-1", null);
    state = applyLiveSelection(state, "board-1", { ids: ["el-2"], text: "other" });
    expect(resolveActiveSelection(state, "board-1")).toEqual({ ids: ["el-2"], text: "other" });
  });

  it("re-attaches a dismissed live selection when Ask AI is explicitly clicked", () => {
    let state = applyLiveSelection(null, "board-1", { ids: ["el-1"], text: "test" });
    state = clearActiveSelection(state, "board-1");
    expect(resolveActiveSelection(state, "board-1")).toBeNull();

    state = applyExplicitSelection(state, "board-1", { ids: ["el-1"], text: "test" });
    expect(state.signal).toBe(1);
    expect(resolveActiveSelection(state, "board-1")).toEqual({ ids: ["el-1"], text: "test" });

    // A duplicate live update with the same key must not clear explicit selection.
    const unchanged = applyLiveSelection(state, "board-1", { ids: ["el-1"], text: "test" });
    expect(unchanged).toBe(state);
    expect(resolveActiveSelection(unchanged, "board-1")).toEqual({ ids: ["el-1"], text: "test" });
  });

  it("updates when text inside the selected shape changes and yields explicit selection on new live pick", () => {
    let state: ReturnType<typeof applyLiveSelection> = applyExplicitSelection(null, "slide-1", { ids: ["s1"], text: "Whole slide" });
    state = applyLiveSelection(state, "slide-1", { ids: ["el-a"], text: "Title" });
    expect(resolveActiveSelection(state, "slide-1")).toEqual({ ids: ["el-a"], text: "Title" });

    state = applyLiveSelection(state, "slide-1", { ids: ["el-a"], text: "Updated Title" });
    expect(resolveActiveSelection(state, "slide-1")).toEqual({ ids: ["el-a"], text: "Updated Title" });
  });

  it("preserves explicit selection when live selection was already null and null arrives", () => {
    const state = applyExplicitSelection(null, "slide-1", { ids: ["s1"], text: "Whole slide" });
    const next = applyLiveSelection(state, "slide-1", null);
    expect(next).toBe(state);
    expect(resolveActiveSelection(next, "slide-1")).toEqual({ ids: ["s1"], text: "Whole slide" });
  });

  it("normalizes duplicate and differently ordered IDs in selectionKey", () => {
    expect(selectionKey({ ids: ["b", "a", "a"], text: "hi" })).toBe(selectionKey({ ids: ["a", "b"], text: "hi" }));
  });

  it("clears only the submitted selection so a newer selection made during capture/send stays active", () => {
    const selA = { ids: ["el-a"], text: "A" };
    const selB = { ids: ["el-b"], text: "B" };
    let state = applyLiveSelection(null, "board-1", selA);
    // User switches to B while A is still uploading/awaiting server acceptance.
    state = applyLiveSelection(state, "board-1", selB);
    // Acceptance callback clears A only — B must remain active.
    const afterClearA = clearActiveSelection(state, "board-1", selA);
    expect(afterClearA).toBe(state);
    expect(resolveActiveSelection(afterClearA, "board-1")).toEqual(selB);

    // Clearing B dismisses B cleanly.
    const afterClearB = clearActiveSelection(afterClearA, "board-1", selB);
    expect(resolveActiveSelection(afterClearB, "board-1")).toBeNull();
  });
});
