import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { getOrCreateUser } from "@/lib/auth";
import { noteApiError } from "@/lib/note-api";
import { MAX_NOTE_FILE_BYTES, noteFileContentType, noteFileKeyParts, noteFileUrl, safeFileName } from "@/lib/note-file-keys";
import { classifyUpload } from "@/lib/note-files";
import { readLimitedBody } from "@/lib/note-upload";
import { readStoredImage, writeStoredImageAt } from "@/lib/storage";
import { msg } from "@/lib/i18n/translate";

export const runtime = "nodejs";

// ファイル本体に multipart の境界・ヘッダー分の余白を足した受信上限。
const MAX_UPLOAD_BODY_BYTES = MAX_NOTE_FILE_BYTES + 64 * 1024;

// ノートに置く画像・ファイルを保存し、ブロックに入れる URL を返す。ノートへの反映は通常の自動保存で行う。
export async function POST(request: Request) {
  try {
    const tooLarge = () => NextResponse.json({ error: msg("Files must be 4 MB or smaller.") }, { status: 413 });
    if (Number(request.headers.get("content-length") ?? 0) > MAX_UPLOAD_BODY_BYTES) return tooLarge();
    // Content-Length がない分割送信でも、実際に受け取ったバイト数で上限を守ってから multipart を解析する。
    const body = await readLimitedBody(request, MAX_UPLOAD_BODY_BYTES);
    if (!body) return tooLarge();
    let entries: [string, FormDataEntryValue][];
    try {
      const form = await new Response(body, { headers: { "Content-Type": request.headers.get("content-type") ?? "" } }).formData();
      entries = [...form.entries()];
    } catch { return NextResponse.json({ error: msg("Invalid upload.") }, { status: 400 }); }
    const file = entries.length === 1 && entries[0][0] === "file" ? entries[0][1] : null;
    if (!(file instanceof File)) return NextResponse.json({ error: msg("Choose one file to upload.") }, { status: 400 });
    if (file.size > MAX_NOTE_FILE_BYTES) return tooLarge();
    const buffer = Buffer.from(await file.arrayBuffer());
    const name = safeFileName(file.name) || "file";
    const kind = classifyUpload(buffer, name);
    if (!kind) return NextResponse.json({ error: msg("This file type is not supported. Use an image (JPEG, PNG, WebP, GIF), PDF, text, Office, CSV, JSON, ZIP, MP3, WAV or MP4.") }, { status: 400 });
    const user = await getOrCreateUser();
    const path = `note-files/${user.id}/${randomUUID()}.${kind.extension}`;
    await writeStoredImageAt(path, buffer, noteFileContentType(kind.extension));
    return NextResponse.json({ url: noteFileUrl(path, name), name, size: buffer.byteLength, kind: kind.kind }, { status: 201 });
  } catch (error) { return noteApiError(error); }
}

// 自分のフォルダにあるファイルだけを返す。画像以外はダウンロードとして返し、ブラウザ内で開いてコードが動かないようにする。
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const key = noteFileKeyParts(params.get("key"));
    const user = await getOrCreateUser();
    if (!key || key.ownerId !== user.id) return NextResponse.json({ error: msg("File not found.") }, { status: 404 });
    let data: Buffer;
    try { data = await readStoredImage(key.path); } catch { return NextResponse.json({ error: msg("File not found.") }, { status: 404 }); }
    const contentType = noteFileContentType(key.extension);
    const image = contentType.startsWith("image/");
    const name = safeFileName(params.get("name")) || `file.${key.extension}`;
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `${image ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`,
        // キーは UUID で内容が変わらないため長くキャッシュする。端末ごとのファイルなので共有キャッシュには載せない。
        "Cache-Control": "private, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox",
      },
    });
  } catch (error) { return noteApiError(error); }
}
