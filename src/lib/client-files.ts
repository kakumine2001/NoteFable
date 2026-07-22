import { isSupportedImageMimeType } from "@/lib/image-types";

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
