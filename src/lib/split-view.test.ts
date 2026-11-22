import { describe, expect, it } from "vitest";
import { clampSplitRatio, DEFAULT_SPLIT_RATIO, loadSplitPreference, MAX_SPLIT_RATIO, MIN_SPLIT_RATIO, saveSplitPreference, SPLIT_STORAGE_KEY } from "./split-view";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
  };
}

describe("split-view preference helpers", () => {
  it("clamps ratio within safe bounds and falls back on invalid values", () => {
    expect(clampSplitRatio(NaN)).toBe(DEFAULT_SPLIT_RATIO);
    expect(clampSplitRatio("0.5")).toBe(DEFAULT_SPLIT_RATIO);
    expect(clampSplitRatio(0.1)).toBe(MIN_SPLIT_RATIO);
    expect(clampSplitRatio(0.9)).toBe(MAX_SPLIT_RATIO);
    expect(clampSplitRatio(0.4234)).toBe(0.423);
  });

  it("saves and restores split view preference safely", () => {
    const storage = memoryStorage();
    expect(loadSplitPreference(storage)).toEqual({ open: false, pageId: null, ratio: DEFAULT_SPLIT_RATIO });

    saveSplitPreference({ open: true, pageId: "page-123", ratio: 0.52 }, storage);
    expect(loadSplitPreference(storage)).toEqual({ open: true, pageId: "page-123", ratio: 0.52 });

    storage.setItem(SPLIT_STORAGE_KEY, "{broken-json");
    expect(loadSplitPreference(storage)).toEqual({ open: false, pageId: null, ratio: DEFAULT_SPLIT_RATIO });
  });
});
