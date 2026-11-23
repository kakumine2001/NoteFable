import { NextResponse } from "next/server";
import { NoteValidationError } from "@/lib/note-document";
import { msg } from "@/lib/i18n/translate";
import { StorageLimitError, STORAGE_LIMIT_CODE } from "@/lib/usage-plans";

export function noteApiError(error: unknown) {
  if (error instanceof NoteValidationError) return NextResponse.json({ error: error.message }, { status: error.status });
  // ファイル置き場の容量の上限（stored-files.ts の storageLimitResponse と同じ形）。
  if (error instanceof StorageLimitError) return NextResponse.json({ error: error.message, code: STORAGE_LIMIT_CODE, tier: error.tier, used: error.used, limit: error.limit }, { status: 413 });
  console.error("Note request failed", error);
  return NextResponse.json({ error: msg("Database is unavailable. Your unsaved draft has been kept.") }, { status: 503 });
}
