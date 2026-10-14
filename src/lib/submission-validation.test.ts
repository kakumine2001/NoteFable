import { describe, expect, it } from "vitest";
import { getSubmissionValidationError } from "./submission-validation";

describe("getSubmissionValidationError", () => {
  it("allows files in chat mode", () => {
    expect(
      getSubmissionValidationError({ imageGenerationMode: false, fileMimeTypes: ["application/pdf"] }),
    ).toBeNull();
  });

  it("allows image generation whatever the chat model is, with or without reference images", () => {
    expect(getSubmissionValidationError({ imageGenerationMode: true, fileMimeTypes: [] })).toBeNull();
    expect(getSubmissionValidationError({ imageGenerationMode: true, fileMimeTypes: ["image/png", "image/jpeg"] })).toBeNull();
  });

  it("rejects non-image files before image generation", () => {
    expect(
      getSubmissionValidationError({ imageGenerationMode: true, fileMimeTypes: ["image/png", "application/pdf"] }),
    ).toBe(
      "Image generation only accepts image uploads. Remove non-image files or turn off Image generation.",
    );
  });
});
