import { isImageMimeType } from "@/lib/client-files";

type SubmissionValidationInput = {
  imageGenerationMode: boolean;
  modelLabel: string;
  supportsImageGeneration: boolean;
  fileMimeTypes: string[];
};

export function getSubmissionValidationError({
  imageGenerationMode,
  modelLabel,
  supportsImageGeneration,
  fileMimeTypes,
}: SubmissionValidationInput) {
  if (!imageGenerationMode) return null;

  if (!supportsImageGeneration) {
    return `${modelLabel} does not support image generation. Switch to GPT-6 Luna to use images.`;
  }

  if (fileMimeTypes.some((mimeType) => !isImageMimeType(mimeType || "application/octet-stream"))) {
    return "Image generation only accepts image uploads. Remove non-image files or turn off Image generation.";
  }

  return null;
}
