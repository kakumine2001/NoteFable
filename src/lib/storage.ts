import { randomUUID } from "crypto";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
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

export async function writeStoredImage(buffer: Buffer, mimeType: string) {
  // 画像は日付ごとのフォルダに分け、ファイル名は UUID にする。
  // DB には storage root からの相対パスだけを保存し、環境ごとの保存先変更に追従しやすくする。
  const date = new Date();
  const folder = path.join(
    "images",
    String(date.getUTCFullYear()),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  );
  const filename = `${randomUUID()}${getImageExtension(mimeType)}`;
  return writeStoredImageAt(path.join(folder, filename), buffer, mimeType);
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

export async function readStoredImage(storagePath: string, maxBytes?: number) {
  const safePath = normalizeStoragePath(storagePath);

  if (hasVercelBlobToken()) {
    const { get } = await import("@vercel/blob");
    const result = await get(safePath, { access: "private" });
    if (!result || result.statusCode !== 200) {
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
  const buffer = await readFile(path.join(/*turbopackIgnore: true*/ getStorageRoot(), safePath));
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
