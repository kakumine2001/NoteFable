import { NextResponse } from "next/server";
import { splitQuotedMessage } from "@/lib/chat-quote";
import { getOrCreateUser } from "@/lib/auth";
import { clientNetworkKey, consumeUsage, refundUsage, usageLimitResponse, type UsageTicket } from "@/lib/usage-limits";
import { optionalEnv, requireEnv } from "@/lib/env";
import {
  AttachmentValidationError,
  isImageFile,
  validateAttachmentFiles,
  validateMultipartRequestSize,
} from "@/lib/files";
import {
  DEFAULT_IMAGE_MODEL,
  type ModelOption,
  normalizeModel,
  normalizeReasoning,
  toDbReasoning,
} from "@/lib/models";
import { prisma } from "@/lib/prisma";
import { newChatImagePath } from "@/lib/storage";
import { assertStorageRoom, discardStoredFiles, storageLimitResponse, storeFile } from "@/lib/stored-files";
import { StorageLimitError } from "@/lib/usage-plans";
import { buildImageContext } from "@/lib/image-context";
import { loadChatUploads, parseUploadReferences } from "@/lib/chat-uploads";
import { buildUpstreamErrorMessage, sanitizeErrorMessage } from "@/lib/upstream-errors";
import { msg } from "@/lib/i18n/translate";
import { getModelRegistry } from "@/lib/model-registry";
import { createImageApiGeneration, findGeneratedImage, type ImageApiResponse } from "@/lib/image-generation";

// 生成画像の取り出しは共通のモジュール（src/lib/image-generation.ts）。テストからはここ経由でも読める。
export { findGeneratedImage };
import { ROOT_PARENT } from "@/lib/chat-branches";
import { loadActiveLeafId } from "@/lib/chat-branch-store";

export const runtime = "nodejs";

type ImageSize = "1024x1024" | "1024x1536" | "1536x1024" | "auto";
type ImageQuality = "low" | "medium" | "high" | "auto";

type ImageRequestBody = {
  uploads?: unknown;
  prompt?: unknown;
  message?: unknown;
  size?: unknown;
  quality?: unknown;
  sessionId?: unknown;
  model?: unknown;
  reasoning?: unknown;
};

type ImageRequestInput = ImageRequestBody & {
  files: File[];
};

type ImageInputAttachment = {
  filename: string;
  mimeType: string;
  size: number;
  buffer: Buffer;
};


const SUPPORTED_SIZES = new Set(["1024x1024", "1024x1536", "1536x1024", "auto"]);
const SUPPORTED_QUALITIES = new Set(["low", "medium", "high", "auto"]);
const SUPPORTED_IMAGE_GENERATION_INPUT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
// 画像生成プロンプトの上限。長すぎる入力で API コストや保存履歴が膨らまないようにする。
const MAX_PROMPT_CHARS = 4_000;
// 互換プロキシがまれに画像を返さないため、保存前に一度だけ再試行する。
const IMAGE_GENERATION_ATTEMPTS = 2;

function makeTitle(message: string) {
  // 画像生成でもチャットと同じルールで、プロンプト先頭からセッションタイトルを作る。
  // 回答から引用した発言は、引用ではなく後ろの指示から作る（/api/chat と同じ）。
  const compact = splitQuotedMessage(message).body.replace(/\s+/g, " ").trim();
  return compact.length > 42 ? `${compact.slice(0, 42)}...` : compact || "New chat";
}

function normalizeSize(value: unknown): ImageSize {
  // クライアント値は信用せず、対応サイズ以外は API の auto 指定に戻す。
  return typeof value === "string" && SUPPORTED_SIZES.has(value)
    ? (value as ImageSize)
    : "auto";
}

function normalizeQuality(value: unknown): ImageQuality {
  // quality も許可リストで正規化し、不正値を上流 API へ渡さない。
  return typeof value === "string" && SUPPORTED_QUALITIES.has(value)
    ? (value as ImageQuality)
    : "auto";
}

function normalizeReasoningValue(value: unknown, model: string, options: readonly ModelOption[]) {
  // リクエスト由来の reasoning は unknown なので、文字列の場合だけ共通の正規化関数へ渡す。
  return normalizeReasoning(typeof value === "string" ? value : null, model, options);
}

function firstFormString(formData: FormData, ...names: string[]) {
  // multipart と既存 JSON 呼び出しのキー差を吸収する。
  for (const name of names) {
    const value = formData.get(name);
    if (typeof value === "string") return value;
  }

  return undefined;
}

async function readImageRequest(request: Request): Promise<ImageRequestInput> {
  // 参照画像つき生成は multipart、従来のテキストだけの生成は JSON でも受ける。
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";

  if (!contentType.includes("multipart/form-data")) {
    const body = (await request.json()) as ImageRequestBody;
    return { ...body, files: [] };
  }

  validateMultipartRequestSize(request);

  const formData = await request.formData();
  const files = formData
    .getAll("files")
    .filter((value): value is File => value instanceof File);

  return {
    prompt: firstFormString(formData, "prompt", "message"),
    size: firstFormString(formData, "size"),
    quality: firstFormString(formData, "quality"),
    sessionId: firstFormString(formData, "sessionId"),
    model: firstFormString(formData, "model"),
    reasoning: firstFormString(formData, "reasoning"),
    uploads: firstFormString(formData, "uploads"),
    files,
  };
}

function getErrorMessage(error: unknown) {
  // ストリーム内外の catch で使う、画像生成向けのエラーメッセージ整形。
  return sanitizeErrorMessage(error, "Image generation failed.");
}

function summarizeImageApiResponse(data?: ImageApiResponse) {
  // Images API の結果も base64 を出さず、画像数だけ記録する。
  return {
    error: data?.error?.message,
    data: data?.data?.map((item) => ({
      hasResult: typeof item.b64_json === "string" && item.b64_json.length > 0,
    })),
  };
}

function toImageApiSize(size: ImageSize) {
  return size;
}

function toImageApiQuality(quality: ImageQuality) {
  return quality;
}

async function prepareImageInputs(files: File[]) {
  // 参照画像はDB保存より先に、上流 Images API へ渡せる Buffer として組み立てる。
  const inputs: ImageInputAttachment[] = [];

  for (const file of files) {
    if (file.size === 0) continue;

    const mimeType = file.type || "application/octet-stream";
    const buffer = Buffer.from(await file.arrayBuffer());

    inputs.push({
      filename: file.name,
      mimeType,
      size: file.size,
      buffer,
    });
  }

  return inputs;
}

function isSupportedImageGenerationInput(file: File) {
  // Images API が安定して受け取る画像形式だけを許可する。
  return SUPPORTED_IMAGE_GENERATION_INPUT_TYPES.has(file.type || "application/octet-stream");
}

async function createImageApiEdit(
  prompt: string,
  size: ImageSize,
  quality: ImageQuality,
  imageInputs: ImageInputAttachment[],
) {
  // 参照画像つき生成は Images API の edit endpoint を使う。
  // Responses 経由だと互換プロキシで HTML timeout が返ることがある。
  const apiKey = requireEnv("OPENAI_API_KEY");
  const baseURL = optionalEnv("OPENAI_BASE_URL") || "https://api.openai.com/v1";
  const formData = new FormData();

  formData.append("model", optionalEnv("OPENAI_IMAGE_MODEL") || DEFAULT_IMAGE_MODEL);
  formData.append("prompt", prompt);
  formData.append("n", "1");
  formData.append("size", toImageApiSize(size));
  formData.append("quality", toImageApiQuality(quality));
  formData.append("output_format", "png");

  for (const image of imageInputs) {
    const blob = new Blob([new Uint8Array(image.buffer)], { type: image.mimeType });
    formData.append("image", blob, image.filename);
  }

  const response = await fetch(`${baseURL.replace(/\/$/, "")}/images/edits`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  const text = await response.text();
  let data: ImageApiResponse = {};

  try {
    data = text ? (JSON.parse(text) as ImageApiResponse) : {};
  } catch {
    data = {};
  }

  if (!response.ok) {
    throw new Error(
      data.error?.message ?? buildUpstreamErrorMessage("OpenAI", response.status, text),
    );
  }

  return data;
}

export async function POST(request: Request) {
  // 画像生成専用 API。
  // 入力検証と権限確認をしたうえで、完了画像だけを保存・履歴化して返す。
  // リクエスト本文の解析結果。各フィールドは後で個別に型チェックする。
  let body: ImageRequestInput;

  try {
    body = await readImageRequest(request);
    if (body.uploads) {
      const tickets = parseUploadReferences(body.uploads);
      const user = await getOrCreateUser();
      body.files = await loadChatUploads(tickets, user.id, body.files);
    }
  } catch (error) {
    const status = error instanceof AttachmentValidationError ? error.status : 400;
    const message = error instanceof Error ? error.message : "Invalid request body.";

    return NextResponse.json({ error: message }, { status });
  }

  // 画像生成の元になるプロンプト。文字列でない場合は空文字として扱い、後で必須チェックする。
  const rawPrompt = typeof body.prompt === "string" ? body.prompt : body.message;
  const prompt = typeof rawPrompt === "string" ? rawPrompt.trim() : "";
  // 既存会話へ画像生成結果を追加する場合のセッション ID。新規なら空文字。
  const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  // UI から送られたモデル ID。サーバーが許可していないものは既定のモデルへ戻す。
  const registry = getModelRegistry();
  const model = normalizeModel(typeof body.model === "string" ? body.model : registry.defaultModel, registry);
  // 履歴保存用の推論強度。画像生成 API 自体には直接渡していないが、会話履歴の設定として残す。
  const reasoning = normalizeReasoningValue(body.reasoning, model, registry.options);

  if (!prompt) {
    return NextResponse.json({ error: msg("Prompt is required.") }, { status: 400 });
  }

  if (prompt.length > MAX_PROMPT_CHARS) {
    return NextResponse.json({ error: msg("Prompt is too long.") }, { status: 413 });
  }

  try {
    validateAttachmentFiles(body.files);
  } catch (error) {
    const status = error instanceof AttachmentValidationError ? error.status : 400;
    const message = error instanceof Error ? error.message : "Invalid attachment.";

    return NextResponse.json({ error: message }, { status });
  }

  if (body.files.some((file) => !isImageFile(file))) {
    return NextResponse.json(
      { error: msg("Image generation only accepts image uploads.") },
      { status: 400 },
    );
  }

  if (body.files.some((file) => !isSupportedImageGenerationInput(file))) {
    return NextResponse.json(
      { error: msg("Image generation accepts PNG, JPEG, or WebP reference images only.") },
      { status: 400 },
    );
  }

  const imageInputs = await prepareImageInputs(body.files);
  // 1 日の生成回数。画像を受け取れずに失敗したときは数えない。
  let usageTicket: UsageTicket | null = null;
  // 保存したが、まだどの発言からも参照されていない画像。発言を保存する前に失敗したら消す。
  const storedPaths: string[] = [];

  try {
    // 匿名ユーザーを確定し、既存セッションが指定されている場合は所有者確認に使う。
    const user = await getOrCreateUser();
    // sessionId が指定された場合だけ既存セッションを入れる。未指定なら completed 時に作成する。
    let existingSession: { id: string; title: string } | null = null;

    if (sessionId) {
      existingSession = await prisma.session.findFirst({
        where: { id: sessionId, userId: user.id },
        select: { id: true, title: true },
      });

      if (!existingSession) {
        return NextResponse.json({ error: msg("Session not found.") }, { status: 404 });
      }
    }

    // 生成した画像と参照画像はファイル置き場に残る。費用の掛かる生成を始める前に、容量の空きを確かめる。
    // 参照画像は大きさが分かるので、ここで上限を確かめて置いてしまう（同時の生成で上限を超えないように）。
    // 生成する画像の大きさはまだ分からないので、上限に達していないことだけを見る。
    const referencePaths: string[] = [];
    try {
      await assertStorageRoom(user, imageInputs.reduce((sum, image) => sum + image.buffer.byteLength, 0));
      for (const image of imageInputs) {
        const path = await storeFile(user, { path: newChatImagePath(image.mimeType), kind: "CHAT_IMAGE", buffer: image.buffer, mimeType: image.mimeType }, { held: true });
        storedPaths.push(path);
        referencePaths.push(path);
      }
    } catch (error) {
      if (error instanceof StorageLimitError) {
        await discardStoredFiles(storedPaths.splice(0));
        return storageLimitResponse(error);
      }
      throw error;
    }

    const usage = await consumeUsage(user, "image", clientNetworkKey(request));
    if (!usage.ok) {
      await discardStoredFiles(storedPaths.splice(0));
      return usageLimitResponse(usage, "image");
    }
    usageTicket = usage.ticket;

    const history = existingSession ? await prisma.message.findMany({
      where: { sessionId: existingSession.id, active: true, session: { userId: user.id }, role: { in: ["USER", "ASSISTANT"] } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 24,
      select: {
        role: true,
        content: true,
        attachments: {
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { filename: true, mimeType: true, size: true, extractedText: true, imageStoragePath: true },
        },
      },
    }) : [];
    const context = await buildImageContext(prompt, history, imageInputs);

    // OpenAI 側から完成済みレスポンスを受け、image_generation_call の result を保存する。
    let imageBase64: string | undefined;
    const size = normalizeSize(body.size);
    const quality = normalizeQuality(body.quality);
    let lastGenerationError: unknown;

    for (let attempt = 1; attempt <= IMAGE_GENERATION_ATTEMPTS; attempt += 1) {
      try {
        if (context.images.length) {
          const upstream = await createImageApiEdit(context.prompt, size, quality, context.images);

          imageBase64 = findGeneratedImage(upstream);
          if (imageBase64) break;

          console.warn("OpenAI image edit API returned no image", {
            attempt,
            upstream: summarizeImageApiResponse(upstream),
          });
        } else {
          const upstream = await createImageApiGeneration(context.prompt, size, quality);

          imageBase64 = findGeneratedImage(upstream);
          if (imageBase64) break;

          console.warn("OpenAI image API returned no image", {
            attempt,
            upstream: summarizeImageApiResponse(upstream),
          });
        }
      } catch (error) {
        lastGenerationError = error;
        console.warn("OpenAI image API attempt failed", {
          attempt,
          hasReferenceImages: context.images.length > 0,
          error: getErrorMessage(error),
        });
      }
    }

    // 既存セッションがあればそれを使い、新規なら完了時に作ったセッションをここへ入れる。
    let session = existingSession;

    if (!imageBase64) {
      if (lastGenerationError) {
        throw lastGenerationError;
      }

      throw new Error(msg("OpenAI did not return image data."));
    }
    // 保存処理には base64 ではなく Buffer が必要なので変換する。
    const imageBuffer = Buffer.from(imageBase64, "base64");
    // 生成画像を保存し、DB には相対パスを記録する。生成はもう済んで費用も掛かっているので、容量に数えるが上限では断らない。
    const imageStoragePath = await storeFile(user, { path: newChatImagePath("image/png"), kind: "CHAT_IMAGE", buffer: imageBuffer, mimeType: "image/png" }, { enforce: false, held: true });
    storedPaths.push(imageStoragePath);
    // 新規チャットから生成した場合は、完了画像ができた時点でセッションを作る。
    session ??= await prisma.session.create({
      data: {
        userId: user.id,
        title: makeTitle(prompt),
      },
      select: { id: true, title: true },
    });

    const inputAttachmentCreates = imageInputs.map((image, index) => ({
      filename: image.filename,
      mimeType: image.mimeType,
      size: image.size,
      imageStoragePath: referencePaths[index],
    }));

    // 会話履歴上は、ユーザーが画像生成プロンプトを送った発言として保存する。表示中の枝の末尾に続ける。
    const promptMessage = await prisma.message.create({
      data: {
        sessionId: session.id,
        role: "USER",
        content: prompt,
        model,
        reasoningEffort: toDbReasoning(reasoning),
        // 新しく作ったチャットにはまだ発言が無い。
        parentId: existingSession ? await loadActiveLeafId(session.id) : ROOT_PARENT,
        attachments: inputAttachmentCreates.length
          ? {
              create: inputAttachmentCreates,
            }
          : undefined,
      },
    });
    // 参照画像はここから発言が参照する（残りは生成画像だけ）。
    storedPaths.splice(0, storedPaths.length, imageStoragePath);

    // アシスタント発言は本文なしで、生成画像を添付として保存する。
    await prisma.message.create({
      data: {
        sessionId: session.id,
        role: "ASSISTANT",
        content: "",
        model,
        reasoningEffort: toDbReasoning(reasoning),
        parentId: promptMessage.id,
        attachments: {
          create: {
            filename: "generated-image.png",
            mimeType: "image/png",
            size: imageBuffer.byteLength,
            imageStoragePath,
          },
        },
      },
    });

    storedPaths.length = 0;

    // Only replace the placeholder; never overwrite a title renamed while generation ran.
    await prisma.session.updateMany({
      where: { id: session.id, userId: user.id, title: "New chat", titleManual: false },
      data: { title: makeTitle(prompt) },
    });
    await prisma.session.update({ where: { id: session.id }, data: { updatedAt: new Date() } });

    return NextResponse.json(
      {
        sessionId: session.id,
        image: {
          mimeType: "image/png",
          dataUrl: `data:image/png;base64,${imageBase64}`,
        },
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    const message = getErrorMessage(error);
    // 保存に失敗して利用者が画像を受け取れなかった場合も戻す。
    await refundUsage(usageTicket);
    await discardStoredFiles(storedPaths);

    console.error("Image generation failed", {
      hasReferenceImages: imageInputs.length > 0,
      referenceImageTypes: imageInputs.map((image) => image.mimeType),
      error: message,
    });

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
