export function isImageMimeType(mimeType: string) {
  // クライアント側のプレビュー判定用。image/* なら object URL でサムネイル表示する。
  return mimeType.startsWith("image/");
}
