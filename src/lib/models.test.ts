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
    const openAI = getModelOption("gpt-5.5");
    const deepSeek = MODEL_OPTIONS.filter((model) => model.provider === "deepseek");

    expect(openAI.supportsImageInput).toBe(true);
    expect(openAI.supportsImageGeneration).toBe(true);
    expect(deepSeek).toHaveLength(2);
    expect(deepSeek.every((model) => !model.supportsImageInput)).toBe(true);
    expect(deepSeek.every((model) => !model.supportsImageGeneration)).toBe(true);
  });

  it("normalizes unknown models to the default", () => {
    expect(normalizeModel("deepseek-v4-pro")).toBe("deepseek-v4-pro");
    expect(normalizeModel("unknown-model")).toBe(DEFAULT_MODEL);
    expect(normalizeModel(null)).toBe(DEFAULT_MODEL);
    expect(getModelOption("unknown-model").id).toBe(DEFAULT_MODEL);
  });

  it("uses each model's reasoning defaults for unsupported values", () => {
    expect(normalizeReasoning("low", "gpt-5.5")).toBe("low");
    expect(normalizeReasoning("low", "deepseek-v4-flash")).toBe("high");
    expect(normalizeReasoning(null, "deepseek-v4-pro")).toBe("high");
  });

  it("maps reasoning values to Prisma enum values", () => {
    expect(toDbReasoning("xhigh")).toBe("XHIGH");
  });
});
