import { NextResponse } from "next/server";
import { getOrCreateAnonymousUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readSmallJson } from "@/lib/note-groups";
import { projectError, validProjectName } from "@/lib/chat-project-api";
import { NoteValidationError } from "@/lib/note-document";

export async function GET() {
  try {
    const user = await getOrCreateAnonymousUser();
    const projects = await prisma.chatProject.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } });
    return NextResponse.json({ projects });
  } catch (error) { return projectError(error); }
}
export async function POST(request: Request) {
  try {
    const name = validProjectName((await readSmallJson(request)).name);
    const user = await getOrCreateAnonymousUser();
    const project = await prisma.$transaction(async tx => {
      // Serialize creations for this owner so the limit also holds for concurrent requests.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${user.id}))`;
      if (await tx.chatProject.count({ where: { userId: user.id } }) >= 50) throw new NoteValidationError("You can have at most 50 projects.");
      return tx.chatProject.create({ data: { userId: user.id, name }, select: { id: true, name: true } });
    });
    return NextResponse.json({ project }, { status: 201 });
  } catch (error) { return projectError(error); }
}
