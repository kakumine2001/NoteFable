import { msg } from "@/lib/i18n/translate";
import { MAX_NOTE_FILE_BYTES } from "@/lib/note-file-keys";
import {
  MAX_PPTX_IMAGE_DIMENSION,
  MAX_PPTX_IMAGE_PIXELS,
  MAX_PPTX_IMAGE_SIDE,
  type ImageCropRect,
  type PendingPptxImage,
} from "@/lib/slides/pptx/types";

// 画像の先頭バイトから形式を判定し、ブラウザへデコードする前にヘッダーから幅と高さを読む。
// 受け入れる形式は PNG / JPEG / GIF / WebP だけ。EMF / WMF / SVG などは非対応として呼び出し側へ返す。

export type SupportedImageMime = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

export type ImageProbeResult =
  | { ok: true; mimeType: SupportedImageMime; width: number; height: number }
  | { ok: false; reason: "unsupported" | "oversized" | "invalid"; detectedFormat?: string };

const ascii = (bytes: Uint8Array, start: number, len: number) => {
  let out = "";
  for (let i = start; i < start + len && i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]);
  return out;
};

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const u32le = (b: Uint8Array, i: number) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

export function sniffSupportedImageMime(bytes: Uint8Array): SupportedImageMime | null {
  if (bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 6 && /^GIF8[79]a$/.test(ascii(bytes, 0, 6))) {
    return "image/gif";
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    return "image/webp";
  }
  return null;
}

export function detectUnsupportedImageFormat(bytes: Uint8Array, pathHint = ""): string {
  const lower = pathHint.toLowerCase();
  // EMF: EMR_HEADER (0x00000001) + signature " EMF" at offset 40
  if ((bytes.length >= 44 && u32le(bytes, 0) === 1 && ascii(bytes, 40, 4) === " EMF") || lower.endsWith(".emf")) return "emf";
  // WMF: Aldus placeable header D7 CD C6 9A or standard WMF (01 00 09 00 / 02 00 09 00)
  if ((bytes.length >= 4 && ((bytes[0] === 0xd7 && bytes[1] === 0xcd && bytes[2] === 0xc6 && bytes[3] === 0x9a)
    || ((bytes[0] === 0x01 || bytes[0] === 0x02) && bytes[1] === 0x00 && bytes[2] === 0x09 && bytes[3] === 0x00))) || lower.endsWith(".wmf")) {
    return "wmf";
  }
  // SVG: XML or <svg prefix
  const head = ascii(bytes, 0, Math.min(256, bytes.length)).trimStart().toLowerCase();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg")) || lower.endsWith(".svg")) return "svg";
  const ext = lower.split(".").pop();
  return ext && ext.length <= 8 ? ext : "unknown";
}

function pngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24 || ascii(bytes, 12, 4) !== "IHDR") return null;
  const width = u32be(bytes, 16);
  const height = u32be(bytes, 20);
  return width > 0 && height > 0 ? { width, height } : null;
}

function gifDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 10) return null;
  const width = u16le(bytes, 6);
  const height = u16le(bytes, 8);
  return width > 0 && height > 0 ? { width, height } : null;
}

function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  let offset = 2;
  while (offset + 3 < bytes.length) {
    // マーカー先頭の 0xFF パディングを読み飛ばす。
    while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) break;
    const marker = bytes[offset];
    offset += 1;
    // スタンドアロンマーカー（RST0..7, SOI, EOI, TEM）は長さを持たない。
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 1 >= bytes.length) break;
    const segmentLength = u16be(bytes, offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) break;
    const isSof = (marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (offset + 7 > bytes.length) return null;
      const height = u16be(bytes, offset + 3);
      const width = u16be(bytes, offset + 5);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    offset += segmentLength;
  }
  return null;
}

function webpDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 30) return null;
  const chunk = ascii(bytes, 12, 4);
  if (chunk === "VP8 ") {
    // ロッシー WebP のキーフレームヘッダー（フレームタグ 3B + 開始コード 9D 01 2A）。
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
    const width = u16le(bytes, 26) & 0x3fff;
    const height = u16le(bytes, 28) & 0x3fff;
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (chunk === "VP8L") {
    if (bytes[20] !== 0x2f) return null;
    const bits = u32le(bytes, 21);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >> 14) & 0x3fff) + 1;
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (chunk === "VP8X") {
    const width = (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)) + 1;
    const height = (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) + 1;
    return width > 0 && height > 0 ? { width, height } : null;
  }
  return null;
}

export function probePptxImage(bytes: Uint8Array, pathHint = ""): ImageProbeResult {
  const mimeType = sniffSupportedImageMime(bytes);
  if (!mimeType) {
    return { ok: false, reason: "unsupported", detectedFormat: detectUnsupportedImageFormat(bytes, pathHint) };
  }
  let dims: { width: number; height: number } | null = null;
  if (mimeType === "image/png") dims = pngDimensions(bytes);
  else if (mimeType === "image/jpeg") dims = jpegDimensions(bytes);
  else if (mimeType === "image/gif") dims = gifDimensions(bytes);
  else if (mimeType === "image/webp") dims = webpDimensions(bytes);
  if (!dims) return { ok: false, reason: "invalid" };
  if (
    dims.width > MAX_PPTX_IMAGE_DIMENSION
    || dims.height > MAX_PPTX_IMAGE_DIMENSION
    || dims.width * dims.height > MAX_PPTX_IMAGE_PIXELS
  ) {
    return { ok: false, reason: "oversized" };
  }
  return { ok: true, mimeType, width: dims.width, height: dims.height };
}

const MIME_EXT: Record<SupportedImageMime, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

export function extensionForMime(mime: SupportedImageMime): string {
  return MIME_EXT[mime];
}

function hasMeaningfulCrop(crop?: ImageCropRect): crop is ImageCropRect {
  if (!crop) return false;
  return crop.left > 0.002 || crop.top > 0.002 || crop.right > 0.002 || crop.bottom > 0.002;
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), mime, quality));
}

/**
 * アップロード用の画像 Blob を準備する。
 * 切り抜きがなく、4 MiB 以下かつ 2560px 以下なら元のバイト列をそのまま使い（再圧縮による劣化なし）、
 * それ以外はブラウザの canvas で切り抜き・縮小して 4 MiB 以下に収める。
 */
export async function preparePptxImageBlob(image: PendingPptxImage): Promise<{ blob: Blob; mimeType: SupportedImageMime }> {
  const needsCrop = hasMeaningfulCrop(image.crop);
  const needsResize = Math.max(image.width, image.height) > MAX_PPTX_IMAGE_SIDE;
  const needsShrink = image.bytes.byteLength > MAX_NOTE_FILE_BYTES;
  const copy = new Uint8Array(image.bytes.byteLength);
  copy.set(image.bytes);
  const original = new Blob([copy], { type: image.mimeType });
  if (!needsCrop && !needsResize && !needsShrink) {
    return { blob: original, mimeType: image.mimeType };
  }
  if (typeof document === "undefined") {
    if (!needsShrink) return { blob: original, mimeType: image.mimeType };
    throw new Error(msg("Files must be 4 MB or smaller."));
  }
  const url = URL.createObjectURL(original);
  try {
    const el = new Image();
    el.decoding = "async";
    el.src = url;
    await el.decode();
    const natW = el.naturalWidth || image.width;
    const natH = el.naturalHeight || image.height;
    const crop = needsCrop ? image.crop! : { left: 0, top: 0, right: 0, bottom: 0 };
    const sx = Math.max(0, Math.min(natW - 1, Math.round(natW * crop.left)));
    const sy = Math.max(0, Math.min(natH - 1, Math.round(natH * crop.top)));
    const sw = Math.max(1, Math.min(natW - sx, Math.round(natW * Math.max(0.01, 1 - crop.left - crop.right))));
    const sh = Math.max(1, Math.min(natH - sy, Math.round(natH * Math.max(0.01, 1 - crop.top - crop.bottom))));
    const scale = Math.min(1, MAX_PPTX_IMAGE_SIDE / Math.max(sw, sh));
    const dw = Math.max(1, Math.round(sw * scale));
    const dh = Math.max(1, Math.round(sh * scale));
    const canvas = document.createElement("canvas");
    canvas.width = dw;
    canvas.height = dh;
    try {
      const ctx = canvas.getContext("2d");
      if (!ctx) return { blob: original, mimeType: image.mimeType };
      ctx.drawImage(el, sx, sy, sw, sh, 0, 0, dw, dh);
      // 透過を持つ可能性がある PNG / GIF / WebP はまず PNG を試し、4 MiB を超えたら JPEG へ落とす。
      if (image.mimeType !== "image/jpeg") {
        const png = await canvasToBlob(canvas, "image/png");
        if (png && png.size <= MAX_NOTE_FILE_BYTES) return { blob: png, mimeType: "image/png" };
      }
      for (const quality of [0.88, 0.72, 0.55]) {
        const jpeg = await canvasToBlob(canvas, "image/jpeg", quality);
        if (jpeg && jpeg.size <= MAX_NOTE_FILE_BYTES) return { blob: jpeg, mimeType: "image/jpeg" };
      }
      throw new Error(msg("Files must be 4 MB or smaller."));
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  } finally {
    URL.revokeObjectURL(url);
  }
}
