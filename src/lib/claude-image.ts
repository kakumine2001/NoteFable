import sharp from "sharp";
import { MAX_CLAUDE_IMAGE_BYTES } from "@/lib/upload-limits";

// These are internal transport budgets, not upload limits. Originals stay intact.
export async function prepareClaudeImage(original: Buffer, mimeType: string, maxBytes = MAX_CLAUDE_IMAGE_BYTES) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1024) throw new Error("Invalid Claude image budget.");
  const options = { limitInputPixels: 80_000_000, sequentialRead: true };
  const metadata = await sharp(original, options).metadata();
  if (!metadata.width || !metadata.height) throw new Error("Unable to decode this image.");
  if (original.byteLength <= maxBytes && metadata.width <= 8000 && metadata.height <= 8000) {
    return { buffer: original, mimeType, compressed: false };
  }

  // Start with good JPEG quality and keep full dimensions where practical.
  // Resize only when needed; never crop or change the saved original.
  let edge = Math.min(8000, Math.max(metadata.width, metadata.height));
  for (let attempt = 0; attempt < 12; attempt++) {
    const buffer = await sharp(original, options).rotate().flatten({ background: "#ffffff" })
      .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: attempt < 2 ? 90 - attempt * 10 : 75, chromaSubsampling: "4:4:4" }).toBuffer();
    if (buffer.byteLength <= maxBytes) return { buffer, mimeType: "image/jpeg", compressed: true };
    if (attempt >= 1) edge = Math.max(64, Math.floor(edge * 0.75));
  }
  throw new Error("Unable to prepare this image for Claude.");
}
