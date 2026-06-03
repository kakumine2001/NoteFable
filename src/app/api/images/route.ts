import { NextResponse } from "next/server";
import { getOrCreateAnonymousUser } from "@/lib/auth";
import { optionalEnv, requireEnv } from "@/lib/env";
import {
  AttachmentValidationError,
  isImageFile,
  validateAttachmentFiles,
  validateMultipartRequestSize,
} from "@/lib/files";
import {
  DEFAULT_MODEL,
  getModelOption,
  normalizeModel,
  normalizeReasoning,
  toDbReasoning,
} from "@/lib/models";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { writeStoredImage } from "@/lib/storage";

export const runtime = "nodejs";

type ImageSize = "1024x1024" | "1024x1536" | "1536x1024" | "auto";
type ImageQuality = "low" | "medium" | "high" | "auto";

type ImageRequestBody = {
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
  imageInputDataUrl: string;
};

type ImageGenerationResponse = {
  output?: {
    type?: string;
    result?: unknown;
  }[];
  error?: {
    message?: string;
  } | null;
};

const SUPPORTED_SIZES = new Set(["1024x1024", "1024x1536", "1536x1024", "auto"]);
const SUPPORTED_QUALITIES = new Set(["low", "medium", "high", "auto"]);
// 画像生成プロンプトの上限。長すぎる入力で API コストや保存履歴が膨らまないようにする。
const MAX_PROMPT_CHARS = 4_000;

function makeTitle(message: string) {
  // 画像生成でもチャットと同じルールで、プロンプト先頭からセッションタイトルを作る。
  const compact = message.replace(/\s+/g, " ").trim();
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

function normalizeReasoningValue(value: unknown, model: string) {
  // リクエスト由来の reasoning は unknown なので、文字列の場合だけ共通の正規化関数へ渡す。
  return normalizeReasoning(typeof value === "string" ? value : null, model);
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
    files,
  };
}

function getErrorMessage(error: unknown) {
  // ストリーム内外の catch で使う、画像生成向けのエラーメッセージ整形。
  return error instanceof Error ? error.message : "Image generation failed.";
}

function stringifyJsonForProxy(value: unknown) {
  // 一部の互換プロキシは UTF-8 の非 ASCII 文字を壊すため、JSON 文字列内は \uXXXX で送る。
  return JSON.stringify(value).replace(/[^\x00-\x7F]/g, (char) =>
    Array.from(char)
      .map((item) => {
        const codePoint = item.codePointAt(0) ?? 0;

        if (codePoint <= 0xffff) {
          return `\\u${codePoint.toString(16).padStart(4, "0")}`;
        }

        const high = Math.floor((codePoint - 0x10000) / 0x400) + 0xd800;
        const low = ((codePoint - 0x10000) % 0x400) + 0xdc00;

        return `\\u${high.toString(16).padStart(4, "0")}\\u${low
          .toString(16)
          .padStart(4, "0")}`;
      })
      .join(""),
  );
}

export function findCompletedImage(data?: ImageGenerationResponse): string | undefined {
  // output 配列から、最終画像の base64 を持つ image_generation_call を探す。
  const imageOutput = data?.output?.find(
    (item): item is { type?: string; result: string } =>
      item.type === "image_generation_call" &&
      typeof item.result === "string" &&
      item.result.length > 0,
  );

  return imageOutput?.result;
}

async function prepareImageInputs(files: File[]) {
  // 参照画像はDB保存より先に、上流 API へ渡す data URL として組み立てる。
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
      imageInputDataUrl: `data:${mimeType};base64,${buffer.toString("base64")}`,
    });
  }

  return inputs;
}

function buildImageGenerationInput(prompt: string, imageInputs: ImageInputAttachment[]) {
  if (!imageInputs.length) return prompt;

  return [
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: prompt,
        },
        ...imageInputs.map((image) => ({
          type: "input_image",
          image_url: image.imageInputDataUrl,
        })),
      ],
    },
  ];
}

async function createUpstreamImageResponse(
  prompt: string,
  size: ImageSize,
  quality: ImageQuality,
  imageInputs: ImageInputAttachment[],
) {
  // Responses API に image_generation ツールを明示し、テキスト回答ではなく画像生成を必ず実行させる。
  // UI には完成画像だけ返すため、上流も非ストリームで受け取り final result を読む。
  // OpenAI API キーは画像生成で必須。未設定ならここで分かりやすく失敗させる。
  const apiKey = requireEnv("OPENAI_API_KEY");
  // API の向き先は環境変数で差し替え可能。未設定なら公式エンドポイントを使う。
  const baseURL = optionalEnv("OPENAI_BASE_URL") || "https://api.openai.com/v1";

  const response = await fetch(`${baseURL.replace(/\/$/, "")}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: stringifyJsonForProxy({
      model: optionalEnv("OPENAI_IMAGE_RESPONSE_MODEL") || "gpt-5.5",
      input: buildImageGenerationInput(prompt, imageInputs),
      tools: [
        {
          type: "image_generation",
          model: optionalEnv("OPENAI_IMAGE_MODEL") || "gpt-image-2",
          size,
          quality,
          output_format: "png",
        },
      ],
      tool_choice: {
        type: "image_generation",
      },
      store: false,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    let data: ImageGenerationResponse = {};

    try {
      data = text ? (JSON.parse(text) as ImageGenerationResponse) : {};
    } catch {
      data = {};
    }

    throw new Error(
      data.error?.message ?? (text || `OpenAI request failed: ${response.status}`),
    );
  }

  return (await response.json()) as ImageGenerationResponse;
}

export async function POST(request: Request) {
  // 画像生成専用 API。
  // 入力検証と権限確認をしたうえで、完了画像だけを保存・履歴化して返す。
  let rateLimit: Awaited<ReturnType<typeof checkRateLimit>>;

  try {
    rateLimit = await checkRateLimit(request, {
      // 画像生成はコストが高いので、チャットとは別 namespace かつ少なめの回数にする。
      namespace: "images",
      limit: 10,
      windowMs: 60 * 60 * 1000,
    });
  } catch (error) {
    console.error("Failed to check image rate limit", error);
    return NextResponse.json({ error: "Database is unavailable." }, { status: 503 });
  }

  if (rateLimit.limited) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Try again later." },
      { status: 429, headers: rateLimitHeaders(rateLimit) },
    );
  }

  // リクエスト本文の解析結果。各フィールドは後で個別に型チェックする。
  let body: ImageRequestInput;

  try {
    body = await readImageRequest(request);
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
  // UI から送られたモデル ID。許可済みでなければ DEFAULT_MODEL へ戻す。
  const model = normalizeModel(typeof body.model === "string" ? body.model : DEFAULT_MODEL);
  // 画像生成対応可否など、選択モデルの機能設定。
  const modelOption = getModelOption(model);
  // 履歴保存用の推論強度。画像生成 API 自体には直接渡していないが、会話履歴の設定として残す。
  const reasoning = normalizeReasoningValue(body.reasoning, model);

  if (!prompt) {
    return NextResponse.json({ error: "Prompt is required." }, { status: 400 });
  }

  if (!modelOption.supportsImageGeneration) {
    return NextResponse.json(
      { error: `${modelOption.label} does not support image generation. Use GPT-5.5 for images.` },
      { status: 400 },
    );
  }

  if (prompt.length > MAX_PROMPT_CHARS) {
    return NextResponse.json({ error: "Prompt is too long." }, { status: 413 });
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
      { error: "Image generation only accepts image uploads." },
      { status: 400 },
    );
  }

  const imageInputs = await prepareImageInputs(body.files);

  try {
    // 匿名ユーザーを確定し、既存セッションが指定されている場合は所有者確認に使う。
    const user = await getOrCreateAnonymousUser();
    // sessionId が指定された場合だけ既存セッションを入れる。未指定なら completed 時に作成する。
    let existingSession: { id: string; title: string } | null = null;

    if (sessionId) {
      existingSession = await prisma.session.findFirst({
        where: { id: sessionId, userId: user.id },
        select: { id: true, title: true },
      });

      if (!existingSession) {
        return NextResponse.json({ error: "Session not found." }, { status: 404 });
      }
    }

    // OpenAI 側から完成済みレスポンスを受け、image_generation_call の result を保存する。
    const upstream = await createUpstreamImageResponse(
      prompt,
      normalizeSize(body.size),
      normalizeQuality(body.quality),
      imageInputs,
    );
    // 既存セッションがあればそれを使い、新規なら完了時に作ったセッションをここへ入れる。
    let session = existingSession;

    const imageBase64 = findCompletedImage(upstream);
    if (!imageBase64) {
      throw new Error("OpenAI did not return image data.");
    }
    // 保存処理には base64 ではなく Buffer が必要なので変換する。
    const imageBuffer = Buffer.from(imageBase64, "base64");
    // 生成画像をローカルストレージへ保存し、DB には相対パスを記録する。
    const imageStoragePath = await writeStoredImage(imageBuffer, "image/png");
    // 新規チャットから生成した場合は、完了画像ができた時点でセッションを作る。
    session ??= await prisma.session.create({
      data: {
        userId: user.id,
        title: makeTitle(prompt),
      },
      select: { id: true, title: true },
    });

    const inputAttachmentCreates = await Promise.all(
      imageInputs.map(async (image) => ({
        filename: image.filename,
        mimeType: image.mimeType,
        size: image.size,
        imageStoragePath: await writeStoredImage(image.buffer, image.mimeType),
      })),
    );

    // 会話履歴上は、ユーザーが画像生成プロンプトを送った発言として保存する。
    await prisma.message.create({
      data: {
        sessionId: session.id,
        role: "USER",
        content: prompt,
        model,
        reasoningEffort: toDbReasoning(reasoning),
        attachments: inputAttachmentCreates.length
          ? {
              create: inputAttachmentCreates,
            }
          : undefined,
      },
    });

    // アシスタント発言は本文なしで、生成画像を添付として保存する。
    await prisma.message.create({
      data: {
        sessionId: session.id,
        role: "ASSISTANT",
        content: "",
        model,
        reasoningEffort: toDbReasoning(reasoning),
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

    // 既存の New chat ならタイトルを付け直し、一覧の並び替え用に updatedAt も進める。
    await prisma.session.update({
      where: { id: session.id },
      data: {
        title: session.title === "New chat" ? makeTitle(prompt) : session.title,
        updatedAt: new Date(),
      },
    });

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
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
