import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { getOrCreateUser } from "@/lib/auth";
import { noteApiError } from "@/lib/note-api";
import { claimCover } from "@/lib/note-covers";
import { NoteValidationError } from "@/lib/note-document";
import { scheduleNoteEmbeddingSync } from "@/lib/note-embeddings";
import { duplicateTitle, MAX_DUPLICATE_PAGES } from "@/lib/note-tree";
import { descendantIds, liveOrderIds, lockNoteOrder, PAGE_SUMMARY_SELECT, writeOrder } from "@/lib/note-tree-server";
import { prisma } from "@/lib/prisma";
import { msg } from "@/lib/i18n/translate";

type Context = { params: Promise<{ pageId: string }> };

// ページを複製する（Notion の「Duplicate」）。サブページも一緒に複製し、元のページのすぐ後ろに並べる。
// 本文・アイコン・カバー・表示設定・グループを写す。お気に入り・履歴・AI の会話は写さない。
// 応答: { page: 複製した最上位のページ（本文つき）, pages: 複製したすべてのページの一覧用の項目, items: 全件の新しい位置 }。
export async function POST(_request: Request, context: Context) {
  try {
    const user = await getOrCreateUser();
    const { pageId } = await context.params;
    const result = await prisma.$transaction(async (tx) => {
      await lockNoteOrder(tx, user.id);
      const root = await tx.notePage.findFirst({ where: { id: pageId, userId: user.id, deletedAt: null } });
      if (!root) throw new NoteValidationError(msg("Note not found."), 404);
      const ids = await descendantIds(tx, user.id, pageId);
      if (ids.length + 1 > MAX_DUPLICATE_PAGES) throw new NoteValidationError(msg("Only pages with up to 99 sub-pages can be duplicated."));
      const children = ids.length ? await tx.notePage.findMany({ where: { id: { in: ids }, userId: user.id, deletedAt: null } }) : [];
      const order = await liveOrderIds(tx, user.id);
      // 親を先に作るため、元の並び順のまま、親が子より前に来るように並べる。
      const sources = [root, ...children.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))];
      const copies = new Map<string, string>();
      const created: string[] = [];
      for (let pass = 0; pass < sources.length && created.length < sources.length; pass++) {
        for (const source of sources) {
          if (copies.has(source.id) || (source.id !== root.id && !copies.has(source.parentId ?? ""))) continue;
          await claimCover(tx, source.cover, user.id);
          const copy = await tx.notePage.create({
            data: {
              userId: user.id, title: source.id === root.id ? duplicateTitle(source.title) : source.title, icon: source.icon, cover: source.cover,
              coverPosition: source.coverPosition, blocks: source.blocks as Prisma.InputJsonValue, groupId: source.groupId,
              parentId: source.id === root.id ? root.parentId : copies.get(source.parentId!)!,
              fullWidth: source.fullWidth, smallText: source.smallText, font: source.font, locked: source.locked,
              shareExcludeFromParent: source.shareExcludeFromParent,
            },
            select: { id: true },
          });
          copies.set(source.id, copy.id);
          created.push(copy.id);
        }
      }
      // 複製は元のページのすぐ後ろへ（子の複製は複製の親の下に並ぶので、全体の中の位置は親の後ろでよい）。
      const next = [...order];
      next.splice(order.indexOf(root.id) + 1, 0, ...sources.map((source) => copies.get(source.id)!).filter(Boolean));
      await writeOrder(tx, user.id, next);
      const page = await tx.notePage.findFirst({ where: { id: copies.get(root.id)!, userId: user.id } });
      const pages = await tx.notePage.findMany({ where: { id: { in: created }, userId: user.id }, select: PAGE_SUMMARY_SELECT });
      // 並びを書き直したので、一覧の全件の新しい位置も返す（画面の並びを並べ替えと同じ方法で更新する）。
      return { page, pages, items: next.map((id, index) => ({ id, position: index + 1 })) };
    });
    scheduleNoteEmbeddingSync(user.id, result.pages.map((p) => p.id));
    return NextResponse.json(result, { status: 201 });
  } catch (error) { return noteApiError(error); }
}
