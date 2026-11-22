import { createHash } from "crypto";
import { normalizeAppIcon } from "@/lib/app-icon-value";
import { msg } from "@/lib/i18n/translate";
import { NoteValidationError } from "@/lib/note-document";
import { sniffImage } from "@/lib/note-file-keys";

// アカウントに同期する設定の「アイコン」（docs/architecture/database.md の User.appIcon）。
// 端末では null / "character:<id>" / "data:image/...;base64,..."（96px の PNG）の文字列で持つ（src/lib/app-icon.ts）。
// サーバーには文字列の形（null / "character:<id>" / "image"）だけを置き、画像の本体は Blob（app-icons/<利用者 ID>/）に置く。
export const APP_ICON_ROOT = "app-icons";
// 行の appIcon で「アップロード画像」を表す印。
export const APP_ICON_IMAGE = "image";
// 端末が作るのは 96px の PNG（数 KB〜十数 KB）。それより大きいものは受け取らない。
export const MAX_APP_ICON_BYTES = 64 * 1024;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const DATA_URL = /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/]+={0,2})$/;

export type AppIconInput =
  | { kind: "character"; value: string | null }
  | { kind: "image"; bytes: Buffer; mimeType: string };

function invalid(): never {
  throw new NoteValidationError(msg("Choose a character or a PNG, JPEG or WebP image up to 64 KB."));
}

// PUT /api/app-icon の icon を確かめる。null / "" は既定（Quill）、キャラクターは "character:<id>"（Quill は null）に揃える。
// 画像は base64 の data URL だけ受け取り、宣言ではなく中身の先頭バイトで PNG / JPEG / WebP かを確かめる。
export function parseAppIconInput(value: unknown): AppIconInput {
  if (value === null || value === "") return { kind: "character", value: null };
  if (typeof value !== "string") invalid();
  if (value.startsWith("data:")) {
    const match = DATA_URL.exec(value);
    // base64 の長さで先に上限を見る（大きな文字列を復号しない）。
    if (!match || match[2].length > Math.ceil(MAX_APP_ICON_BYTES / 3) * 4) invalid();
    const bytes = Buffer.from(match[2], "base64");
    const mimeType = sniffImage(bytes);
    if (!bytes.length || bytes.length > MAX_APP_ICON_BYTES || !mimeType || !ALLOWED_TYPES.has(mimeType)) invalid();
    return { kind: "image", bytes, mimeType };
  }
  const normalized = normalizeAppIcon(value);
  // 旧絵文字や知らない値は、端末のように黙って既定に戻さず断る（別の端末の設定を消さないように）。
  if (normalized === null && !/^(character:)?quill$/.test(value)) invalid();
  return { kind: "character", value: normalized };
}

// 端末が「このアイコンはどのアカウントのものか」を覚えるための、アカウントごとの不透明な鍵（利用者 ID そのものは出さない）。
// 同じ端末で別のアカウントにログインしたとき、前のアカウントの画像を新しいアカウントへ送らないために使う。
export function appIconAccountKey(userId: string) {
  return createHash("sha256").update(`notefable:app-icon:${userId}`).digest("base64url").slice(0, 22);
}

export function appIconDataUrl(bytes: Buffer, mimeType: string) {
  return `data:${mimeType};base64,${bytes.toString("base64")}`;
}

export function appIconMimeType(storagePath: string) {
  const extension = storagePath.split(".").pop();
  return extension === "png" ? "image/png" : extension === "jpg" ? "image/jpeg" : extension === "webp" ? "image/webp" : null;
}
