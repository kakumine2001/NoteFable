import { NextResponse } from "next/server";
import { getOrCreateAnonymousUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readSmallJson } from "@/lib/note-groups";
import { projectError, validProjectName } from "@/lib/chat-project-api";
type Context = { params: Promise<{ projectId: string }> };
export async function PATCH(request: Request, context: Context) {
  try {
    const name = validProjectName((await readSmallJson(request)).name);
    const user = await getOrCreateAnonymousUser();
    const { projectId } = await context.params;
    const result = await prisma.chatProject.updateMany({ where: { id: projectId, userId: user.id }, data: { name } });
    return result.count ? NextResponse.json({ project: { id: projectId, name } }) : NextResponse.json({ error: "Project not found." }, { status: 404 });
  } catch (error) { return projectError(error); }
}
export async function DELETE(_request: Request, context: Context) {
  try {
    const user = await getOrCreateAnonymousUser();
    const { projectId } = await context.params;
    const result = await prisma.chatProject.deleteMany({ where: { id: projectId, userId: user.id } });
    return result.count ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Project not found." }, { status: 404 });
  } catch (error) { return projectError(error); }
}
