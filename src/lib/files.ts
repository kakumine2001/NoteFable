export type PreparedAttachment = {
  filename: string;
  mimeType: string;
  size: number;
  extractedText?: string;
  imageInputDataUrl?: string;
  imageStoragePath?: string;
};

const MAX_TEXT_CHARS = 120_000;
export const MAX_UPLOAD_FILES = 5;
export const MAX_UPLOAD_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_UPLOAD_TOTAL_BYTES = 20 * 1024 * 1024;
export const MAX_MULTIPART_REQUEST_BYTES = 25 * 1024 * 1024;

const TEXT_EXTENSIONS = [".md", ".markdown", ".json", ".csv", ".tsv", ".txt"];

export class AttachmentValidationError extends Error {
  status = 413;
}

function isTextLike(file: File) {
  const name = file.name.toLowerCase();
  return (
    file.type.startsWith("text/") ||
    TEXT_EXTENSIONS.some((extension) => name.endsWith(extension))
  );
}

function isPdf(file: File) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

export function isImageFile(file: File) {
  return file.type.startsWith("image/");
}

function isSupportedFile(file: File) {
  return isTextLike(file) || isPdf(file) || isImageFile(file);
}

export function validateAttachmentFiles(files: File[]) {
  if (files.length > MAX_UPLOAD_FILES) {
    throw new AttachmentValidationError(`Upload up to ${MAX_UPLOAD_FILES} files at a time.`);
  }

  let totalBytes = 0;

  for (const file of files) {
    totalBytes += file.size;

    if (!isSupportedFile(file)) {
      throw new AttachmentValidationError(`Unsupported file type: ${file.name}`);
    }

    if (file.size > MAX_UPLOAD_FILE_BYTES) {
      throw new AttachmentValidationError(`File is too large: ${file.name}`);
    }
  }

  if (totalBytes > MAX_UPLOAD_TOTAL_BYTES) {
    throw new AttachmentValidationError("Total upload size is too large.");
  }
}

export function validateMultipartRequestSize(request: Request) {
  const rawContentLength = request.headers.get("content-length");
  const contentLength = rawContentLength ? Number(rawContentLength) : 0;

  if (!rawContentLength || !Number.isFinite(contentLength)) {
    throw new AttachmentValidationError("Request body size is required.");
  }

  if (contentLength > MAX_MULTIPART_REQUEST_BYTES) {
    throw new AttachmentValidationError("Request body is too large.");
  }
}

export async function prepareAttachments(files: File[]) {
  const attachments: PreparedAttachment[] = [];

  for (const file of files) {
    if (file.size === 0) continue;

    const buffer = Buffer.from(await file.arrayBuffer());
    const base: PreparedAttachment = {
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
    };

    if (isTextLike(file)) {
      base.extractedText = buffer.toString("utf8").slice(0, MAX_TEXT_CHARS);
    } else if (isPdf(file)) {
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: buffer });
      try {
        const parsed = await parser.getText();
        base.extractedText = parsed.text.slice(0, MAX_TEXT_CHARS);
      } finally {
        await parser.destroy();
      }
    } else if (isImageFile(file)) {
      const { writeStoredImage } = await import("@/lib/storage");
      base.imageStoragePath = await writeStoredImage(buffer, base.mimeType);
      base.imageInputDataUrl = `data:${base.mimeType};base64,${buffer.toString("base64")}`;
    }

    attachments.push(base);
  }

  return attachments;
}

export function buildAttachmentPrompt(attachments: PreparedAttachment[]) {
  const textBlocks = attachments
    .filter((attachment) => attachment.extractedText)
    .map(
      (attachment) =>
        `File: ${attachment.filename}\nType: ${attachment.mimeType}\nContent:\n${attachment.extractedText}`,
    );

  if (!textBlocks.length) return "";

  return `The user uploaded these files for this turn. Use them as context when helpful.\n\n${textBlocks.join(
    "\n\n---\n\n",
  )}`;
}
