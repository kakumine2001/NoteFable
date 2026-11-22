import { randomBytes } from "crypto";
import { Prisma } from "@/generated/prisma/client";
import { splitHosts } from "@/lib/hosts";
import { isShareRowActive, isValidShareToken, sharePageUrl } from "@/lib/note-share";
import { PAGE_SUMMARY_SELECT } from "@/lib/note-tree-server";
import { databaseSchema, prisma } from "@/lib/prisma";
import type { NotePageFont, NoteShareAncestor, NoteShareState } from "@/types/notes";

const table = () => Prisma.raw(`"${databaseSchema}"."NotePage"`);

type AncestorRow = {
  id: string;
  parentId: string | null;
  title: string;
  icon: string | null;
  shareToken: string | null;
  shareEnabled: boolean;
  shareIncludeSubpages: boolean;
  shareExpiresAt: Date | null;
  shareExcludeFromParent: boolean;
  depth: number;
};

// 再帰 CTE で任意階層の祖先鎖（親→祖父→…）を循環安全に取得する。
async function fetchAncestors(userId: string, startParentId: string): Promise<AncestorRow[]> {
  return prisma.$queryRaw<AncestorRow[]>(Prisma.sql`
    WITH RECURSIVE chain AS (
      SELECT p."id", p."parentId", p."title", p."icon", p."shareToken", p."shareEnabled",
             p."shareIncludeSubpages", p."shareExpiresAt", p."shareExcludeFromParent",
             1 AS depth, ARRAY[p."id"]::text[] AS seen
      FROM ${table()} p
      WHERE p."id" = ${startParentId} AND p."userId" = ${userId} AND p."deletedAt" IS NULL
      UNION ALL
      SELECT p."id", p."parentId", p."title", p."icon", p."shareToken", p."shareEnabled",
             p."shareIncludeSubpages", p."shareExpiresAt", p."shareExcludeFromParent",
             c.depth + 1, c.seen || p."id"
      FROM ${table()} p
      JOIN chain c ON p."id" = c."parentId"
      WHERE p."userId" = ${userId} AND p."deletedAt" IS NULL AND NOT (p."id" = ANY(c.seen))
    )
    SELECT "id", "parentId", "title", "icon", "shareToken", "shareEnabled",
           "shareIncludeSubpages", "shareExpiresAt", "shareExcludeFromParent", depth
    FROM chain
    ORDER BY depth ASC
  `);
}

export function generateShareToken(): string {
  return randomBytes(16).toString("base64url");
}

// 公開共有 URL のオリジン。分域本番は紹介サイト（notefable.com）、単一ホスト環境（Preview・ローカル）は今の要求オリジン。
export function shareOriginForRequest(request: Request): string {
  const split = splitHosts();
  if (split) return split.site;
  return new URL(request.url).origin;
}

export type PublicShareCrumb = { id: string; title: string; icon: string | null };

export type ResolvedPublicShare = {
  token: string;
  root: {
    id: string;
    userId: string;
    title: string;
    icon: string | null;
    shareIncludeSubpages: boolean;
    shareExpiresAt: Date | null;
  };
  page: {
    id: string;
    userId: string;
    title: string;
    icon: string | null;
    cover: string | null;
    coverPosition: number | null;
    blocks: unknown;
    fullWidth: boolean;
    smallText: boolean;
    font: NotePageFont;
    updatedAt: Date;
  };
  breadcrumbs: PublicShareCrumb[];
  children: PublicShareCrumb[];
};

const PUBLIC_PAGE_SELECT = {
  id: true,
  userId: true,
  parentId: true,
  title: true,
  icon: true,
  cover: true,
  coverPosition: true,
  blocks: true,
  fullWidth: true,
  smallText: true,
  font: true,
  deletedAt: true,
  shareToken: true,
  shareEnabled: true,
  shareIncludeSubpages: true,
  shareExpiresAt: true,
  shareExcludeFromParent: true,
  updatedAt: true,
} satisfies Prisma.NotePageSelect;

function normalizeFont(value: string): NotePageFont {
  return value === "serif" || value === "mono" ? value : "default";
}

// 公開トークン（と任意のサブページ ID）から閲覧可能なページ・パンくず・直下の公開サブページを解決する。
// 非公開・期限切れ・ゴミ箱・親からの除外・別ユーザーのページはすべて null。
export async function resolvePublicShare(
  token: string,
  requestedPageId?: string | null,
  now = new Date(),
): Promise<ResolvedPublicShare | null> {
  if (!isValidShareToken(token)) return null;
  const root = await prisma.notePage.findFirst({
    where: { shareToken: token, deletedAt: null },
    select: PUBLIC_PAGE_SELECT,
  });
  if (!root || !isShareRowActive(root, now)) return null;

  let target = root;
  const breadcrumbs: PublicShareCrumb[] = [{ id: root.id, title: root.title, icon: root.icon }];

  if (requestedPageId && requestedPageId !== root.id) {
    if (!root.shareIncludeSubpages) return null;
    const requested = await prisma.notePage.findFirst({
      where: { id: requestedPageId, userId: root.userId, deletedAt: null },
      select: PUBLIC_PAGE_SELECT,
    });
    if (!requested || requested.shareExcludeFromParent) return null;

    // 要求ページから親をたどり、すべての途中ページが未削除かつ非除外で root に到達するか確かめる。
    const chain: PublicShareCrumb[] = [{ id: requested.id, title: requested.title, icon: requested.icon }];
    let reachedRoot = false;
    if (requested.parentId === root.id) {
      reachedRoot = true;
    } else if (requested.parentId) {
      const ancestors = await fetchAncestors(root.userId, requested.parentId);
      for (const ancestor of ancestors) {
        if (ancestor.id === root.id) {
          reachedRoot = true;
          break;
        }
        if (ancestor.shareExcludeFromParent) return null;
        chain.push({ id: ancestor.id, title: ancestor.title, icon: ancestor.icon });
      }
    }
    if (!reachedRoot) return null;
    chain.reverse();
    breadcrumbs.push(...chain);
    target = requested;
  }

  const children = root.shareIncludeSubpages
    ? await prisma.notePage.findMany({
        where: { userId: root.userId, parentId: target.id, deletedAt: null, shareExcludeFromParent: false },
        orderBy: [{ position: "asc" }, { createdAt: "desc" }, { id: "desc" }],
        select: { id: true, title: true, icon: true },
      })
    : [];

  return {
    token,
    root: {
      id: root.id,
      userId: root.userId,
      title: root.title,
      icon: root.icon,
      shareIncludeSubpages: root.shareIncludeSubpages,
      shareExpiresAt: root.shareExpiresAt,
    },
    page: {
      id: target.id,
      userId: target.userId,
      title: target.title,
      icon: target.icon,
      cover: target.cover,
      coverPosition: target.coverPosition,
      blocks: target.blocks,
      fullWidth: target.fullWidth,
      smallText: target.smallText,
      font: normalizeFont(target.font),
      updatedAt: target.updatedAt,
    },
    breadcrumbs,
    children,
  };
}

// 所有者向け: このページの共有状態（自身の設定 + 親からの継承状態）を返す。
export async function resolveOwnerShareState(
  userId: string,
  pageId: string,
  origin: string,
  now = new Date(),
): Promise<NoteShareState | null> {
  const page = await prisma.notePage.findFirst({
    where: { id: pageId, userId, deletedAt: null },
    select: {
      id: true,
      parentId: true,
      deletedAt: true,
      shareToken: true,
      shareEnabled: true,
      shareIncludeSubpages: true,
      shareExpiresAt: true,
      shareExcludeFromParent: true,
    },
  });
  if (!page) return null;

  let inheritedFrom: NoteShareAncestor | null = null;
  if (page.parentId) {
    const ancestors = await fetchAncestors(userId, page.parentId);
    for (const ancestor of ancestors) {
      if (isShareRowActive(ancestor, now) && ancestor.shareIncludeSubpages && ancestor.shareToken) {
        inheritedFrom = {
          id: ancestor.id,
          title: ancestor.title,
          icon: ancestor.icon,
          token: ancestor.shareToken,
          url: sharePageUrl(ancestor.shareToken, origin),
          expiresAt: ancestor.shareExpiresAt ? ancestor.shareExpiresAt.toISOString() : null,
        };
        break;
      }
      // 途中の親がすでに「親の共有から除外」されているなら、さらに上の公開は降りてこない。
      if (ancestor.shareExcludeFromParent) break;
    }
  }

  const active = isShareRowActive(page, now);
  const expired = Boolean(page.shareEnabled && page.shareExpiresAt && page.shareExpiresAt.getTime() <= now.getTime());
  return {
    enabled: page.shareEnabled,
    active,
    expired,
    token: page.shareToken,
    url: page.shareToken ? sharePageUrl(page.shareToken, origin) : null,
    includeSubpages: page.shareIncludeSubpages,
    expiresAt: page.shareExpiresAt ? page.shareExpiresAt.toISOString() : null,
    excludeFromParent: page.shareExcludeFromParent,
    hasParent: Boolean(page.parentId),
    inheritedFrom,
    inheritedUrl: inheritedFrom && !page.shareExcludeFromParent ? sharePageUrl(inheritedFrom.token, origin, page.id) : null,
  };
}

export type ShareMetaUpdate = {
  // 初回公開時のトークン発行。既存トークンがある場合は上書きせず COALESCE で保持する。
  ensureToken?: string;
  shareEnabled?: boolean;
  shareIncludeSubpages?: boolean;
  shareExpiresAt?: Date | null;
  shareExcludeFromParent?: boolean;
};

// 共有設定はメタデータなので、本文の version や updatedAt を変えない（自動保存と衝突させない）。
export async function updatePageShareMeta(userId: string, pageId: string, data: ShareMetaUpdate) {
  const sets: Prisma.Sql[] = [];
  if (data.ensureToken !== undefined) {
    sets.push(Prisma.sql`"shareToken" = COALESCE("shareToken", ${data.ensureToken})`);
  }
  if (data.shareEnabled !== undefined) sets.push(Prisma.sql`"shareEnabled" = ${data.shareEnabled}`);
  if (data.shareIncludeSubpages !== undefined) sets.push(Prisma.sql`"shareIncludeSubpages" = ${data.shareIncludeSubpages}`);
  if (data.shareExpiresAt !== undefined) sets.push(Prisma.sql`"shareExpiresAt" = ${data.shareExpiresAt}`);
  if (data.shareExcludeFromParent !== undefined) sets.push(Prisma.sql`"shareExcludeFromParent" = ${data.shareExcludeFromParent}`);
  if (!sets.length) return 0;
  return prisma.$executeRaw(
    Prisma.sql`UPDATE ${table()} SET ${Prisma.join(sets, ", ")} WHERE "id" = ${pageId} AND "userId" = ${userId} AND "deletedAt" IS NULL`,
  );
}

export function sharedPageSummary(userId: string, pageId: string) {
  return prisma.notePage.findFirst({ where: { id: pageId, userId, deletedAt: null }, select: PAGE_SUMMARY_SELECT });
}
