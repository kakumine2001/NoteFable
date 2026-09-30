import { optionalEnv } from "@/lib/env";

// Notion へ転送する前の一時保管を Private Vercel Blob で行う。
// ブラウザから直接アップロードし、サーバーは 1 チャンクずつ読んで Notion へ送る。
// ファイル全体をメモリに載せないための分割単位は notion-files.ts と共通。
function hasBlobToken() {
  return Boolean(optionalEnv("BLOB_READ_WRITE_TOKEN"));
}

// この機能はローカルでも Private Blob を使う。ファイルシステムへは退避しない。
export function assertNotionStagingConfigured() {
  if (!hasBlobToken()) {
    throw new Error("BLOB_READ_WRITE_TOKEN is required for Notion file uploads.");
  }
}

export async function deleteNotionStagingPrefix(prefix: string) {
  if (!hasBlobToken()) return;

  const { del, list } = await import("@vercel/blob");
  let cursor: string | undefined;

  do {
    // Blob の list は 1 回で全件返らないため、cursor で最後までたどる。
    const result = await list({ prefix: `${prefix}/`, cursor });
    const pathnames = result.blobs.map((blob) => blob.pathname);

    if (pathnames.length) {
      await del(pathnames);
    }

    cursor = result.hasMore ? result.cursor : undefined;
  } while (cursor);
}

export async function headNotionStagingChunk(pathname: string) {
  assertNotionStagingConfigured();

  const { head } = await import("@vercel/blob");

  try {
    return await head(pathname);
  } catch {
    // 未アップロードのチャンクはエラーではなく「存在しない」として扱う。
    return null;
  }
}

export async function readNotionStagingChunk(pathname: string) {
  assertNotionStagingConfigured();

  const { get } = await import("@vercel/blob");
  const result = await get(pathname, { access: "private" });

  if (!result || result.statusCode !== 200) {
    throw new Error("Staged file chunk was not found.");
  }

  return Buffer.from(await new Response(result.stream).arrayBuffer());
}
