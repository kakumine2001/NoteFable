import { uploadedCoverPath } from "@/lib/note-document";

// ノートのアイコンは絵文字 1 つか、カバーと同じ形でアップロードした画像のキー（upload:page-covers/…）。
export function isUploadedNoteIcon(icon: unknown) {
  return uploadedCoverPath(icon) !== null;
}

// 画像のアイコンを表示する URL。override があればそれ（公開ページの共有用 URL）を使う。絵文字なら null。
export function noteIconImageUrl(icon: string | null | undefined, override?: string | null) {
  const upload = uploadedCoverPath(icon ?? null);
  if (!upload) return null;
  return override ?? `/api/pages/covers?key=${encodeURIComponent(upload.path)}`;
}

// 文字だけで表すところ（翻訳文の中、ネイティブへのタイトルなど）。画像のアイコンは出さない。
export function noteIconText(icon: string | null | undefined) {
  return icon && !isUploadedNoteIcon(icon) ? icon : "";
}
