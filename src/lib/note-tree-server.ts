import { Prisma } from "@/generated/prisma/client";
import { NoteValidationError } from "@/lib/note-document";
import { databaseSchema, prisma } from "@/lib/prisma";
import { msg } from "@/lib/i18n/translate";

// サブページ・お気に入り・ページ設定のサーバー側の処理。
// 位置・親・グループ・お気に入り・設定はメタデータなので、本文の版（version）も updatedAt も変えない（並べ替えと同じく生の SQL で書く）。

type Tx = Prisma.TransactionClient;

// 一覧（GET /api/pages）と、一覧へ 1 件足す応答が返す項目。
export const PAGE_SUMMARY_SELECT = {
  id: true, kind: true, position: true, title: true, icon: true, cover: true, coverPosition: true, version: true, groupId: true, parentId: true, favoritedAt: true,
  fullWidth: true, smallText: true, font: true, locked: true, shareEnabled: true, shareExpiresAt: true, aiUpdatedAt: true, createdAt: true, updatedAt: true,
} satisfies Prisma.NotePageSelect;

export const PAGE_FONTS = ["default", "serif", "mono"] as const;

const table = () => Prisma.raw(`"${databaseSchema}"."NotePage"`);

// 自分の、ゴミ箱に入っていないページの子孫（自分は含めない）。live: false ならゴミ箱の子孫も含める。
export async function descendantIds(tx: Tx, userId: string, rootId: string, { live = true }: { live?: boolean } = {}): Promise<string[]> {
  const liveFilter = live ? Prisma.sql`AND c."deletedAt" IS NULL` : Prisma.empty;
  const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    WITH RECURSIVE tree AS (
      SELECT c."id" FROM ${table()} c WHERE c."parentId" = ${rootId} AND c."userId" = ${userId} ${liveFilter}
      UNION
      SELECT c."id" FROM ${table()} c JOIN tree ON c."parentId" = tree."id" WHERE c."userId" = ${userId} ${liveFilter}
    )
    SELECT "id" FROM tree`);
  return rows.map((row) => row.id).filter((id) => id !== rootId);
}

// 並べ替え・移動・作成・複製で、同じ利用者の一覧の操作を順番に行う（並べ替えの API と同じ鍵）。
export async function lockNoteOrder(tx: Tx, userId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`note-order:${userId}`}))`;
}

// 親として使えるか確かめ、その親のグループを返す。自分自身・自分の子孫は親にできない（輪になる）。
export async function resolveParent(tx: Tx, userId: string, pageId: string | null, parentId: string) {
  if (pageId && parentId === pageId) throw new NoteValidationError(msg("A page cannot be moved into itself."));
  const parent = await tx.notePage.findFirst({ where: { id: parentId, userId, deletedAt: null }, select: { id: true, groupId: true } });
  if (!parent) throw new NoteValidationError(msg("Page not found."), 404);
  if (pageId && (await descendantIds(tx, userId, pageId)).includes(parentId)) throw new NoteValidationError(msg("A page cannot be moved into its own sub-page."));
  return parent;
}

// ページとその子孫のグループをそろえる（子は最上位の祖先と同じグループに属する）。
export async function setSubtreeGroup(tx: Tx, userId: string, pageId: string, groupId: string | null) {
  const ids = [pageId, ...await descendantIds(tx, userId, pageId)];
  await tx.$executeRaw(Prisma.sql`UPDATE ${table()} SET "groupId" = ${groupId} WHERE "id" = ANY(${ids}::text[]) AND "userId" = ${userId}`);
  return ids;
}

// メタデータだけを書く（版と updatedAt は変えない）。
export async function setPageMeta(tx: Tx, userId: string, pageId: string, data: { parentId?: string | null; favoritedAt?: Date | null; fullWidth?: boolean; smallText?: boolean; font?: string; locked?: boolean }) {
  const sets = Object.entries(data).filter(([, value]) => value !== undefined).map(([key, value]) => Prisma.sql`${Prisma.raw(`"${key}"`)} = ${value}`);
  if (!sets.length) return 0;
  return tx.$executeRaw(Prisma.sql`UPDATE ${table()} SET ${Prisma.join(sets, ", ")} WHERE "id" = ${pageId} AND "userId" = ${userId} AND "deletedAt" IS NULL`);
}

// 一覧全体の並びを書き直す（生の SQL：版と updatedAt を変えない）。
export async function writeOrder(tx: Tx, userId: string, ids: string[]) {
  await tx.$executeRaw(Prisma.sql`UPDATE ${table()} AS t SET "position" = ordering.pos FROM unnest(${ids}::text[]) WITH ORDINALITY AS ordering(id,pos) WHERE t."id" = ordering.id AND t."userId" = ${userId}`);
}

export async function liveOrderIds(tx: Tx, userId: string) {
  const rows = await tx.notePage.findMany({ where: { userId, deletedAt: null }, orderBy: [{ position: "asc" }, { createdAt: "desc" }, { id: "desc" }], select: { id: true } });
  return rows.map((row) => row.id);
}

export function pageSummary(userId: string, pageId: string) {
  return prisma.notePage.findFirst({ where: { id: pageId, userId, deletedAt: null }, select: PAGE_SUMMARY_SELECT });
}
