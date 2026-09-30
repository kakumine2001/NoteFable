import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { getOrCreateAnonymousUser } from "@/lib/auth";
import { limitNoteWrite, noteApiError } from "@/lib/note-api";
import { readNoteRequest, validateNoteContent } from "@/lib/note-document";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const user = await getOrCreateAnonymousUser();
    const pages = await prisma.notePage.findMany({
      where: { userId: user.id }, orderBy: { updatedAt: "desc" },
      select: { id: true, title: true, version: true, createdAt: true, updatedAt: true },
    });
    return NextResponse.json({ pages }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return noteApiError(error); }
}

export async function POST(request: Request) {
  try {
    const limited = await limitNoteWrite(request);
    if (limited) return limited;
    const content = validateNoteContent(await readNoteRequest(request));
    const user = await getOrCreateAnonymousUser();
    const page = await prisma.notePage.create({ data: { userId: user.id, title: content.title, blocks: content.blocks as unknown as Prisma.InputJsonValue } });
    return NextResponse.json({ page }, { status: 201 });
  } catch (error) { return noteApiError(error); }
}
