import { NextResponse } from "next/server";
import { getOrCreateAnonymousUser } from "@/lib/auth";
import { noteApiError } from "@/lib/note-api";
import { NoteValidationError } from "@/lib/note-document";
import { MAX_NOTE_GROUPS, readSmallJson, validGroupName } from "@/lib/note-groups";
import { prisma } from "@/lib/prisma";

// グループを作る。並びは最後尾。
export async function POST(request: Request) {
  try {
    const name = validGroupName((await readSmallJson(request)).name);
    const user = await getOrCreateAnonymousUser();
    const group = await prisma.$transaction(async (tx) => {
      const existing = await tx.noteGroup.aggregate({ where: { userId: user.id }, _count: true, _max: { position: true } });
      if (existing._count >= MAX_NOTE_GROUPS) throw new NoteValidationError(`You can have at most ${MAX_NOTE_GROUPS} groups.`);
      return tx.noteGroup.create({
        data: { userId: user.id, name, position: (existing._max.position ?? -1) + 1 },
        select: { id: true, name: true, position: true },
      });
    });
    return NextResponse.json({ group }, { status: 201 });
  } catch (error) { return noteApiError(error); }
}
