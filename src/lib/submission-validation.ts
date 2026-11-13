import { isImageMimeType } from "@/lib/client-files";
import { msg } from "@/lib/i18n/translate";

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
    return msg("Image generation only accepts image uploads. Remove non-image files or turn off Image generation.");
  }

  return null;
}
