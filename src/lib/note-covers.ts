import { NoteValidationError, uploadedCoverPath } from "@/lib/note-document";
import { claimStoredFile } from "@/lib/stored-files";
import { msg } from "@/lib/i18n/translate";

export { sniffImage as sniffCoverImage } from "@/lib/note-file-keys";

export const COVER_CONTENT_TYPES: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };

// 他人のフォルダにある画像キーを、自分のページのカバーとして保存させない。
// kind は誤りの文言だけを変える（ページのアイコンにも同じ形の画像を使う）。
export function assertCoverOwner(cover: string | null, userId: string, kind: "cover" | "icon" = "cover") {
  const upload = uploadedCoverPath(cover);
  if (upload && upload.ownerId !== userId) throw new NoteValidationError(kind === "icon" ? msg("Page icon must be a single emoji or an uploaded image.") : msg("Unsupported note cover."));
}

// ページにアップロード画像を設定する保存処理の中で呼ぶ（同じトランザクション）。ファイルの行を「使用中」に戻し、
// 後片付けがすでに削除を始めていた場合は保存を拒否して、存在しない画像を参照させない（stored-files.ts）。
export async function claimCover(tx: Parameters<typeof claimStoredFile>[0], cover: string | null, userId: string, kind: "cover" | "icon" = "cover") {
  const upload = uploadedCoverPath(cover);
  if (!upload) return;
  if (!await claimStoredFile(tx, upload.path, userId)) throw new NoteValidationError(kind === "icon" ? msg("This icon image is no longer available. Choose another icon.") : msg("This cover image is no longer available. Choose another cover."));
}
