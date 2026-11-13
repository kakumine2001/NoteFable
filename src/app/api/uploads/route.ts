import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { getOrCreateAnonymousUser } from "@/lib/auth";
import { optionalEnv } from "@/lib/env";
import { issueUploadTicket, validateUploadMetadata, verifyUploadTicket } from "@/lib/chat-upload-ticket";
import { cleanupExpiredChatUploads, parseUploadReferences, removeChatUploads } from "@/lib/chat-uploads";
import { AttachmentValidationError } from "@/lib/files";
import { readLimitedBody } from "@/lib/note-upload";
import { msg } from "@/lib/i18n/translate";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const raw = await readLimitedBody(request, 64 * 1024);
    if (!raw) throw new AttachmentValidationError(msg("Upload request is too large."), 413);
    const body = JSON.parse(new TextDecoder().decode(raw));
    const user = await getOrCreateAnonymousUser();
    if (body.type === "blob.generate-client-token") {
      const result = await handleUpload({
        request, body: body as HandleUploadBody,
        onBeforeGenerateToken: async (pathname, clientPayload) => {
          const claims = await verifyUploadTicket(clientPayload, user.id);
          if (pathname !== claims.path) throw new AttachmentValidationError(msg("Invalid upload destination."), 403);
          return { allowedContentTypes: [claims.type], maximumSizeInBytes: claims.size, addRandomSuffix: false, allowOverwrite: false, validUntil: Date.now() + 15 * 60 * 1000 };
        },
      });
      return NextResponse.json(result);
    }
    const metadata = validateUploadMetadata(body.files);
    if (process.env.VERCEL === "1" && !optionalEnv("BLOB_READ_WRITE_TOKEN")) throw new Error(msg("Attachment storage is unavailable."));
    await cleanupExpiredChatUploads(user.id);
    const uploads = await Promise.all(metadata.map((file) => issueUploadTicket(user.id, file)));
    return NextResponse.json({ uploads, mode: optionalEnv("BLOB_READ_WRITE_TOKEN") ? "blob" : "local" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof AttachmentValidationError ? error.message : msg("Unable to prepare attachment upload. Please try again.") }, { status: error instanceof AttachmentValidationError ? error.status : 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const raw = await readLimitedBody(request, 128 * 1024);
    if (!raw) throw new Error();
    const body = JSON.parse(new TextDecoder().decode(raw));
    const user = await getOrCreateAnonymousUser();
    const tickets = parseUploadReferences(body.uploads);
    await removeChatUploads(tickets, user.id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: msg("Invalid upload cleanup request.") }, { status: 400 });
  }
}
