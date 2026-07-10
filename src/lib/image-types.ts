const SUPPORTED_IMAGE_INPUT_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export function isSupportedImageMimeType(mimeType: string) {
  // Responses API とブラウザ表示の両方で扱う画像形式だけを許可する。
  return SUPPORTED_IMAGE_INPUT_MIME_TYPES.has(mimeType.toLowerCase());
}
