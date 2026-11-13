import { NextResponse } from "next/server";
import { NoteValidationError } from "@/lib/note-document";
import { msg } from "@/lib/i18n/translate";

export function noteApiError(error: unknown) {
  if (error instanceof NoteValidationError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("Note request failed", error);
  return NextResponse.json({ error: msg("Database is unavailable. Your unsaved draft has been kept.") }, { status: 503 });
}
