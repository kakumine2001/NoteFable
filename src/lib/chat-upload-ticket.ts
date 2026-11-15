import { randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { getCookieSecret } from "@/lib/env";
import { getUploadValidationError } from "@/lib/client-files";
import { AttachmentValidationError } from "@/lib/files";
import { msg } from "@/lib/i18n/translate";

export type ChatUploadTicket = { userId: string; path: string; name: string; type: string; size: number };
const key = () => new TextEncoder().encode(getCookieSecret());
// 署名済みチケットの用途（JWT の audience）。画面には出ない内部の値なので改名しない（変えるとデプロイをまたぐ発行済みチケットが通らなくなる）。
const purpose = "studymate-chat-upload";

export function validateUploadMetadata(value: unknown): { name: string; type: string; size: number }[] {
  if (!Array.isArray(value)) throw new AttachmentValidationError(msg("Invalid attachment list."));
  const files = value.map((item) => {
    if (!item || typeof item.name !== "string" || !item.name || item.name.length > 255 || typeof item.type !== "string" || item.type.length > 128 || !Number.isSafeInteger(item.size) || item.size <= 0) {
      throw new AttachmentValidationError(msg("Invalid attachment metadata."));
    }
    return { name: item.name, type: item.type || "application/octet-stream", size: item.size };
  });
  const error = getUploadValidationError(files, { supportsImages: true, claudeImages: false });
  if (error) throw new AttachmentValidationError(error, 413);
  return files;
}

export async function issueUploadTicket(userId: string, file: { name: string; type: string; size: number }) {
  const path = `chat-uploads/${userId}/${Date.now()}-${randomUUID()}`;
  const claims: ChatUploadTicket = { userId, path, ...file };
  const ticket = await new SignJWT(claims).setProtectedHeader({ alg: "HS256" }).setAudience(purpose).setIssuedAt().setExpirationTime("1h").sign(key());
  return { ticket, path };
}

export async function verifyUploadTicket(ticket: unknown, userId: string): Promise<ChatUploadTicket> {
  try {
    if (typeof ticket !== "string" || ticket.length > 8192) throw new Error();
    const { payload } = await jwtVerify(ticket, key(), { algorithms: ["HS256"], audience: purpose });
    const claims = payload as unknown as ChatUploadTicket;
    validateUploadMetadata([claims]);
    if (claims.userId !== userId || !new RegExp(`^chat-uploads/${userId}/[0-9]+-[a-f0-9-]{36}$`).test(claims.path)) throw new Error();
    return claims;
  } catch {
    throw new AttachmentValidationError(msg("Attachment expired or belongs to another user. Please upload it again."), 403);
  }
}
