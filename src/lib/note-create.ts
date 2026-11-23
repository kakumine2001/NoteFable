import type { Prisma } from "@/generated/prisma/client";
import { assertCoverOwner, claimCover } from "@/lib/note-covers";
import { assertNoteFilesOwner } from "@/lib/note-files";
import { claimNoteFiles } from "@/lib/stored-files";
import { lockNoteOrder, resolveParent } from "@/lib/note-tree-server";
import type { NoteContent } from "@/types/notes";
import { prisma } from "@/lib/prisma";

// 検証済みの本文から新しいページを作る。POST /api/pages と回答からの保存（/api/pages/from-answer）が同じ手順を通る。
// parentId を渡すとそのページのサブページになり、グループは親と同じになる。
export async function createNotePage(userId: string, content: NoteContent, { parentId = null }: { parentId?: string | null } = {}) {
  assertCoverOwner(content.cover, userId);
  assertCoverOwner(content.icon, userId, "icon");
  assertNoteFilesOwner(content.blocks, userId);
  return prisma.$transaction(async (tx) => {
    let groupId: string | null = null;
    if (parentId) {
      // 親の移動・ゴミ箱と同時に作られても、ゴミ箱の親の下に作らない。
      await lockNoteOrder(tx, userId);
      groupId = (await resolveParent(tx, userId, null, parentId)).groupId;
    }
    await claimCover(tx, content.cover, userId);
    await claimCover(tx, content.icon, userId, "icon");
    await claimNoteFiles(tx, content.blocks, userId);
    return tx.notePage.create({ data: { userId, parentId, groupId, title: content.title, icon: content.icon, cover: content.cover, coverPosition: content.coverPosition, blocks: content.blocks as unknown as Prisma.InputJsonValue } });
  });
}
