import { msg } from "@/lib/i18n/translate";
import { storageLimitFromUpload } from "@/lib/storage-limit-client";
import { MAX_STORED_FILE_BYTES, usageLimitErrorFrom } from "@/lib/usage-plans";

// スライドの画像（画面側）：note-files へのアップロード、チャットの画像の取り込み、AI での生成。どれも自分の note-files の URL を返す。
// 容量の上限で断られたときは、ノートと同じく画面に案内を出す（storage-limit-client.ts）。

export type SlideImage = { url: string; name: string; width: number; height: number; prompt?: string };

export const SLIDE_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

// 画像の元の大きさ（置く大きさを決めるため）。読めなければ 16:9。
export function imageSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth || 1600, height: image.naturalHeight || 900 });
    image.onerror = () => resolve({ width: 1600, height: 900 });
    image.src = url;
  });
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

export type GenerateSize = "1536x1024" | "1024x1024" | "1024x1536";

// AI で画像を作る（生成の回数を 1 回使う）。
export async function generateSlideImage(prompt: string, size: GenerateSize): Promise<SlideImage> {
  const response = await fetch("/api/pages/images", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, size }) });
  const data = await readJson(response);
  const usage = usageLimitErrorFrom(response.status, data);
  if (usage) throw usage;
  const storage = storageLimitFromUpload(response.status, data);
  if (storage) throw storage;
  if (!response.ok || !data?.url) throw new Error(data?.error || msg("Could not create the image. Try again."));
  const dims = await imageSize(data.url);
  return { url: data.url, name: data.name ?? "image.png", ...dims, prompt: data.prompt ?? prompt };
}
