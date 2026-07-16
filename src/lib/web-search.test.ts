import { describe, expect, it } from "vitest";
import { normalizeWebSearchMode, shouldUseWebSearch } from "./web-search";

describe("normalizeWebSearchMode", () => {
  it("keeps supported automatic and forced modes", () => {
    expect(normalizeWebSearchMode("auto", true)).toBe("auto");
    expect(normalizeWebSearchMode("force", true)).toBe("force");
    expect(normalizeWebSearchMode("true", true)).toBe("force");
  });

  it("turns search off for unsupported models and invalid values", () => {
    expect(normalizeWebSearchMode("auto", false)).toBe("off");
    expect(normalizeWebSearchMode("unexpected", true)).toBe("off");
  });
});

describe("shouldUseWebSearch", () => {
  it("always searches in force mode and never searches when off", () => {
    expect(shouldUseWebSearch("force", "Explain photosynthesis")).toBe(true);
    expect(shouldUseWebSearch("off", "What is the latest news?")).toBe(false);
  });

  it("detects time-sensitive search intent in multiple languages", () => {
    expect(shouldUseWebSearch("auto", "What is the latest OpenAI model?")).toBe(true);
    expect(shouldUseWebSearch("auto", "现在东京天气怎么样？")).toBe(true);
    expect(shouldUseWebSearch("auto", "今日のニュースを教えて")).toBe(true);
  });

  it("does not search stable study questions automatically", () => {
    expect(shouldUseWebSearch("auto", "Explain the Pythagorean theorem")).toBe(false);
    expect(shouldUseWebSearch("auto", "帮我解释一下牛顿第二定律")).toBe(false);
  });
});
