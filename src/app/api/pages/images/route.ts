import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { getOrCreateUser } from "@/lib/auth";
import { AttachmentValidationError, validateMultipartRequestSize } from "@/lib/files";
import { createImageApiEdit, createImageApiGeneration, findGeneratedImage, type GenerationSize, type ImageEditInput } from "@/lib/image-generation";
import { msg } from "@/lib/i18n/translate";
import { noteApiError } from "@/lib/note-api";
import sharp from "sharp";
import { MAX_NOTE_FILE_BYTES, noteFileUrl, sniffImage } from "@/lib/note-file-keys";
import { issuePageImageReportToken } from "@/lib/page-image-report-token";
import { assertStorageRoom, scheduleStorageMaintenance, storeFile } from "@/lib/stored-files";
import { clientNetworkKey, consumeUsage, refundUsage, usageLimitResponse, type UsageTicket } from "@/lib/usage-limits";

export const runtime = "nodejs";
// 画像の生成・編集は 1〜2 分かかることがある。タイムアウト前に必ず回数を戻せるよう余裕を持たせる。
export const maxDuration = 300;

// ワークスペース（ノート・ホワイトボード・スライド）の「AI で画像を作る」およびホワイトボードのスケッチ変換。
// 文字だけ（JSON）なら /images/generations、参照スケッチ付き（multipart/form-data の referenceImage）なら /images/edits を使い、
// 完成画像だけをノートのファイル（note-files）として保存して URL を返す（参照スケッチ自体は保存しない）。
// 生成の回数を 1 回使う（チャットの画像生成と同じ数え方。失敗したら戻す）。チャットの履歴には残さない。
// 保存した画像は、ページの保存で使用中になる（使われなければ後片付けが消す）。AI で作ったことはスライド・ホワイトボードの要素にも残り、報告できる。
const MAX_PROMPT_CHARS = 4_000;
const MAX_REFERENCE_IMAGE_BYTES = MAX_NOTE_FILE_BYTES;
const SIZES: readonly GenerationSize[] = ["1536x1024", "1024x1024", "1024x1536", "auto"];
const SUPPORTED_REFERENCE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const ATTEMPTS = 2;
const TOTAL_UPSTREAM_BUDGET_MS = 250_000;
const ATTEMPT_TIMEOUT_MS = 120_000;
const MIN_RETRY_BUDGET_MS = 20_000;
const DEFAULT_SKETCH_PROMPT = "Turn this whiteboard sketch into a clean, polished illustration while faithfully preserving its layout, composition, and key elements.";

type ParsedPageImageRequest =
  | { ok: true; prompt: string; size: GenerationSize; referenceImage: ImageEditInput | null }
  | { ok: false; status: number; error: string };

function normalizeSize(value: unknown): GenerationSize {
  return typeof value === "string" && SIZES.includes(value as GenerationSize) ? (value as GenerationSize) : "1536x1024";
}

function extensionForMime(mime: string): string {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  return "png";
}

async function parsePageImageRequest(request: Request): Promise<ParsedPageImageRequest> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("multipart/form-data")) {
    try {
      validateMultipartRequestSize(request);
    } catch (error) {
      if (error instanceof AttachmentValidationError) return { ok: false, status: error.status, error: error.message };
      return { ok: false, status: 400, error: msg("Invalid multipart form data.") };
    }
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return { ok: false, status: 400, error: msg("Invalid multipart form data.") };
    }
    const rawPrompt = formData.get("prompt");
    const prompt = typeof rawPrompt === "string" ? rawPrompt.trim() : "";
    const rawSize = formData.get("size");
    const size = normalizeSize(typeof rawSize === "string" ? rawSize : undefined);
    const rawReference = formData.get("referenceImage");
    let referenceImage: ImageEditInput | null = null;
    if (rawReference !== null) {
      if (!(rawReference instanceof File) || rawReference.size === 0) {
        return { ok: false, status: 400, error: msg("Image generation accepts PNG, JPEG, or WebP reference images only.") };
      }
      if (rawReference.size > MAX_REFERENCE_IMAGE_BYTES) {
        return { ok: false, status: 413, error: msg("Files must be 4 MB or smaller.") };
      }
      const buffer = Buffer.from(await rawReference.arrayBuffer());
      if (buffer.byteLength === 0) {
        return { ok: false, status: 400, error: msg("Image generation accepts PNG, JPEG, or WebP reference images only.") };
      }
      if (buffer.byteLength > MAX_REFERENCE_IMAGE_BYTES) {
        return { ok: false, status: 413, error: msg("Files must be 4 MB or smaller.") };
      }
      const sniffed = sniffImage(buffer);
      if (!sniffed || !SUPPORTED_REFERENCE_TYPES.has(sniffed)) {
        return { ok: false, status: 400, error: msg("Image generation accepts PNG, JPEG, or WebP reference images only.") };
      }
      const ext = extensionForMime(sniffed);
      referenceImage = { filename: `sketch.${ext}`, mimeType: sniffed, buffer };
    }
    return { ok: true, prompt, size, referenceImage };
  }

  const body = await request.json().catch(() => null) as { prompt?: unknown; size?: unknown } | null;
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  const size = normalizeSize(body?.size);
  return { ok: true, prompt, size, referenceImage: null };
}

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
    const parsed = await parsePageImageRequest(request);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    const { prompt, size, referenceImage } = parsed;
    if (!prompt && !referenceImage) return NextResponse.json({ error: msg("Prompt is required.") }, { status: 400 });
    if (prompt.length > MAX_PROMPT_CHARS) return NextResponse.json({ error: msg("The image description is too long.") }, { status: 400 });

    const displayPrompt = prompt || DEFAULT_SKETCH_PROMPT;
    const modelPrompt = referenceImage
      ? (prompt
        ? `Based on this whiteboard sketch, create a polished image while faithfully preserving its layout and key elements. User description: ${prompt}`
        : DEFAULT_SKETCH_PROMPT)
      : prompt;

    const user = await getOrCreateUser();
    // 作ってから容量が足りないと分かると生成の回数が無駄になるので、先に空きを確かめる（作った画像は上限を超えても保存する）。
    await assertStorageRoom(user, 0);
    const usage = await consumeUsage(user, "image", clientNetworkKey(request));
    if (!usage.ok) return usageLimitResponse(usage, "image");
    ticket = usage.ticket;

    let image: string | undefined;
    let lastError: unknown;
    const deadline = Date.now() + TOTAL_UPSTREAM_BUDGET_MS;
    for (let attempt = 0; attempt < ATTEMPTS && !image; attempt++) {
      if (request.signal.aborted) break;
      const remainingMs = deadline - Date.now();
      if (attempt > 0 && remainingMs < MIN_RETRY_BUDGET_MS) break;
      const timeoutMs = Math.max(1_000, Math.min(ATTEMPT_TIMEOUT_MS, remainingMs));
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)]);
      try {
        const upstream = referenceImage
          ? await createImageApiEdit(modelPrompt, size, "auto", [referenceImage], { signal })
          : await createImageApiGeneration(modelPrompt, size, "auto", { signal });
        image = findGeneratedImage(upstream);
      } catch (error) {
        lastError = error;
      }
    }
    if (!image) {
      console.error("Workspace image generation failed", {
        hasReferenceImage: Boolean(referenceImage),
        error: lastError instanceof Error ? lastError.message : String(lastError ?? "no image"),
      });
      await refundUsage(ticket);
      ticket = null;
      return NextResponse.json({ error: msg("Could not create the image. Try again.") }, { status: 502 });
    }
    const stored = await fitGeneratedImage(Buffer.from(image, "base64"));
    if (!stored) {
      console.error("Workspace image generation returned an unreadable image", { hasReferenceImage: Boolean(referenceImage) });
      await refundUsage(ticket);
      ticket = null;
      return NextResponse.json({ error: msg("Could not create the image. Try again.") }, { status: 502 });
    }
    const name = `ai-image.${stored.extension}`;
    const path = `note-files/${user.id}/${randomUUID()}.${stored.extension}`;
    await storeFile(user, { path, kind: "NOTE_FILE", buffer: stored.buffer, mimeType: stored.mime }, { enforce: false });
    ticket = null;
    const reportToken = await issuePageImageReportToken(user.id, { path, prompt: displayPrompt });
    scheduleStorageMaintenance();
    return NextResponse.json(
      { url: noteFileUrl(path, name), name, mimeType: stored.mime, size: stored.buffer.byteLength, prompt: displayPrompt, reportToken },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    await refundUsage(ticket);
    return noteApiError(error);
  }
}
