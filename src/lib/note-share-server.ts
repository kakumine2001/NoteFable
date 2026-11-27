import { randomBytes } from "crypto";
import { Prisma } from "@/generated/prisma/client";
import { splitHosts } from "@/lib/hosts";
import { isShareRowActive, isValidShareToken, shareIconUrl, sharePageUrl } from "@/lib/note-share";
import { isUploadedNoteIcon, noteIconText } from "@/lib/note-icon";
import { PAGE_SUMMARY_SELECT } from "@/lib/note-tree-server";
import { PAGE_KINDS, pageKindFeatures, pageKindOf, type PageKind } from "@/lib/page-kinds";
import { readCanvasDataForShare } from "@/lib/canvas-store";
import { prisma, databaseSchema } from "@/lib/prisma";
import { extractPageCardSummary, isValidPageCardId, MAX_PAGE_CARD_BATCH, type PageCardPreview } from "@/lib/whiteboard/links";
import type { NotePageFont, NoteShareAncestor, NoteShareState } from "@/types/notes";

const table = () => Prisma.raw(`"${databaseSchema}"."NotePage"`);

// 公開用の読み取りビューがある種類だけを公開の木に出す（いまはノートだけ。ホワイトボード・スライドのビューは #152・#149）。
// 出せない種類のページは、その下のサブページごと公開の木から外す（親の共有から除外したのと同じ扱い）。
const SHAREABLE_KINDS = PAGE_KINDS.filter((kind) => pageKindFeatures(kind).publicShare);
const shareable = (row: { kind?: unknown }) => pageKindFeatures(pageKindOf(row)).publicShare;
// スライドは公開の木の「葉」：公開するのはそのスライド自身だけで、その下のサブページは公開しない（放映だけを見せる）。
const leafKind = (row: { kind?: unknown }) => pageKindOf(row) === "slides";

type AncestorRow = {
  id: string;
  kind: string;
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
      SELECT p."id", p."kind"::text AS "kind", p."parentId", p."title", p."icon", p."shareToken", p."shareEnabled",
             p."shareIncludeSubpages", p."shareExpiresAt", p."shareExcludeFromParent",
             1 AS depth, ARRAY[p."id"]::text[] AS seen
      FROM ${table()} p
      WHERE p."id" = ${startParentId} AND p."userId" = ${userId} AND p."deletedAt" IS NULL
      UNION ALL
      SELECT p."id", p."kind"::text AS "kind", p."parentId", p."title", p."icon", p."shareToken", p."shareEnabled",
             p."shareIncludeSubpages", p."shareExpiresAt", p."shareExcludeFromParent",
             c.depth + 1, c.seen || p."id"
      FROM ${table()} p
      JOIN chain c ON p."id" = c."parentId"
      WHERE p."userId" = ${userId} AND p."deletedAt" IS NULL AND NOT (p."id" = ANY(c.seen))
    )
    SELECT "id", "kind", "parentId", "title", "icon", "shareToken", "shareEnabled",
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

// kind はページの種類（パンくず・サブページの一覧のアイコン）。
export type PublicShareCrumb = { id: string; title: string; icon: string | null; kind?: PageKind };

export type ResolvedPublicShare = {
  token: string;
  root: {
    id: string;
    kind?: PageKind;
    userId: string;
    title: string;
    icon: string | null;
    shareIncludeSubpages: boolean;
    shareExpiresAt: Date | null;
  };
  page: {
    id: string;
    // ページの種類。ノートは本文（blocks）を描く。スライドは data（本体）を持ち、放映のビューで見せる。
    // ホワイトボードは本体（NoteCanvas）を /s/:token/scene から読んで描く（data は null）。
    kind: PageKind;
    data: unknown;
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
  kind: true,
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
  if (!root || !shareable(root) || !isShareRowActive(root, now)) return null;

  let target = root;
  const breadcrumbs: PublicShareCrumb[] = [{ id: root.id, title: root.title, icon: root.icon, kind: pageKindOf(root) }];

  if (requestedPageId && requestedPageId !== root.id) {
    if (!root.shareIncludeSubpages || leafKind(root)) return null;
    const requested = await prisma.notePage.findFirst({
      where: { id: requestedPageId, userId: root.userId, deletedAt: null },
      select: PUBLIC_PAGE_SELECT,
    });
    if (!requested || !shareable(requested) || requested.shareExcludeFromParent) return null;

    // 要求ページから親をたどり、すべての途中ページが未削除かつ非除外で root に到達するか確かめる。
    const chain: PublicShareCrumb[] = [{ id: requested.id, title: requested.title, icon: requested.icon, kind: pageKindOf(requested) }];
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
        if (ancestor.shareExcludeFromParent || !shareable(ancestor) || leafKind(ancestor)) return null;
        chain.push({ id: ancestor.id, title: ancestor.title, icon: ancestor.icon, kind: pageKindOf(ancestor) });
      }
    }
    if (!reachedRoot) return null;
    chain.reverse();
    breadcrumbs.push(...chain);
    target = requested;
  }

  const children = root.shareIncludeSubpages && !leafKind(target)
    ? await prisma.notePage.findMany({
        where: { userId: root.userId, parentId: target.id, deletedAt: null, shareExcludeFromParent: false, kind: { in: SHAREABLE_KINDS } },
        orderBy: [{ position: "asc" }, { createdAt: "desc" }, { id: "desc" }],
        select: { id: true, title: true, icon: true, kind: true },
      }).then((rows) => rows.map((row) => ({ id: row.id, title: row.title, icon: row.icon, kind: pageKindOf(row) })))
    : [];

  return {
    token,
    root: {
      id: root.id,
      kind: pageKindOf(root),
      userId: root.userId,
      title: root.title,
      icon: root.icon,
      shareIncludeSubpages: root.shareIncludeSubpages,
      shareExpiresAt: root.shareExpiresAt,
    },
    page: {
      id: target.id,
      kind: pageKindOf(target),
      // スライドの本体（公開の 1 回の読み込みで、ページの行の後に読む）。ノートは blocks を使う。
      data: pageKindOf(target) === "slides" ? await readCanvasDataForShare(target.id) : null,
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
      kind: true,
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
  // 公開できない種類のページ（とその下）は、親が公開中でも公開の木に出ない。
  if (page.parentId && shareable(page)) {
    const ancestors = await fetchAncestors(userId, page.parentId);
    for (const ancestor of ancestors) {
      if (!shareable(ancestor) || leafKind(ancestor)) break;
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
    // スライドは公開の木の葉：サブページを含める設定は無い（含めると、公開の前に下のページまで保存しに行く）。
    includeSubpages: page.shareIncludeSubpages && !leafKind(page),
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

type CardAncestorRow = {
  startId: string;
  id: string;
  kind: string;
  shareExcludeFromParent: boolean;
  depth: number;
};

// 公開ホワイトボード内のページカードについて、同じ公開共有ツリーに属するページだけをまとめて解決する。
// 共有ツリー外・削除済み・親から除外・スライド配下のページは返さず、アップロード画像アイコンの内部キーも外へ出さない。
export async function resolvePublicShareCards(
  token: string,
  root: Pick<ResolvedPublicShare["root"], "id" | "kind" | "userId" | "shareIncludeSubpages">,
  rawIds: readonly string[],
): Promise<Record<string, PageCardPreview>> {
  const uniqueIds: string[] = [];
  const seen = new Set<string>();
  for (const id of rawIds) {
    if (!isValidPageCardId(id) || seen.has(id)) continue;
    seen.add(id);
    uniqueIds.push(id);
    if (uniqueIds.length >= MAX_PAGE_CARD_BATCH) break;
  }
  if (!uniqueIds.length) return {};

  const allowSubpages = root.shareIncludeSubpages && (root.kind ?? "note") !== "slides";
  const queryIds = allowSubpages ? uniqueIds : uniqueIds.filter((id) => id === root.id);
  if (!queryIds.length) return {};

  const rows = await prisma.notePage.findMany({
    where: { id: { in: queryIds }, userId: root.userId, deletedAt: null },
    select: {
      id: true,
      kind: true,
      parentId: true,
      title: true,
      icon: true,
      blocks: true,
      shareExcludeFromParent: true,
      canvas: { select: { segments: true } },
    },
  });
  if (!rows.length) return {};

  const candidates = rows.filter((row) => row.id === root.id || (allowSubpages && shareable(row) && !row.shareExcludeFromParent));
  const startParentIds = [...new Set(
    candidates
      .filter((row) => row.id !== root.id && row.parentId !== null && row.parentId !== root.id)
      .map((row) => row.parentId as string),
  )];

  const validStarts = new Set<string>();
  if (startParentIds.length) {
    const ancestors = await prisma.$queryRaw<CardAncestorRow[]>(Prisma.sql`
      WITH RECURSIVE chain AS (
        SELECT p."id" AS "startId", p."id", p."kind"::text AS "kind", p."parentId",
               p."shareExcludeFromParent", 1 AS depth, ARRAY[p."id"]::text[] AS seen
        FROM ${table()} p
        WHERE p."id" = ANY(${startParentIds}::text[]) AND p."userId" = ${root.userId} AND p."deletedAt" IS NULL
        UNION ALL
        SELECT c."startId", p."id", p."kind"::text AS "kind", p."parentId",
               p."shareExcludeFromParent", c.depth + 1, c.seen || p."id"
        FROM ${table()} p
        JOIN chain c ON p."id" = c."parentId"
        WHERE p."userId" = ${root.userId} AND p."deletedAt" IS NULL AND NOT (p."id" = ANY(c.seen))
      )
      SELECT "startId", "id", "kind", "shareExcludeFromParent", depth
      FROM chain
      ORDER BY "startId" ASC, depth ASC
    `);
    const byStart = new Map<string, CardAncestorRow[]>();
    for (const row of ancestors) {
      const list = byStart.get(row.startId) ?? [];
      list.push(row);
      byStart.set(row.startId, list);
    }
    for (const [startId, chain] of byStart) {
      for (const ancestor of chain) {
        if (ancestor.id === root.id) {
          validStarts.add(startId);
          break;
        }
        if (ancestor.shareExcludeFromParent || !shareable(ancestor) || leafKind(ancestor)) break;
      }
    }
  }

  const cards: Record<string, PageCardPreview> = {};
  for (const row of candidates) {
    const inTree = row.id === root.id || row.parentId === root.id || (row.parentId !== null && validStarts.has(row.parentId));
    if (!inTree) continue;
    const kind = pageKindOf(row);
    cards[row.id] = {
      id: row.id,
      kind,
      title: row.title,
      icon: noteIconText(row.icon) || null,
      iconUrl: isUploadedNoteIcon(row.icon) ? shareIconUrl(token, row.id) : null,
      summary: extractPageCardSummary(kind, row.blocks, row.canvas?.segments),
    };
  }
  return cards;
}
