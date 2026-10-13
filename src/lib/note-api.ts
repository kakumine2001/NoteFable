import { NextResponse } from "next/server";
import { NoteValidationError } from "@/lib/note-document";

export function noteApiError(error: unknown) {
  if (error instanceof NoteValidationError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("Page request failed", error);
  return NextResponse.json({ error: "Database is unavailable. Your unsaved draft has been kept." }, { status: 503 });
}
