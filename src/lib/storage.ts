import { randomUUID } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { optionalEnv } from "@/lib/env";

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

const DEFAULT_STORAGE_ROOT = path.join("data", "storage");

function getStorageRoot() {
  const configuredRoot = optionalEnv("STUDYMATE_STORAGE_DIR");

  if (!configuredRoot) {
    return DEFAULT_STORAGE_ROOT;
  }

  if (path.isAbsolute(configuredRoot)) {
    return configuredRoot;
  }

  return configuredRoot;
}

function normalizeStoragePath(storagePath: string) {
  const normalized = path.normalize(storagePath);

  if (path.isAbsolute(normalized) || normalized.startsWith("..")) {
    throw new Error("Invalid storage path.");
  }

  return normalized;
}

export function getImageExtension(mimeType: string) {
  return IMAGE_EXTENSIONS[mimeType] ?? ".bin";
}

export async function writeStoredImage(buffer: Buffer, mimeType: string) {
  const date = new Date();
  const folder = path.join(
    "images",
    String(date.getUTCFullYear()),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  );
  const filename = `${randomUUID()}${getImageExtension(mimeType)}`;
  const relativePath = path.join(folder, filename);
  const absolutePath = path.join(/*turbopackIgnore: true*/ getStorageRoot(), relativePath);

  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, buffer);

  return relativePath.replace(/\\/g, "/");
}

export async function readStoredImage(storagePath: string) {
  const safePath = normalizeStoragePath(storagePath);
  return readFile(path.join(/*turbopackIgnore: true*/ getStorageRoot(), safePath));
}
