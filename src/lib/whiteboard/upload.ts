import { msg } from "@/lib/i18n/translate";
import { storageLimitFromUpload } from "@/lib/storage-limit-client";

// ホワイトボードの画像を note-files へアップロードする（本体には data: の画像を入れられない。src/lib/canvas-document.ts）。
// Excalidraw は画像を data: URL で持つ。アップロードできる形（JPEG・PNG・WebP・GIF）でないもの（SVG など）は PNG に描き直す。

const UPLOADABLE = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const EXTENSIONS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

async function dataUrlToBlob(dataURL: string): Promise<Blob> {
  const response = await fetch(dataURL);
  return response.blob();
}

// 画像を PNG に描き直す（SVG などのため）。
async function rasterize(blob: Blob): Promise<Blob> {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    const scale = Math.min(1, 4096 / Math.max(image.naturalWidth || 1, image.naturalHeight || 1));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round((image.naturalWidth || 512) * scale));
    canvas.height = Math.max(1, Math.round((image.naturalHeight || 512) * scale));
    canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error(msg("Upload failed. Try again."))), "image/png"));
  } finally { URL.revokeObjectURL(url); }
}

export async function uploadImageBlob(blob: Blob, name: string): Promise<{ url: string; mimeType: string }> {
  const type = UPLOADABLE.has(blob.type) ? blob.type : "image/png";
  const body = UPLOADABLE.has(blob.type) ? blob : await rasterize(blob);
  const form = new FormData();
  form.append("file", new File([body], `${name}.${EXTENSIONS[type]}`, { type }));
  const response = await fetch("/api/pages/files", { method: "POST", body: form });
  const data = await response.json().catch(() => null) as { url?: string; error?: string } | null;
  const storage = storageLimitFromUpload(response.status, data);
  if (storage) throw storage;
  if (!response.ok || !data?.url) throw new Error(data?.error || msg("Upload failed. Try again."));
  return { url: data.url, mimeType: type };
}

export async function uploadWhiteboardImage(dataURL: string, mimeType: string, fileId: string) {
  const blob = await dataUrlToBlob(dataURL);
  const typed = blob.type ? blob : new Blob([blob], { type: mimeType });
  return uploadImageBlob(typed, `whiteboard-${fileId.slice(0, 12)}`);
}
