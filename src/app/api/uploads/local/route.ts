import { NextResponse } from "next/server";
import { getOrCreateUser } from "@/lib/auth";
import { optionalEnv } from "@/lib/env";
import { verifyUploadTicket } from "@/lib/chat-upload-ticket";
import { readLimitedBody } from "@/lib/note-upload";
import { writeStoredImageAt } from "@/lib/storage";
import { msg } from "@/lib/i18n/translate";

// Binary requests are only used in local development without Blob credentials.
export async function PUT(request: Request) {
  if (process.env.VERCEL === "1" || optionalEnv("BLOB_READ_WRITE_TOKEN")) return NextResponse.json({ error: "Use direct storage uploads." }, { status: 404 });
  try {
    const user = await getOrCreateUser();
    const claims = await verifyUploadTicket(new URL(request.url).searchParams.get("ticket"), user.id);
    const raw = await readLimitedBody(request, claims.size);
    if (!raw) throw new Error(msg("Upload too large."));
    const buffer = Buffer.from(raw);
    if (buffer.length !== claims.size) throw new Error(msg("Incomplete upload."));
    await writeStoredImageAt(claims.path, buffer, claims.type);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: msg("Attachment upload failed. Please try again.") }, { status: 400 });
  }
}
