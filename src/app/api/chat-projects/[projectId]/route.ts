import { NextResponse } from "next/server";
import { getOrCreateUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readSmallJson } from "@/lib/note-groups";
import { NoteValidationError } from "@/lib/note-document";
import { projectError, readProjectSummary, validProjectInstructions, validProjectName, validProjectNoteIds } from "@/lib/chat-project-api";
import { msg } from "@/lib/i18n/translate";
type Context = { params: Promise<{ projectId: string }> };
const NOT_FOUND = { error: msg("Project not found.") };
// 設定画面用。ゴミ箱のノートは含めず、選んだ順に返す。
export async function GET(_request: Request, context: Context) {
  try {
    const user = await getOrCreateUser();
    const { projectId } = await context.params;
    const project = await prisma.chatProject.findFirst({
      where: { id: projectId, userId: user.id },
      select: {
        id: true, name: true, instructions: true,
        notes: { where: { note: { userId: user.id, deletedAt: null } }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: { note: { select: { id: true, title: true, icon: true } } } },
      },
    });
    if (!project) return NextResponse.json(NOT_FOUND, { status: 404 });
    return NextResponse.json({ project: { id: project.id, name: project.name, instructions: project.instructions, notes: project.notes.map(row => row.note) } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return projectError(error); }
}
// name / instructions / noteIds のどれか（複数可）を更新する。noteIds は全置き換えで、1 つでも自分の生きたノートでなければ何も書き込まない。
export async function PATCH(request: Request, context: Context) {
  try {
    // 指示は最大 4000 文字で、JSON のエスケープ分を見込んで既定より大きく許可する。
    const body = await readSmallJson(request, 16384);
    const data: { name?: string; instructions?: string | null } = {};
    if ("name" in body) data.name = validProjectName(body.name);
    if ("instructions" in body) data.instructions = validProjectInstructions(body.instructions);
    const noteIds = "noteIds" in body ? validProjectNoteIds(body.noteIds) : undefined;
    if (!Object.keys(data).length && !noteIds) throw new NoteValidationError(msg("Nothing to update."));
    const user = await getOrCreateUser();
    const { projectId } = await context.params;
    const project = await prisma.$transaction(async tx => {
      // 同じプロジェクトへの置き換えが重なっても、削除と作成が入り交じらないようにする。
      if (noteIds) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${projectId}))`;
      if (!await tx.chatProject.findFirst({ where: { id: projectId, userId: user.id }, select: { id: true } })) throw new NoteValidationError(NOT_FOUND.error, 404);
      // 検証を書き込みより先に済ませて、失敗時に一部だけ保存されないようにする。
      if (noteIds?.length) {
        const live = await tx.notePage.findMany({ where: { id: { in: noteIds }, userId: user.id, deletedAt: null }, select: { id: true } });
        if (live.length !== noteIds.length) throw new NoteValidationError(msg("One or more of the selected notes could not be found."), 404);
      }
      if (Object.keys(data).length) await tx.chatProject.updateMany({ where: { id: projectId, userId: user.id }, data });
      if (noteIds) {
        await tx.chatProjectNote.deleteMany({ where: { projectId } });
        if (noteIds.length) await tx.chatProjectNote.createMany({ data: noteIds.map((noteId, position) => ({ projectId, noteId, position })) });
      }
      return readProjectSummary(tx, user.id, projectId);
    });
    return project ? NextResponse.json({ project }) : NextResponse.json(NOT_FOUND, { status: 404 });
  } catch (error) { return projectError(error); }
}
export async function DELETE(_request: Request, context: Context) {
  try {
    const user = await getOrCreateUser();
    const { projectId } = await context.params;
    const result = await prisma.chatProject.deleteMany({ where: { id: projectId, userId: user.id } });
    return result.count ? NextResponse.json({ ok: true }) : NextResponse.json(NOT_FOUND, { status: 404 });
  } catch (error) { return projectError(error); }
}
