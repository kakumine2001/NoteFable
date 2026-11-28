import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { NoteValidationError } from "@/lib/note-document";
import { MAX_GROUP_NAME } from "@/lib/note-groups";
import { MAX_PROJECT_INSTRUCTIONS, MAX_PROJECT_NOTES, type ChatProjectSummary } from "@/types/chat";
import { msg, fmt } from "@/lib/i18n/translate";
export { MAX_PROJECT_INSTRUCTIONS, MAX_PROJECT_NOTES };
export function validProjectName(value: unknown) {
  const name = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  if (!name) throw new NoteValidationError(msg("Enter a project name."));
  if (name.length > MAX_GROUP_NAME) throw new NoteValidationError(fmt("Project names can have at most {max} characters.", { max: MAX_GROUP_NAME }));
  if (/[\u0000-\u001f\u007f]/.test(name)) throw new NoteValidationError(msg("Project names cannot contain control characters."));
  return name;
}
// 共通指示。前後の空白を落とし、空文字と null は「指示なし」(null) として扱う。改行とタブ以外の制御文字は受け付けない。
export function validProjectInstructions(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new NoteValidationError(msg("Instructions must be text."));
  const text = value.replace(/\r\n?/g, "\n").trim();
  if (text.length > MAX_PROJECT_INSTRUCTIONS) throw new NoteValidationError(fmt("Instructions can have at most {max} characters.", { max: MAX_PROJECT_INSTRUCTIONS }));
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) throw new NoteValidationError(msg("Instructions cannot contain control characters."));
  return text || null;
}
// 参照ノートの ID 一覧（全置き換え）。重複と上限超えは受け付けない。存在と所有は呼び出し側が DB で確かめる。
export function validProjectNoteIds(value: unknown): string[] {
  if (!Array.isArray(value)) throw new NoteValidationError("noteIds must be a list of note IDs.");
  if (value.length > MAX_PROJECT_NOTES) throw new NoteValidationError(fmt("A project can have at most {max} reference pages.", { max: MAX_PROJECT_NOTES }));
  const ids = value.map(id => typeof id === "string" ? id.trim() : "");
  if (ids.some(id => !id || id.length > 100)) throw new NoteValidationError("noteIds must be a list of note IDs.");
  if (new Set(ids).size !== ids.length) throw new NoteValidationError(msg("Each page can be chosen only once."));
  return ids;
}
type ProjectDb = Pick<Prisma.TransactionClient, "chatProject">;
// ゴミ箱のノートは数えない。指示の本文は一覧に載せないので、有無は null かどうかで見る（保存時に空文字は null にしている）。
const COUNT_LIVE_NOTES = { _count: { select: { notes: { where: { note: { deletedAt: null } } } } } } as const;
export async function listProjectSummaries(db: ProjectDb, userId: string): Promise<ChatProjectSummary[]> {
  const [projects, withInstructions] = await Promise.all([
    db.chatProject.findMany({ where: { userId }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, ...COUNT_LIVE_NOTES } }),
    db.chatProject.findMany({ where: { userId, instructions: { not: null } }, select: { id: true } }),
  ]);
  const flagged = new Set(withInstructions.map(project => project.id));
  return projects.map(project => ({ id: project.id, name: project.name, noteCount: project._count.notes, hasInstructions: flagged.has(project.id) }));
}
export async function readProjectSummary(db: ProjectDb, userId: string, projectId: string): Promise<ChatProjectSummary | null> {
  const project = await db.chatProject.findFirst({ where: { id: projectId, userId }, select: { id: true, name: true, instructions: true, ...COUNT_LIVE_NOTES } });
  return project && { id: project.id, name: project.name, noteCount: project._count.notes, hasInstructions: project.instructions !== null };
}
export function projectError(error: unknown) {
  if (error instanceof NoteValidationError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("Chat project request failed", error);
  return NextResponse.json({ error: msg("Could not save the project. Please try again.") }, { status: 503 });
}
