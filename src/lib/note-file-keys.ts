// ノートの中に置く画像・ファイル（Notion の /image と /file 相当）の保存形式と検証。
// 保存先は「note-files/<所有者 ID>/<UUID>.<拡張子>」。所有者 ID をパスに含め、他人のキーを自分のノートに付け替えさせない。

// Vercel Functions の受信上限 4.5 MB に multipart の余白を残す（カバー画像と同じ）。
export const MAX_NOTE_FILE_BYTES = 4 * 1024 * 1024;

export const NOTE_IMAGE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
};

// 画像以外に置けるファイル。実行ファイルや HTML・SVG など、開くとコードが動くものは入れない。
export const NOTE_FILE_TYPES: Record<string, string> = {
  pdf: "application/pdf", txt: "text/plain", md: "text/markdown", csv: "text/csv", json: "application/json",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  zip: "application/zip", mp3: "audio/mpeg", wav: "audio/wav", mp4: "video/mp4",
};

const IMAGE_BY_EXTENSION = Object.fromEntries(Object.entries(NOTE_IMAGE_EXTENSIONS).map(([mime, ext]) => [ext, mime]));

const KEY = /^(note-files\/([a-z0-9]{1,64})\/[0-9a-f-]{36}\.([a-z0-9]{1,5}))$/;
const URL_PREFIX = "/api/pages/files?";

export function noteFileKeyParts(key: unknown) {
  const match = typeof key === "string" ? key.match(KEY) : null;
  return match ? { path: match[1], ownerId: match[2], extension: match[3] } : null;
}

export function isImageExtension(extension: string) {
  return Object.hasOwn(IMAGE_BY_EXTENSION, extension);
}

export function noteFileContentType(extension: string) {
  return IMAGE_BY_EXTENSION[extension] ?? NOTE_FILE_TYPES[extension] ?? "application/octet-stream";
}

// 表示用のファイル名。パスや制御文字を落とし、長さを抑える。
export function safeFileName(value: unknown) {
  const text = typeof value === "string" ? value : "";
  const base = text.split(/[\\/]/).pop() ?? "";
  return base.replace(/[\u0000-\u001f\u007f"<>|:*?]/g, "").trim().slice(0, 120);
}

// Markdown のリンク ![](…) の括弧を壊さないよう、( ) もパーセントエンコードする。
function encodeParam(value: string) {
  return encodeURIComponent(value).replace(/[()]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function noteFileUrl(path: string, name: string) {
  return `${URL_PREFIX}key=${encodeParam(path)}&name=${encodeParam(safeFileName(name))}`;
}

// URL の name パラメーター（表示用のファイル名）。
export function noteFileUrlName(url: string) {
  return safeFileName(new URLSearchParams(url.slice(URL_PREFIX.length)).get("name"));
}

// 自分のサービスの note-files にある「画像」の URL か（拡張子で判断。保存時に所有者も確かめる）。
export function isNoteImageUrl(value: string) {
  const parsed = parseNoteFileUrl(value);
  return parsed !== null && parsed !== "empty" && isImageExtension(parsed.extension);
}

// ブロックに保存してよい URL か。空文字（アップロード前の空ブロック）か、自分のサービスの note-files の URL だけ。
export function parseNoteFileUrl(value: unknown): { path: string; ownerId: string; extension: string } | "empty" | null {
  if (value === "") return "empty";
  if (typeof value !== "string" || !value.startsWith(URL_PREFIX) || value.length > 600) return null;
  const params = new URLSearchParams(value.slice(URL_PREFIX.length));
  if ([...params.keys()].some((key) => key !== "key" && key !== "name")) return null;
  return noteFileKeyParts(params.get("key"));
}

// ページカバー画像として受け付ける形式。拡張子ではなく先頭バイトで判定する。
export function sniffImage(buffer: Buffer): string | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 6 && /^GIF8[79]a$/.test(buffer.subarray(0, 6).toString("latin1"))) return "image/gif";
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("latin1") === "RIFF" && buffer.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}
