import { describe, expect, it } from "vitest";
import { normalizeWebSearchMode } from "./web-search";

describe("normalizeWebSearchMode", () => {
  it("keeps supported automatic and forced modes", () => {
    expect(normalizeWebSearchMode("auto", true)).toBe("auto");
    expect(normalizeWebSearchMode("force", true)).toBe("force");
    expect(normalizeWebSearchMode("true", true)).toBe("force");
  });

  it("turns search off for unsupported models", () => {
    expect(normalizeWebSearchMode("auto", false)).toBe("off");
    expect(normalizeWebSearchMode("", false)).toBe("off");
    expect(normalizeWebSearchMode(null, false)).toBe("off");
  });

  it("defaults to automatic search when the value is missing or unknown", () => {
    expect(normalizeWebSearchMode("", true)).toBe("auto");
    expect(normalizeWebSearchMode(null, true)).toBe("auto");
    expect(normalizeWebSearchMode("unexpected", true)).toBe("auto");
  });

  it("keeps explicit off mode for supported models", () => {
    expect(normalizeWebSearchMode("off", true)).toBe("off");
  });
});
