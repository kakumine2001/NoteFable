import { isImageMimeType } from "@/lib/client-files";

type SubmissionValidationInput = {
  imageGenerationMode: boolean;
  fileMimeTypes: string[];
};

export function getSubmissionValidationError({
  imageGenerationMode,
  fileMimeTypes,
}: SubmissionValidationInput) {
  if (!imageGenerationMode) return null;

  if (fileMimeTypes.some((mimeType) => !isImageMimeType(mimeType || "application/octet-stream"))) {
    return "Image generation only accepts image uploads. Remove non-image files or turn off Image generation.";
  }

  return null;
}
