import { NextResponse } from "next/server";
import { NoteValidationError } from "@/lib/note-document";
import { validGroupName } from "@/lib/note-groups";
export function validProjectName(value: unknown) {
  try { return validGroupName(value); }
  catch (error) {
    if (error instanceof NoteValidationError) throw new NoteValidationError(error.message.replace(/group/gi, "project"),error.status);
    throw error;
  }
}
export function projectError(error: unknown) {
  if (error instanceof NoteValidationError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("Chat project request failed", error);
  return NextResponse.json({ error: "Could not save the project. Please try again." }, { status: 503 });
}
