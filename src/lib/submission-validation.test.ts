import { describe, expect, it } from "vitest";
import { getSubmissionValidationError } from "./submission-validation";

describe("getSubmissionValidationError", () => {
  it("allows files in chat mode", () => {
    expect(
      getSubmissionValidationError({
        imageGenerationMode: false,
        modelLabel: "DeepSeek",
        supportsImageGeneration: false,
        fileMimeTypes: ["application/pdf"],
      }),
    ).toBeNull();
  });

  it("rejects image generation on an unsupported model", () => {
    expect(
      getSubmissionValidationError({
        imageGenerationMode: true,
        modelLabel: "DeepSeek",
        supportsImageGeneration: false,
        fileMimeTypes: [],
      }),
    ).toBe("DeepSeek does not support image generation. Switch to GPT-6 Luna to use images.");
  });

  it("rejects non-image files before image generation", () => {
    expect(
      getSubmissionValidationError({
        imageGenerationMode: true,
        modelLabel: "GPT-6 Luna",
        supportsImageGeneration: true,
        fileMimeTypes: ["image/png", "application/pdf"],
      }),
    ).toBe(
      "Image generation only accepts image uploads. Remove non-image files or turn off Image generation.",
    );
  });

  it("allows image files for a supported image model", () => {
    expect(
      getSubmissionValidationError({
        imageGenerationMode: true,
        modelLabel: "GPT-6 Luna",
        supportsImageGeneration: true,
        fileMimeTypes: ["image/png", "image/jpeg"],
      }),
    ).toBeNull();
  });
});
