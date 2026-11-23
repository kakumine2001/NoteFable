import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { getOrCreateUser } from "@/lib/auth";
import { createImageApiGeneration, findGeneratedImage, type GenerationSize } from "@/lib/image-generation";
import { msg } from "@/lib/i18n/translate";
import { noteApiError } from "@/lib/note-api";
import sharp from "sharp";
import { MAX_NOTE_FILE_BYTES, noteFileUrl, sniffImage } from "@/lib/note-file-keys";
import { assertStorageRoom, scheduleStorageMaintenance, storeFile } from "@/lib/stored-files";
import { clientNetworkKey, consumeUsage, refundUsage, usageLimitResponse, type UsageTicket } from "@/lib/usage-limits";

export const runtime = "nodejs";
// 画像の生成は 1 分ほどかかることがある。
export const maxDuration = 120;

// スライドの「AI で画像を作る」。文字の説明から画像を 1 枚作り、ノートのファイル（note-files）として保存して URL を返す。
// 生成の回数を 1 回使う（チャットの画像生成と同じ数え方。失敗したら戻す）。チャットの履歴には残さない。
// 保存した画像は、スライドの保存で使用中になる（使われなければ後片付けが消す）。AI で作ったことは要素の generated に残り、報告できる。
const MAX_PROMPT_CHARS = 4_000;
const SIZES: GenerationSize[] = ["1536x1024", "1024x1024", "1024x1536"];
const ATTEMPTS = 2;

// 作った画像をノートのファイルとして保存できる形にする。画像でなければ null。ノートのファイルは関数を通して返す（Vercel の応答は 4.5 MB まで）ので、
// 大きすぎる PNG は WebP に変え（足りなければ縮めて）上限（MAX_NOTE_FILE_BYTES）に収める。
async function fitGeneratedImage(buffer: Buffer): Promise<{ buffer: Buffer; mime: string; extension: string } | null> {
  const mime = sniffImage(buffer);
  if (!mime) return null;
  if (buffer.byteLength <= MAX_NOTE_FILE_BYTES) return { buffer, mime, extension: mime === "image/png" ? "png" : mime === "image/jpeg" ? "jpg" : mime === "image/webp" ? "webp" : "gif" };
  for (const [width, quality] of [[undefined, 90], [1280, 85], [1024, 80]] as const) {
    const pipeline = sharp(buffer);
    const out = await (width ? pipeline.resize({ width, withoutEnlargement: true }) : pipeline).webp({ quality }).toBuffer();
    if (out.byteLength <= MAX_NOTE_FILE_BYTES) return { buffer: out, mime: "image/webp", extension: "webp" };
  }
  return null;
}

export async function POST(request: Request) {
  let ticket: UsageTicket | null = null;
  try {
    const body = await request.json().catch(() => null) as { prompt?: unknown; size?: unknown } | null;
    const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) return NextResponse.json({ error: msg("Prompt is required.") }, { status: 400 });
    if (prompt.length > MAX_PROMPT_CHARS) return NextResponse.json({ error: msg("The image description is too long.") }, { status: 400 });
    const size = SIZES.includes(body?.size as GenerationSize) ? body?.size as GenerationSize : "1536x1024";
    const user = await getOrCreateUser();
    // 作ってから容量が足りないと分かると生成の回数が無駄になるので、先に空きを確かめる（作った画像は上限を超えても保存する）。
    await assertStorageRoom(user, 0);
    const usage = await consumeUsage(user, "image", clientNetworkKey(request));
    if (!usage.ok) return usageLimitResponse(usage, "image");
    ticket = usage.ticket;

    let image: string | undefined;
    let lastError: unknown;
    for (let attempt = 0; attempt < ATTEMPTS && !image; attempt++) {
      try { image = findGeneratedImage(await createImageApiGeneration(prompt, size, "auto")); }
      catch (error) { lastError = error; }
    }
    if (!image) {
      console.error("Slide image generation failed", { error: lastError instanceof Error ? lastError.message : String(lastError ?? "no image") });
      await refundUsage(ticket);
      return NextResponse.json({ error: msg("Could not create the image. Try again.") }, { status: 502 });
    }
    const stored = await fitGeneratedImage(Buffer.from(image, "base64"));
    if (!stored) {
      console.error("Slide image generation returned an unreadable image");
      await refundUsage(ticket);
      return NextResponse.json({ error: msg("Could not create the image. Try again.") }, { status: 502 });
    }
    const name = `ai-image.${stored.extension}`;
    const path = `note-files/${user.id}/${randomUUID()}.${stored.extension}`;
    await storeFile(user, { path, kind: "NOTE_FILE", buffer: stored.buffer, mimeType: stored.mime }, { enforce: false });
    ticket = null;
    scheduleStorageMaintenance();
    return NextResponse.json({ url: noteFileUrl(path, name), name, size: stored.buffer.byteLength, prompt }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    await refundUsage(ticket);
    return noteApiError(error);
  }
}
