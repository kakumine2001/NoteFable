import { msg } from "@/lib/i18n/translate";
import { storageLimitFromUpload } from "@/lib/storage-limit-client";
import { usageLimitErrorFrom } from "@/lib/usage-plans";

// ワークスペース（ノート・ホワイトボード・スライド）共通の AI 画像生成クライアント。
// 既存の /api/pages/images を使い、チャットの画像生成と同じ利用上限・note-files 保存経路を共有する。

export type GenerateImageSize = "1536x1024" | "1024x1024" | "1024x1536";

export type PageImage = {
  url: string;
  name: string;
  width: number;
  height: number;
  mimeType: string;
  prompt?: string;
};

export const PAGE_IMAGE_SIZES: readonly { key: GenerateImageSize; label: string }[] = [
  { key: "1536x1024", label: msg("Landscape") },
  { key: "1024x1024", label: msg("Square") },
  { key: "1024x1536", label: msg("Portrait") },
];

export function defaultDimensionsFor(size: GenerateImageSize): { width: number; height: number } {
  if (size === "1024x1024") return { width: 1024, height: 1024 };
  if (size === "1024x1536") return { width: 1024, height: 1536 };
  return { width: 1536, height: 1024 };
}

export function inferImageMimeType(name: string, mimeType?: string): string {
  if (typeof mimeType === "string" && mimeType.startsWith("image/")) return mimeType;
  const lower = name.toLowerCase();
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/png";
}

// 画像の元の大きさを測る。読み込めなければ指定サイズの比率を返す。
export function measurePageImage(url: string, fallback: { width: number; height: number } = { width: 1600, height: 900 }): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    if (typeof Image === "undefined") { resolve(fallback); return; }
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth || fallback.width, height: image.naturalHeight || fallback.height });
    image.onerror = () => resolve(fallback);
    image.src = url;
  });
}

// ホワイトボードへ置くときの自然な初期サイズ（比率を保ち、長辺を maxSide に収める）。
export function fitWhiteboardImageSize(naturalWidth: number, naturalHeight: number, maxSide = 560): { width: number; height: number } {
  const safeW = naturalWidth > 0 ? naturalWidth : 1536;
  const safeH = naturalHeight > 0 ? naturalHeight : 1024;
  const scale = Math.min(1, maxSide / Math.max(safeW, safeH));
  return {
    width: Math.max(64, Math.round(safeW * scale)),
    height: Math.max(64, Math.round(safeH * scale)),
  };
}

// AI で画像を 1 枚生成して note-files へ保存する（生成回数を 1 回使う）。
export async function generatePageImage(prompt: string, size: GenerateImageSize): Promise<PageImage> {
  const response = await fetch("/api/pages/images", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, size }),
  });
  const data = await response.json().catch(() => null) as { url?: string; name?: string; mimeType?: string; error?: string; prompt?: string } | null;
  const usage = usageLimitErrorFrom(response.status, data);
  if (usage) throw usage;
  const storage = storageLimitFromUpload(response.status, data);
  if (storage) throw storage;
  if (!response.ok || !data?.url) throw new Error(data?.error || msg("Could not create the image. Try again."));
  const name = data.name ?? "ai-image.png";
  const dims = await measurePageImage(data.url, defaultDimensionsFor(size));
  return {
    url: data.url,
    name,
    ...dims,
    mimeType: inferImageMimeType(name, data.mimeType),
    prompt: data.prompt ?? prompt,
  };
}
