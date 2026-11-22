import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL,
  MODEL_OPTIONS,
  getModelOption,
  normalizeModel,
  normalizeReasoning,
  toDbReasoning,
} from "./models";

describe("model configuration", () => {
  it("enables web search for all built-in providers", () => {
    expect(getModelOption("deepseek-flash").supportsWebSearch).toBe(true);
    expect(getModelOption("gpt-6-luna").supportsWebSearch).toBe(true);
    expect(getModelOption("claude-haiku-5-5").supportsWebSearch).toBe(true);
  });
  it("keeps one DeepSeek model that accepts image input", () => {
    const openAI = getModelOption("gpt-6-luna");
    const deepSeek = MODEL_OPTIONS.filter((model) => model.provider === "deepseek");

    expect(openAI.supportsImageInput).toBe(true);
    expect(deepSeek).toHaveLength(1);
    expect(deepSeek.filter((model) => model.supportsImageInput).map((model) => model.id)).toEqual([
      "deepseek-flash",
    ]);
  });

  it("keeps the full model names in the selector", () => {
    expect(MODEL_OPTIONS.map((model) => model.label)).toEqual([
      "GPT-6 Luna",
      "Claude Haiku 5.5",
      "DeepSeek-V4.1-Flash",
    ]);
  });

  it("normalizes unknown models to the default", () => {
    expect(DEFAULT_MODEL).toBe("gpt-6-luna");
    expect(normalizeModel("deepseek-flash")).toBe("deepseek-flash");
    expect(normalizeModel("gpt-5.5")).toBe(DEFAULT_MODEL);
    expect(normalizeModel("unknown-model")).toBe(DEFAULT_MODEL);
    expect(normalizeModel(null)).toBe(DEFAULT_MODEL);
    expect(getModelOption("gpt-5.5").id).toBe(DEFAULT_MODEL);
    expect(getModelOption("unknown-model").id).toBe(DEFAULT_MODEL);
  });

  it("uses Claude's official five effort levels and capabilities", () => {
    const haiku = getModelOption("claude-haiku-5-5");
    expect(haiku.provider).toBe("anthropic");
    expect(haiku.supportsImageInput).toBe(true);
    expect(haiku.supportsWebSearch).toBe(true);
    expect(haiku.reasoningEfforts).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(normalizeReasoning("none", haiku.id)).toBe("medium");
    expect(normalizeReasoning(null, haiku.id)).toBe("medium");
    for (const effort of haiku.reasoningEfforts) expect(normalizeReasoning(effort, haiku.id)).toBe(effort);
  });

  it("supports all six Luna reasoning efforts", () => {
    const luna = getModelOption("gpt-6-luna");

    expect(luna.reasoningEfforts).toEqual(["none", "low", "medium", "high", "xhigh", "max"]);
    expect(luna.defaultReasoning).toBe("medium");
    expect(normalizeReasoning(null, luna.id)).toBe("medium");
    expect(normalizeReasoning("invalid", luna.id)).toBe("medium");
    for (const effort of luna.reasoningEfforts) {
      expect(normalizeReasoning(effort, luna.id)).toBe(effort);
    }
  });

  it("keeps DeepSeek's three actual reasoning efforts", () => {
    const deepSeek = MODEL_OPTIONS.filter((model) => model.provider === "deepseek");

    expect(deepSeek.every((model) => model.reasoningEfforts.join(",") === "low,high,max")).toBe(true);
    expect(deepSeek.every((model) => model.defaultReasoning === "high")).toBe(true);
    expect(normalizeReasoning("low", "deepseek-flash")).toBe("low");
    expect(normalizeReasoning("medium", "deepseek-flash")).toBe("high");
    expect(normalizeReasoning("max", "deepseek-flash")).toBe("max");
    expect(normalizeReasoning(null, "deepseek-flash")).toBe("high");
  });

  it("maps reasoning values to Prisma enum values", () => {
    expect(toDbReasoning("none")).toBe("NONE");
    expect(toDbReasoning("xhigh")).toBe("XHIGH");
    expect(toDbReasoning("max")).toBe("MAX");
  });
});
