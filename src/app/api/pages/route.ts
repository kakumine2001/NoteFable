import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { getOrCreateAnonymousUser } from "@/lib/auth";
import { noteApiError } from "@/lib/note-api";
import { assertCoverOwner, claimCover } from "@/lib/note-covers";
import { assertNoteFilesOwner } from "@/lib/note-files";
import { readNoteRequest, validateNoteContent } from "@/lib/note-document";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const user = await getOrCreateAnonymousUser();
    const [pages, groups] = await Promise.all([
      prisma.notePage.findMany({
        where: { userId: user.id, deletedAt: null }, orderBy: [{ position: "asc" }, { createdAt: "desc" }, { id: "desc" }],
        select: { id: true, position: true, title: true, icon: true, version: true, groupId: true, createdAt: true, updatedAt: true },
      }),
      prisma.noteGroup.findMany({ where: { userId: user.id }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: { id: true, name: true, position: true } }),
    ]);
    return NextResponse.json({ pages, groups }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return noteApiError(error); }
}

export async function POST(request: Request) {
  try {
    const content = validateNoteContent(await readNoteRequest(request));
    const user = await getOrCreateAnonymousUser();
    assertCoverOwner(content.cover, user.id);
    assertNoteFilesOwner(content.blocks, user.id);
    const page = await prisma.$transaction(async (tx) => {
      await claimCover(tx, content.cover, user.id);
      return tx.notePage.create({ data: { userId: user.id, title: content.title, icon: content.icon, cover: content.cover, coverPosition: content.coverPosition, blocks: content.blocks as unknown as Prisma.InputJsonValue } });
    });
    return NextResponse.json({ page }, { status: 201 });
  } catch (error) { return noteApiError(error); }
}
