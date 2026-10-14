import { isSupportedImageMimeType } from "@/lib/image-types";
import { MAX_MULTIPART_REQUEST_BYTES, MAX_UPLOAD_FILES, MAX_UPLOAD_FILE_BYTES, MAX_UPLOAD_TOTAL_BYTES } from "@/lib/upload-limits";

export const ATTACHMENT_ACCEPT = "image/png,image/jpeg,image/webp,application/pdf,text/*,.md,.markdown,.json,.csv,.tsv,.txt";

type UploadCandidate = Pick<File, "name" | "type" | "size">;
type UploadOptions = { supportsImages: boolean; claudeImages: boolean };

export function formatUploadSize(bytes: number) {
  if (bytes > 0 && bytes < 0.1 * 1024 * 1024) return `${Math.max(1, Math.ceil(bytes / 1024))} KiB`;
  return `${Number((bytes / (1024 * 1024)).toFixed(1))} MiB`;
}

export function getUploadValidationError(files: UploadCandidate[], options: UploadOptions) {
  if (files.length > MAX_UPLOAD_FILES) return `You can attach up to ${MAX_UPLOAD_FILES} files per message. Remove ${files.length - MAX_UPLOAD_FILES} to continue.`;
  for (const file of files) {
    if (!file.size) return `“${file.name}” is empty. Choose a file with content.`;
    if (!file.name || file.name.length > 255) return "The attachment filename is too long. Rename the file and try again.";
    const image = isImageMimeType(file.type);
    const supported = image || file.type.startsWith("text/") || file.type === "application/pdf" || /\.(md|markdown|json|csv|tsv|txt|pdf)$/i.test(file.name);
    if (!supported) return `“${file.name}” is not supported. Choose PNG, JPEG, WEBP, PDF or a text file.`;
    if (image && !options.supportsImages) return "This model cannot read images. Choose an image-capable model or turn on Create an image.";
    const limit = MAX_UPLOAD_FILE_BYTES;
    if (file.size > limit) return `“${file.name}” exceeds ${formatUploadSize(limit)} per file. Choose a smaller file.`;
  }
  if (files.reduce((sum, file) => sum + file.size, 0) > MAX_UPLOAD_TOTAL_BYTES) return `Attachments exceed ${formatUploadSize(MAX_UPLOAD_TOTAL_BYTES)} in total. Remove a file or choose smaller files.`;
  return "";
}

export function getUploadRequestError(files: UploadCandidate[], message: string) {
  const encoder = new TextEncoder();
  // Only references and text enter the chat request; binaries upload separately.
  const total = files.reduce((sum, file) => sum + 4096 + encoder.encode(file.name).length, 0);
  // Allow ample room for multipart boundaries and other small form fields.
  return total + encoder.encode(message).length + 64 * 1024 > MAX_MULTIPART_REQUEST_BYTES
    ? "This message is too large to send. Shorten the text or remove an attachment."
    : "";
}

// Reject the whole new selection explicitly; never silently choose a subset.
export function getUploadSelectionError(current: UploadCandidate[], incoming: UploadCandidate[], options: UploadOptions) {
  if (current.length + incoming.length > MAX_UPLOAD_FILES) {
    const remaining = Math.max(0, MAX_UPLOAD_FILES - current.length);
    return remaining
      ? `You can add ${remaining} more ${remaining === 1 ? "file" : "files"} (${MAX_UPLOAD_FILES} per message). None of these ${incoming.length} files were added. Choose fewer files.`
      : `All ${MAX_UPLOAD_FILES} attachment slots are used. Remove a file before adding another.`;
  }
  const error = getUploadValidationError([...current, ...incoming], options);
  return error ? `${error} No new files were added.` : "";
}

export function isImageMimeType(mimeType: string) {
  // API が入力として扱える画像だけをプレビュー対象にする。
  return isSupportedImageMimeType(mimeType);
}

type ClipboardFileItem = Pick<DataTransferItem, "kind" | "type" | "getAsFile">;

export function getClipboardImageFiles(items: ArrayLike<ClipboardFileItem>) {
  // クリップボード内の対応画像だけを通常の添付 File として取り出す。
  return Array.from(items).flatMap((item) => {
    if (item.kind !== "file" || !isImageMimeType(item.type)) return [];

    const file = item.getAsFile();
    return file ? [file] : [];
  });
}
