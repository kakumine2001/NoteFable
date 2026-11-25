import { msg } from "@/lib/i18n/translate";
import { generatePageImage, measurePageImage, type GenerateImageSize, type PageImage } from "@/lib/page-images";
import { storageLimitFromUpload } from "@/lib/storage-limit-client";
import { MAX_STORED_FILE_BYTES } from "@/lib/usage-plans";

// スライドの画像（画面側）：note-files へのアップロード、チャットの画像の取り込み、AI での生成。どれも自分の note-files の URL を返す。
// 容量の上限で断られたときは、ノートと同じく画面に案内を出す（storage-limit-client.ts）。

export type SlideImage = Omit<PageImage, "mimeType"> & { mimeType?: string };

export const SLIDE_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

// 画像の元の大きさ（置く大きさを決めるため）。読めなければ 16:9。
export function imageSize(url: string): Promise<{ width: number; height: number }> {
  return measurePageImage(url, { width: 1600, height: 900 });
}

async function readJson(response: Response) {
  return await response.json().catch(() => null) as { url?: string; name?: string; error?: string; prompt?: string } | null;
}

export async function uploadSlideImage(file: File): Promise<SlideImage> {
  if (!SLIDE_IMAGE_TYPES.includes(file.type)) throw new Error(msg("Choose a PNG, JPEG, WebP or GIF image."));
  if (file.size > MAX_STORED_FILE_BYTES) throw new Error(msg("Images must be 4 MB or smaller."));
  const form = new FormData();
  form.append("file", file);
  const response = await fetch("/api/pages/files", { method: "POST", body: form });
  const data = await readJson(response);
  const storage = storageLimitFromUpload(response.status, data);
  if (storage) throw storage;
  if (!response.ok || !data?.url) throw new Error(data?.error || msg("Upload failed. Try again."));
  const size = await imageSize(data.url);
  return { url: data.url, name: data.name ?? file.name, ...size };
}

// チャットで送った・作った画像を、スライド用に note-files へ写す。
export async function copyChatImage(attachmentId: string): Promise<SlideImage> {
  const response = await fetch("/api/pages/chat-images", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ attachmentId }) });
  const data = await readJson(response);
  const storage = storageLimitFromUpload(response.status, data);
  if (storage) throw storage;
  if (!response.ok || !data?.url) throw new Error(data?.error || msg("Could not add the image."));
  const size = await imageSize(data.url);
  return { url: data.url, name: data.name ?? "image", ...size };
}

export type GenerateSize = GenerateImageSize;

// AI で画像を作る（生成の回数を 1 回使う）。
export async function generateSlideImage(prompt: string, size: GenerateSize): Promise<SlideImage> {
  return generatePageImage(prompt, size);
}
