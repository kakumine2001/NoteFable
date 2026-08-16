import { describe, expect, it } from "vitest";
import { getDeepSeekWebSearchOptions, normalizeWebSearchMode } from "./web-search";

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

describe("getDeepSeekWebSearchOptions", () => {
  it("lets DeepSeek choose whether to use native web search in auto mode", () => {
    expect(getDeepSeekWebSearchOptions("auto")).toEqual({
      tools: [{ type: "web_search" }],
      toolChoice: "auto",
    });
  });

  it("requires native web search in force mode", () => {
    expect(getDeepSeekWebSearchOptions("force")).toEqual({
      tools: [{ type: "web_search" }],
      toolChoice: "required",
    });
  });

  it("does not add search tools in off mode", () => {
    expect(getDeepSeekWebSearchOptions("off")).toEqual({});
  });
});
