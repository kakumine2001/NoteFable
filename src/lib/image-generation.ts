import { optionalEnv, requireEnv } from "@/lib/env";
import { DEFAULT_IMAGE_MODEL } from "@/lib/models";
import { stringifyJsonForProxy } from "@/lib/proxy-json";
import { buildUpstreamErrorMessage } from "@/lib/upstream-errors";

// 文字だけからの画像生成（OpenAI Images API の /images/generations）。チャットの画像生成（/api/images）と
// スライドの「AI で画像を作る」（/api/pages/images）が使う。参照画像つきの生成（/images/edits）はチャットだけ。

export type ImageApiResponse = {
  data?: { b64_json?: unknown }[];
  error?: { message?: string } | null;
};
export type GenerationSize = "1024x1024" | "1024x1536" | "1536x1024" | "auto";
export type GenerationQuality = "low" | "medium" | "high" | "auto";

export function findGeneratedImage(data?: ImageApiResponse): string | undefined {
  // Images API は data[0].b64_json に完成画像を返す。
  const image = data?.data?.find(
    (item): item is { b64_json: string } => typeof item.b64_json === "string" && item.b64_json.length > 0,
  );
  return image?.b64_json;
}

export async function createImageApiGeneration(prompt: string, size: GenerationSize, quality: GenerationQuality) {
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
  });

  const text = await response.text();
  let data: ImageApiResponse = {};
  try { data = text ? (JSON.parse(text) as ImageApiResponse) : {}; } catch { data = {}; }
  if (!response.ok) throw new Error(data.error?.message ?? buildUpstreamErrorMessage("OpenAI", response.status, text));
  return data;
}
