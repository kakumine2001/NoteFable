import { optionalEnv, requireEnv } from "@/lib/env";
import { DEFAULT_IMAGE_MODEL } from "@/lib/models";
import { stringifyJsonForProxy } from "@/lib/proxy-json";
import { buildUpstreamErrorMessage } from "@/lib/upstream-errors";

// OpenAI Images API（/images/generations と /images/edits）。
// チャットの画像生成（/api/images）とワークスペースの画像生成・スケッチ変換（/api/pages/images）が共用する。

export type ImageApiResponse = {
  data?: { b64_json?: unknown }[];
  error?: { message?: string } | null;
};
export type GenerationSize = "1024x1024" | "1024x1536" | "1536x1024" | "auto";
export type GenerationQuality = "low" | "medium" | "high" | "auto";
export type ImageEditInput = {
  filename: string;
  mimeType: string;
  buffer: Buffer;
};

export function findGeneratedImage(data?: ImageApiResponse): string | undefined {
  // Images API は data[0].b64_json に完成画像を返す。
  const image = data?.data?.find(
    (item): item is { b64_json: string } => typeof item.b64_json === "string" && item.b64_json.length > 0,
  );
  return image?.b64_json;
}

export type ImageApiRequestOptions = {
  signal?: AbortSignal;
};

export async function createImageApiGeneration(
  prompt: string,
  size: GenerationSize,
  quality: GenerationQuality,
  options?: ImageApiRequestOptions,
) {
  // テキストだけの画像生成は Images API を使う。互換プロキシ経由の Responses 画像ツールは
  // 同期完了前に 524 HTML で切られることがある。
  const apiKey = requireEnv("OPENAI_API_KEY");
  const baseURL = optionalEnv("OPENAI_BASE_URL") || "https://api.openai.com/v1";

  const response = await fetch(`${baseURL.replace(/\/$/, "")}/images/generations`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json; charset=utf-8" },
    body: stringifyJsonForProxy({
      model: optionalEnv("OPENAI_IMAGE_MODEL") || DEFAULT_IMAGE_MODEL,
      prompt,
      n: 1,
      size,
      quality,
      output_format: "png",
    }),
    ...(options?.signal ? { signal: options.signal } : {}),
  });

  const text = await response.text();
  let data: ImageApiResponse = {};
  try { data = text ? (JSON.parse(text) as ImageApiResponse) : {}; } catch { data = {}; }
  if (!response.ok) throw new Error(data.error?.message ?? buildUpstreamErrorMessage("OpenAI", response.status, text));
  return data;
}

export async function createImageApiEdit(
  prompt: string,
  size: GenerationSize,
  quality: GenerationQuality,
  imageInputs: readonly ImageEditInput[],
  options?: ImageApiRequestOptions,
) {
  // 参照画像つき生成は Images API の /images/edits を使う。
  // Responses 経由だと互換プロキシで HTML timeout が返ることがある。
  const apiKey = requireEnv("OPENAI_API_KEY");
  const baseURL = optionalEnv("OPENAI_BASE_URL") || "https://api.openai.com/v1";
  const formData = new FormData();

  formData.append("model", optionalEnv("OPENAI_IMAGE_MODEL") || DEFAULT_IMAGE_MODEL);
  formData.append("prompt", prompt);
  formData.append("n", "1");
  formData.append("size", size);
  formData.append("quality", quality);
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
    ...(options?.signal ? { signal: options.signal } : {}),
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
