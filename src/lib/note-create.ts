import type { Prisma } from "@/generated/prisma/client";
import { assertCoverOwner, claimCover } from "@/lib/note-covers";
import { assertNoteFilesOwner } from "@/lib/note-files";
import type { NoteContent } from "@/types/notes";
import { prisma } from "@/lib/prisma";

// 検証済みの本文から新しいページを作る。POST /api/pages と回答からの保存（/api/pages/from-answer）が同じ手順を通る。
export async function createNotePage(userId: string, content: NoteContent) {
  assertCoverOwner(content.cover, userId);
  assertNoteFilesOwner(content.blocks, userId);
  return prisma.$transaction(async (tx) => {
    await claimCover(tx, content.cover, userId);
    return tx.notePage.create({ data: { userId, title: content.title, icon: content.icon, cover: content.cover, coverPosition: content.coverPosition, blocks: content.blocks as unknown as Prisma.InputJsonValue } });
  });
}
