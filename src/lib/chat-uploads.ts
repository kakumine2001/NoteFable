import { head, list, del } from "@vercel/blob";
import { optionalEnv } from "@/lib/env";
import { verifyUploadTicket } from "@/lib/chat-upload-ticket";
import { AttachmentValidationError, validateAttachmentFiles } from "@/lib/files";
import { readStoredImage, deleteStoredImage } from "@/lib/storage";
import { MAX_UPLOAD_FILES, MAX_CLAUDE_IMAGE_TOTAL_BYTES } from "@/lib/upload-limits";

export function parseUploadReferences(value: unknown): string[] {
  if (value == null || value === "") return [];
  let parsed: unknown;
  try { parsed = typeof value === "string" ? JSON.parse(value) : value; } catch { throw new AttachmentValidationError("Invalid attachment references."); }
  if (!Array.isArray(parsed) || parsed.length > MAX_UPLOAD_FILES || parsed.some((item) => typeof item !== "string") || new Set(parsed).size !== parsed.length) throw new AttachmentValidationError("Invalid attachment references.");
  return parsed;
}

export async function removeChatUploads(tickets: string[], userId: string) {
  await Promise.allSettled(tickets.map(async (ticket) => {
    const claims = await verifyUploadTicket(ticket, userId);
    await deleteStoredImage(claims.path);
  }));
}

export async function loadChatUploads(tickets: string[], userId: string, legacy: File[] = [], maxImageBytes?: number) {
  const claims = await Promise.all(tickets.map((ticket) => verifyUploadTicket(ticket, userId)));
  // Check the complete set before reading any file content.
  const metadata = claims.map((item) => ({ name: item.name, type: item.type, size: item.size } as File));
  validateAttachmentFiles([...legacy, ...metadata]);
  if (maxImageBytes && metadata.some((item) => item.type.startsWith("image/") && item.size > maxImageBytes)) throw new AttachmentValidationError("Claude images must be 5 MiB or smaller. Choose a smaller image.", 413);
  if (maxImageBytes && [...legacy, ...metadata].filter((item) => item.type.startsWith("image/")).reduce((sum, item) => sum + item.size, 0) > MAX_CLAUDE_IMAGE_TOTAL_BYTES) throw new AttachmentValidationError("Claude images exceed 20 MiB in total.", 413);
  const files = [...legacy];
  try {
    for (const item of claims) {
      if (optionalEnv("BLOB_READ_WRITE_TOKEN")) {
        const info = await head(item.path);
        if (info.size !== item.size || info.contentType !== item.type) throw new AttachmentValidationError("Uploaded file does not match its attachment metadata.");
      }
      const buffer = await readStoredImage(item.path, item.size);
      if (buffer.length !== item.size) throw new AttachmentValidationError("Incomplete attachment upload. Please try again.");
      files.push(new File([new Uint8Array(buffer)], item.name, { type: item.type }));
    }
    return files;
  } finally {
    await removeChatUploads(tickets, userId);
  }
}

// Reap abandoned uploads for this user on the next upload. Keep the scope narrow.
export async function cleanupExpiredChatUploads(userId: string) {
  if (!optionalEnv("BLOB_READ_WRITE_TOKEN")) return;
  let cursor: string | undefined;
  for (let page = 0; page < 3; page++) {
    const result = await list({ prefix: `chat-uploads/${userId}/`, limit: 1000, cursor });
    const stale = result.blobs.filter((blob) => blob.uploadedAt.getTime() < Date.now() - 2 * 60 * 60 * 1000);
    if (stale.length) await del(stale.map((blob) => blob.pathname));
    if (!result.hasMore) break;
    cursor = result.cursor;
  }
}
