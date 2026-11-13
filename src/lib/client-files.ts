import { isSupportedImageMimeType } from "@/lib/image-types";
import { MAX_MULTIPART_REQUEST_BYTES, MAX_UPLOAD_FILES, MAX_UPLOAD_FILE_BYTES, MAX_UPLOAD_TOTAL_BYTES } from "@/lib/upload-limits";
import { createTranslator, type Translate } from "@/lib/i18n/translate";

const english = createTranslator({});

export const ATTACHMENT_ACCEPT = "image/png,image/jpeg,image/webp,application/pdf,text/*,.md,.markdown,.json,.csv,.tsv,.txt";

type UploadCandidate = Pick<File, "name" | "type" | "size">;
type UploadOptions = { supportsImages: boolean; claudeImages: boolean };

export function formatUploadSize(bytes: number) {
  if (bytes > 0 && bytes < 0.1 * 1024 * 1024) return `${Math.max(1, Math.ceil(bytes / 1024))} KiB`;
  return `${Number((bytes / (1024 * 1024)).toFixed(1))} MiB`;
}

// 値（特にファイル名）から文の区切りを推測せず、キーと値を現在の翻訳関数に直接渡す。
// 既定は英語なので、送信前の判定やサーバーでの利用には翻訳関数を渡す必要がない。
export function getUploadValidationError(files: UploadCandidate[], options: UploadOptions, t: Translate = english) {
  if (files.length > MAX_UPLOAD_FILES) return t("You can attach up to {max} files per message. Remove {extra} to continue.", { max: MAX_UPLOAD_FILES, extra: files.length - MAX_UPLOAD_FILES });
  for (const file of files) {
    if (!file.size) return t("“{name}” is empty. Choose a file with content.", { name: file.name });
    if (!file.name || file.name.length > 255) return t("The attachment filename is too long. Rename the file and try again.");
    const image = isImageMimeType(file.type);
    const supported = image || file.type.startsWith("text/") || file.type === "application/pdf" || /\.(md|markdown|json|csv|tsv|txt|pdf)$/i.test(file.name);
    if (!supported) return t("“{name}” is not supported. Choose PNG, JPEG, WEBP, PDF or a text file.", { name: file.name });
    if (image && !options.supportsImages) return t("This model cannot read images. Choose an image-capable model or turn on Create an image.");
    const limit = MAX_UPLOAD_FILE_BYTES;
    if (file.size > limit) return t("“{name}” exceeds {size} per file. Choose a smaller file.", { name: file.name, size: formatUploadSize(limit) });
  }
  if (files.reduce((sum, file) => sum + file.size, 0) > MAX_UPLOAD_TOTAL_BYTES) return t("Attachments exceed {size} in total. Remove a file or choose smaller files.", { size: formatUploadSize(MAX_UPLOAD_TOTAL_BYTES) });
  return "";
}

export function getUploadRequestError(files: UploadCandidate[], message: string, t: Translate = english) {
  const encoder = new TextEncoder();
  // Only references and text enter the chat request; binaries upload separately.
  const total = files.reduce((sum, file) => sum + 4096 + encoder.encode(file.name).length, 0);
  // Allow ample room for multipart boundaries and other small form fields.
  return total + encoder.encode(message).length + 64 * 1024 > MAX_MULTIPART_REQUEST_BYTES
    ? t("This message is too large to send. Shorten the text or remove an attachment.")
    : "";
}

// Reject the whole new selection explicitly; never silently choose a subset.
export function getUploadSelectionError(current: UploadCandidate[], incoming: UploadCandidate[], options: UploadOptions, t: Translate = english) {
  if (current.length + incoming.length > MAX_UPLOAD_FILES) {
    const remaining = Math.max(0, MAX_UPLOAD_FILES - current.length);
    if (!remaining) return t("All {max} attachment slots are used. Remove a file before adding another.", { max: MAX_UPLOAD_FILES });
    return remaining === 1
      ? t("You can add 1 more file ({max} per message). None of these {count} files were added. Choose fewer files.", { max: MAX_UPLOAD_FILES, count: incoming.length })
      : t("You can add {remaining} more files ({max} per message). None of these {count} files were added. Choose fewer files.", { remaining, max: MAX_UPLOAD_FILES, count: incoming.length });
  }
  const error = getUploadValidationError([...current, ...incoming], options, t);
  return error ? t("{error} No new files were added.", { error }) : "";
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
