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
  it("keeps DeepSeek text-only and GPT image-capable", () => {
    const openAI = getModelOption("gpt-5.6-sol");
    const deepSeek = MODEL_OPTIONS.filter((model) => model.provider === "deepseek");

    expect(openAI.supportsImageInput).toBe(true);
    expect(openAI.supportsImageGeneration).toBe(true);
    expect(deepSeek).toHaveLength(1);
    expect(deepSeek.filter((model) => model.supportsImageInput).map((model) => model.id)).toEqual([
      "deepseek-flash",
    ]);
    expect(deepSeek.every((model) => !model.supportsImageGeneration)).toBe(true);
  });

  it("keeps the full model names in the selector", () => {
    expect(MODEL_OPTIONS.map((model) => model.label)).toEqual([
      "GPT-5.6 Sol",
      "DeepSeek-V4.1-Flash",
    ]);
  });

  it("normalizes unknown models to the default", () => {
    expect(DEFAULT_MODEL).toBe("gpt-5.6-sol");
    expect(normalizeModel("deepseek-flash")).toBe("deepseek-flash");
    expect(normalizeModel("gpt-5.5")).toBe(DEFAULT_MODEL);
    expect(normalizeModel("unknown-model")).toBe(DEFAULT_MODEL);
    expect(normalizeModel(null)).toBe(DEFAULT_MODEL);
    expect(getModelOption("gpt-5.5").id).toBe(DEFAULT_MODEL);
    expect(getModelOption("unknown-model").id).toBe(DEFAULT_MODEL);
  });

  it("supports all six Sol reasoning efforts", () => {
    const sol = getModelOption("gpt-5.6-sol");

    expect(sol.reasoningEfforts).toEqual(["none", "low", "medium", "high", "xhigh", "max"]);
    expect(sol.defaultReasoning).toBe("medium");
    expect(normalizeReasoning(null, sol.id)).toBe("medium");
    expect(normalizeReasoning("invalid", sol.id)).toBe("medium");
    for (const effort of sol.reasoningEfforts) {
      expect(normalizeReasoning(effort, sol.id)).toBe(effort);
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
