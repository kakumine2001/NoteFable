import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { getOrCreateAnonymousUser } from "@/lib/auth";
import { limitNoteWrite, noteApiError } from "@/lib/note-api";
import { COVER_CONTENT_TYPES, sniffCoverImage } from "@/lib/note-covers";
import { MAX_COVER_BYTES, uploadedCoverPath } from "@/lib/note-document";
import { prisma } from "@/lib/prisma";
import { getImageExtension, readStoredImage, writeStoredImageAt } from "@/lib/storage";

export const runtime = "nodejs";

// 画像本体に multipart の境界・ヘッダー分の余白を足した受信上限。
const MAX_UPLOAD_BODY_BYTES = MAX_COVER_BYTES + 64 * 1024;

async function readLimitedBody(request: Request, limit: number) {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); return null; }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

// カバー画像を保存し、ページに設定するためのキーを返す。ページへの反映は通常の自動保存で行う。
export async function POST(request: Request) {
  try {
    const limited = await limitNoteWrite(request);
    if (limited) return limited;
    const tooLarge = () => NextResponse.json({ error: "Cover images must be 4 MB or smaller." }, { status: 413 });
    if (Number(request.headers.get("content-length") ?? 0) > MAX_UPLOAD_BODY_BYTES) return tooLarge();
    // Content-Length がない分割送信でも、実際に受け取ったバイト数で上限を守ってから multipart を解析する。
    const body = await readLimitedBody(request, MAX_UPLOAD_BODY_BYTES);
    if (!body) return tooLarge();
    let entries: [string, FormDataEntryValue][];
    try {
      const form = await new Response(body, { headers: { "Content-Type": request.headers.get("content-type") ?? "" } }).formData();
      entries = [...form.entries()];
    } catch { return NextResponse.json({ error: "Invalid upload." }, { status: 400 }); }
    const file = entries.length === 1 && entries[0][0] === "file" ? entries[0][1] : null;
    if (!(file instanceof File)) return NextResponse.json({ error: "Choose one image to upload." }, { status: 400 });
    if (file.size > MAX_COVER_BYTES) return tooLarge();
    const buffer = Buffer.from(await file.arrayBuffer());
    const mimeType = sniffCoverImage(buffer);
    if (!mimeType) return NextResponse.json({ error: "Upload a JPEG, PNG, WebP or GIF image." }, { status: 400 });
    const user = await getOrCreateAnonymousUser();
    const storagePath = `page-covers/${user.id}/${randomUUID()}${getImageExtension(mimeType)}`;
    // 先に資産行を作り、画像の書き込みが途中で止まっても追跡できない画像を残さない。
    // まだどのページにも付いていないため、作成時点を解放時刻にする。使われなければ日次処理で回収される。
    await prisma.noteCoverAsset.create({ data: { path: storagePath, userId: user.id, releasedAt: new Date() } });
    // 書き込みが失敗しても行は残す。応答だけ失われて画像が保存済みの場合も、日次処理が画像と行を回収する。
    await writeStoredImageAt(storagePath, buffer, mimeType);
    return NextResponse.json({ cover: `upload:${storagePath}` }, { status: 201 });
  } catch (error) { return noteApiError(error); }
}

// 自分のフォルダにあるカバー画像だけを返す。
export async function GET(request: Request) {
  try {
    const key = new URL(request.url).searchParams.get("key") ?? "";
    const upload = uploadedCoverPath(`upload:${key}`);
    const user = await getOrCreateAnonymousUser();
    if (!upload || upload.ownerId !== user.id) return NextResponse.json({ error: "Cover not found." }, { status: 404 });
    let image: Buffer;
    try { image = await readStoredImage(upload.path); } catch { return NextResponse.json({ error: "Cover not found." }, { status: 404 }); }
    return new Response(new Uint8Array(image), {
      headers: {
        "Content-Type": COVER_CONTENT_TYPES[upload.path.split(".").pop() ?? ""] ?? "application/octet-stream",
        // キーは UUID で内容が変わらないため長くキャッシュする。端末ごとの画像なので共有キャッシュには載せない。
        "Cache-Control": "private, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) { return noteApiError(error); }
}
