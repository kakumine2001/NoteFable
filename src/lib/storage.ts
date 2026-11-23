import { randomUUID } from "crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "fs/promises";
import path from "path";
import { optionalEnv } from "@/lib/env";
import { msg } from "@/lib/i18n/translate";

// 保存時に MIME type から拡張子を決めるための対応表。
const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

// 保存先が環境変数で指定されていない場合のデフォルトルート。
const DEFAULT_STORAGE_ROOT = path.join("data", "storage");

function getStorageRoot() {
  // NOTEFABLE_STORAGE_DIR があれば、画像保存先としてそれを使う。
  const configuredRoot = optionalEnv("NOTEFABLE_STORAGE_DIR");

  if (!configuredRoot) {
    return DEFAULT_STORAGE_ROOT;
  }

  if (path.isAbsolute(configuredRoot)) {
    // 絶対パス指定はそのまま保存先にする。
    return configuredRoot;
  }

  // 相対パス指定はアプリの実行ディレクトリ基準で扱う。
  return configuredRoot;
}

function hasVercelBlobToken() {
  return Boolean(optionalEnv("BLOB_READ_WRITE_TOKEN"));
}

function assertStorageConfigured() {
  if (process.env.VERCEL === "1" && !hasVercelBlobToken()) {
    throw new Error(
      "BLOB_READ_WRITE_TOKEN is required on Vercel for image storage.",
    );
  }
}

function normalizeStoragePath(storagePath: string) {
  // 画像取得 API は DB に保存されたパスをもとにファイルを読む。
  // 絶対パスや .. を含むパスを拒否し、保存領域の外にあるファイルを読めないようにする。
  const normalized = path.normalize(storagePath);

  if (path.isAbsolute(normalized) || normalized.startsWith("..")) {
    throw new Error("Invalid storage path.");
  }

  return normalized;
}

export function getImageExtension(mimeType: string) {
  // 未知の画像 MIME type は .bin に倒し、拡張子から形式を断定しない。
  return IMAGE_EXTENSIONS[mimeType] ?? ".bin";
}

// チャットの画像の保存先。日付ごとのフォルダに分け、ファイル名は UUID にする。
// DB には storage root からの相対パスだけを保存し、環境ごとの保存先変更に追従しやすくする。
export function newChatImagePath(mimeType: string, date = new Date()) {
  const folder = [
    "images",
    String(date.getUTCFullYear()),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("/");
  return `${folder}/${randomUUID()}${getImageExtension(mimeType)}`;
}

export async function writeStoredImage(buffer: Buffer, mimeType: string) {
  return writeStoredImageAt(newChatImagePath(mimeType), buffer, mimeType);
}

// 保存先を呼び出し側で決める版。書き込み前にパスを DB に登録したい場合に使う。
export async function writeStoredImageAt(storagePath: string, buffer: Buffer, mimeType: string) {
  const relativePath = normalizeStoragePath(storagePath);

  if (hasVercelBlobToken()) {
    const { put } = await import("@vercel/blob");
    await put(relativePath.replace(/\\/g, "/"), buffer, {
      access: "private",
      contentType: mimeType,
      addRandomSuffix: false,
    });
    return relativePath.replace(/\\/g, "/");
  }

  assertStorageConfigured();
  const absolutePath = path.join(/*turbopackIgnore: true*/ getStorageRoot(), relativePath);

  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, buffer);

  return relativePath.replace(/\\/g, "/");
}

// 保存先にその画像が無い（Blob の 404、ローカルの ENOENT）。一時的な読み取りの失敗（通信・権限など）と区別したい呼び出し側が使う。
export class StoredImageNotFoundError extends Error {}

export async function readStoredImage(storagePath: string, maxBytes?: number) {
  const safePath = normalizeStoragePath(storagePath);

  if (hasVercelBlobToken()) {
    const { get } = await import("@vercel/blob");
    const result = await get(safePath, { access: "private" });
    // get は 404 のときだけ null を返す（それ以外の失敗は例外）。
    if (!result) throw new StoredImageNotFoundError(msg("Stored image not found."));
    if (result.statusCode !== 200) {
      throw new Error(msg("Stored image not found."));
    }

    const reader = result.stream.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (maxBytes !== undefined && size > maxBytes) { await reader.cancel(); throw new Error(msg("Stored file exceeds its declared size.")); }
        chunks.push(value);
      }
      return Buffer.concat(chunks);
    } finally { reader.releaseLock(); }
  }

  assertStorageConfigured();
  const buffer = await readFile(path.join(/*turbopackIgnore: true*/ getStorageRoot(), safePath)).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") throw new StoredImageNotFoundError(msg("Stored image not found."));
    throw error;
  });
  if (maxBytes !== undefined && buffer.length > maxBytes) throw new Error(msg("Stored file exceeds its declared size."));
  return buffer;
}

export async function deleteStoredImage(storagePath: string) {
  // 参照されなくなった画像を消す。既に存在しない場合も成功として扱う。
  const safePath = normalizeStoragePath(storagePath).replace(/\\/g, "/");

  if (hasVercelBlobToken()) {
    const { del } = await import("@vercel/blob");
    await del(safePath);
    return;
  }

  assertStorageConfigured();
  await rm(path.join(/*turbopackIgnore: true*/ getStorageRoot(), safePath), { force: true });
}

// 1 人の利用者のフォルダ（"note-files/<利用者 ID>/" など）をまとめて消す。アカウント削除だけが使う。
// prefix は必ず "/" で終わる利用者ごとのフォルダにする（別の利用者の ID が前方一致で巻き込まれないように）。
export async function deleteStoredPrefix(prefix: string) {
  const safePrefix = normalizeStoragePath(prefix).replace(/\\/g, "/");
  if (!prefix.endsWith("/") || safePrefix.split("/").filter(Boolean).length < 2) throw new Error("Invalid storage prefix.");
  const folder = safePrefix.endsWith("/") ? safePrefix : `${safePrefix}/`;

  if (hasVercelBlobToken()) {
    const { del, list } = await import("@vercel/blob");
    let cursor: string | undefined;
    do {
      const page = await list({ prefix: folder, cursor, limit: 1000 });
      if (page.blobs.length) await del(page.blobs.map((blob) => blob.url));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return;
  }

  assertStorageConfigured();
  await rm(path.join(/*turbopackIgnore: true*/ getStorageRoot(), folder), { recursive: true, force: true });
}

// Call only after ownership has been checked. Scope the read grant to one image.
export async function getStoredImageReadUrl(storagePath: string) {
  if (!hasVercelBlobToken()) return null;
  const pathname = normalizeStoragePath(storagePath).replace(/\\/g, "/");
  if (pathname.includes("*")) throw new Error("Wildcard image reads are not allowed.");
  const { issueSignedToken, presignUrl } = await import("@vercel/blob");
  const validUntil = Date.now() + 5 * 60 * 1000;
  const token = await issueSignedToken({ pathname, operations: ["get"], validUntil });
  return (await presignUrl(token, { operation: "get", pathname, access: "private", validUntil })).presignedUrl;
}

// Blob のトークンがあるのに Vercel の本番・プレビュー以外で動いている（ローカル開発が本番と同じファイル置き場を使っている）。
// このときは自分の DB に無いファイルも置き場にあるので、置き場の一覧をもとに消したり数えたりしない（stored-files.ts）。
export function sharesForeignStorage() {
  if (!hasVercelBlobToken()) return false;
  const env = process.env.VERCEL_ENV;
  return env !== "production" && env !== "preview";
}

export type StoredFileListing = { path: string; size: number; uploadedAt: Date };

// prefix（"note-files/" など、"/" で終わるフォルダ）の下のファイルを、cursor の続きから最大 limit 件返す。
// 次がなければ cursor は undefined。ファイル置き場の記録の棚卸しと、置き去りの一時ファイルの掃除が使う。
export async function listStoredFiles(prefix: string, cursor?: string, limit = 1000): Promise<{ files: StoredFileListing[]; cursor?: string }> {
  const folder = normalizeStoragePath(prefix).replace(/\\/g, "/");
  if (!prefix.endsWith("/")) throw new Error("Invalid storage prefix.");
  const safeFolder = folder.endsWith("/") ? folder : `${folder}/`;

  if (hasVercelBlobToken()) {
    const { list } = await import("@vercel/blob");
    const page = await list({ prefix: safeFolder, cursor, limit });
    return {
      files: page.blobs.map((blob) => ({ path: blob.pathname, size: blob.size, uploadedAt: new Date(blob.uploadedAt) })),
      cursor: page.hasMore ? page.cursor : undefined,
    };
  }

  // ローカルのファイル置き場。パスの順に並べ、cursor は最後に返したパス（それより後から続ける）。
  assertStorageConfigured();
  const root = getStorageRoot();
  const found: StoredFileListing[] = [];
  async function walk(relative: string) {
    let entries;
    try { entries = await readdir(path.join(/*turbopackIgnore: true*/ root, relative), { withFileTypes: true }); } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const child = `${relative}${entry.name}`;
      if (entry.isDirectory()) await walk(`${child}/`);
      else if (entry.isFile()) {
        const info = await stat(path.join(/*turbopackIgnore: true*/ root, child));
        found.push({ path: child, size: info.size, uploadedAt: info.mtime });
      }
    }
  }
  await walk(safeFolder);
  found.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const rest = cursor ? found.filter((file) => file.path > cursor) : found;
  const files = rest.slice(0, limit);
  return { files, cursor: rest.length > limit ? files.at(-1)!.path : undefined };
}
