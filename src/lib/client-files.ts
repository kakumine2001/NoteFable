import { isSupportedImageMimeType } from "@/lib/image-types";

export function isImageMimeType(mimeType: string) {
  // API が入力として扱える画像だけをプレビュー対象にする。
  return isSupportedImageMimeType(mimeType);
}
