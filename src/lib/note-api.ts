import { NextResponse } from "next/server";
import { NoteValidationError } from "@/lib/note-document";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";

export async function limitNoteWrite(request: Request) {
  const limit = await checkRateLimit(request, { namespace: "pages-write", limit: 180, windowMs: 60_000 });
  return limit.limited ? NextResponse.json({ error: "Too many page changes. Try again shortly." }, { status: 429, headers: rateLimitHeaders(limit) }) : null;
}

export function noteApiError(error: unknown) {
  if (error instanceof NoteValidationError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("Page request failed", error);
  return NextResponse.json({ error: "Database is unavailable. Your unsaved draft has been kept." }, { status: 503 });
}
