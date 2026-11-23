import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { getOrCreateUser } from "@/lib/auth";
import { createImageApiGeneration, findGeneratedImage, type GenerationSize } from "@/lib/image-generation";
import { msg } from "@/lib/i18n/translate";
import { noteApiError } from "@/lib/note-api";
import { noteFileUrl } from "@/lib/note-file-keys";
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
    const buffer = Buffer.from(image, "base64");
    const path = `note-files/${user.id}/${randomUUID()}.png`;
    await storeFile(user, { path, kind: "NOTE_FILE", buffer, mimeType: "image/png" }, { enforce: false });
    ticket = null;
    scheduleStorageMaintenance();
    return NextResponse.json({ url: noteFileUrl(path, "ai-image.png"), name: "ai-image.png", size: buffer.byteLength, prompt }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    await refundUsage(ticket);
    return noteApiError(error);
  }
}
