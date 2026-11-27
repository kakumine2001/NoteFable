import { randomBytes } from "crypto";
import { Prisma } from "@/generated/prisma/client";
import { extractCanvasSegments } from "@/lib/canvas-document";
import { splitHosts } from "@/lib/hosts";
import { isShareRowActive, isValidShareToken, shareIconUrl, sharePagePath, sharePageUrl } from "@/lib/note-share";
import { isUploadedNoteIcon, noteIconText } from "@/lib/note-icon";
import { PAGE_SUMMARY_SELECT } from "@/lib/note-tree-server";
import { isCanvasKind, PAGE_KINDS, pageKindFeatures, pageKindOf, type PageKind } from "@/lib/page-kinds";
import { readCanvasDataForShare } from "@/lib/canvas-store";
import { databaseSchema, prisma } from "@/lib/prisma";
import { publicDeck } from "@/lib/slides/public-deck";
import { extractNoteWhiteboardPageIds } from "@/lib/whiteboard/frames";
import { extractPageCardSummary, isValidPageCardId, MAX_PAGE_CARD_BATCH, type PageCardPreview } from "@/lib/whiteboard/links";
import { publicWhiteboardScene } from "@/lib/whiteboard/public";
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

// 同じ公開共有ツリーに含まれる埋め込みホワイトボード（公開ノート内のプレビュー・遷移先）。
// 同じツリーに無いホワイトボードはここに入らず、閲覧者にはプレースホルダーだけを見せる（メタデータを一切漏らさない）。
export type PublicEmbeddedWhiteboard = { id: string; title: string; icon: string | null; href: string };

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
  embeddedWhiteboards?: Record<string, PublicEmbeddedWhiteboard>;
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

type AncestorNodeRow = {
  id: string;
  kind: string;
  parentId: string | null;
  shareExcludeFromParent: boolean;
};

// 複数の親 ID から公開ルートまでの祖先ノードを 1 回の再帰 CTE でまとめて取得する（循環安全・root で打ち切り）。
async function fetchAncestorsBatch(userId: string, rootId: string, startParentIds: string[]): Promise<Map<string, AncestorNodeRow>> {
  const unique = [...new Set(startParentIds.filter((id) => id && id !== rootId))];
  const map = new Map<string, AncestorNodeRow>();
  if (!unique.length) return map;
  const rows = await prisma.$queryRaw<AncestorNodeRow[]>(Prisma.sql`
    WITH RECURSIVE chain AS (
      SELECT p."id", p."kind"::text AS "kind", p."parentId", p."shareExcludeFromParent",
             ARRAY[p."id"]::text[] AS seen
      FROM ${table()} p
      WHERE p."id" = ANY(${unique}::text[]) AND p."userId" = ${userId} AND p."deletedAt" IS NULL
      UNION ALL
      SELECT p."id", p."kind"::text AS "kind", p."parentId", p."shareExcludeFromParent",
             c.seen || p."id"
      FROM ${table()} p
      JOIN chain c ON p."id" = c."parentId"
      WHERE c."id" <> ${rootId} AND p."userId" = ${userId} AND p."deletedAt" IS NULL AND NOT (p."id" = ANY(c.seen))
    )
    SELECT DISTINCT "id", "kind", "parentId", "shareExcludeFromParent"
    FROM chain
  `);
  for (const row of rows) map.set(row.id, row);
  return map;
}

async function resolveEmbeddedWhiteboards(
  token: string,
  root: { id: string; userId: string; kind: unknown; title: string; icon: string | null; shareIncludeSubpages: boolean },
  blocks: unknown,
): Promise<Record<string, PublicEmbeddedWhiteboard> | undefined> {
  const embeddedIds = extractNoteWhiteboardPageIds(blocks);
  if (!embeddedIds.length) return undefined;
  const resolved: Record<string, PublicEmbeddedWhiteboard> = {};
  const nonRootIds: string[] = [];
  for (const wbId of embeddedIds) {
    if (wbId === root.id) {
      if (pageKindOf(root) === "whiteboard") {
        resolved[wbId] = { id: root.id, title: root.title, icon: root.icon, href: sharePagePath(token) };
      }
    } else {
      nonRootIds.push(wbId);
    }
  }
  if (nonRootIds.length > 0 && root.shareIncludeSubpages && !leafKind(root)) {
    const candidates = await prisma.notePage.findMany({
      where: {
        id: { in: nonRootIds },
        userId: root.userId,
        kind: "whiteboard",
        deletedAt: null,
        shareExcludeFromParent: false,
      },
      select: { id: true, parentId: true, title: true, icon: true },
    });
    const nonDirectParents = candidates
      .map((candidate) => candidate.parentId)
      .filter((parentId): parentId is string => Boolean(parentId) && parentId !== root.id);
    const ancestorsById = await fetchAncestorsBatch(root.userId, root.id, nonDirectParents);
    const parentAllowed = new Map<string, boolean>([[root.id, true]]);

    const isParentAllowed = (startId: string | null): boolean => {
      if (!startId) return false;
      const cached = parentAllowed.get(startId);
      if (cached !== undefined) return cached;
      const visited: string[] = [];
      const seen = new Set<string>();
      let curr: string | null = startId;
      let ok = false;
      while (curr) {
        const memo = parentAllowed.get(curr);
        if (memo !== undefined) {
          ok = memo;
          break;
        }
        if (seen.has(curr)) {
          ok = false;
          break;
        }
        seen.add(curr);
        visited.push(curr);
        const node = ancestorsById.get(curr);
        if (!node || node.shareExcludeFromParent || !shareable(node) || leafKind(node)) {
          ok = false;
          break;
        }
        curr = node.parentId;
      }
      for (const id of visited) parentAllowed.set(id, ok);
      return ok;
    };

    for (const candidate of candidates) {
      if (isParentAllowed(candidate.parentId)) {
        resolved[candidate.id] = {
          id: candidate.id,
          title: candidate.title,
          icon: candidate.icon,
          href: sharePagePath(token, candidate.id),
        };
      }
    }
  }
  return Object.keys(resolved).length ? resolved : undefined;
}

// 公開トークン（と任意のサブページ ID）から閲覧可能なページ・パンくず・直下の公開サブページを解決する。
// 非公開・期限切れ・ゴミ箱・親からの除外・別ユーザーのページはすべて null。
export async function resolvePublicShare(
  token: string,
  requestedPageId?: string | null,
  now = new Date(),
  options?: { includeEmbeddedWhiteboards?: boolean },
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

  const targetKind = pageKindOf(target);
  const embeddedWhiteboards = targetKind === "note" && options?.includeEmbeddedWhiteboards !== false
    ? await resolveEmbeddedWhiteboards(token, root, target.blocks)
    : undefined;

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
      kind: targetKind,
      // スライドの本体（公開の 1 回の読み込みで、ページの行の後に読む）。ノートは blocks を使う。
      data: targetKind === "slides" ? await readCanvasDataForShare(target.id) : null,
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
    ...(embeddedWhiteboards !== undefined ? { embeddedWhiteboards } : {}),
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
// スライド・ホワイトボードの要約は、非公開要素（隠しスライド・スピーカーノート・畳んだ思考マップ枝・非公開カード名）を除いた公開用の本体から作る。
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
  }
  if (!uniqueIds.length) return {};

  const allowSubpages = root.shareIncludeSubpages && (root.kind ?? "note") !== "slides";
  const queryIds = allowSubpages ? uniqueIds : uniqueIds.filter((id) => id === root.id);
  if (!queryIds.length) return {};

  type CardPageRow = {
    id: string;
    kind: string;
    parentId: string | null;
    title: string;
    icon: string | null;
    blocks: unknown;
    shareExcludeFromParent: boolean;
  };
  const rows: CardPageRow[] = [];
  for (let offset = 0; offset < queryIds.length; offset += MAX_PAGE_CARD_BATCH) {
    const chunk = queryIds.slice(offset, offset + MAX_PAGE_CARD_BATCH);
    const batch = await prisma.notePage.findMany({
      where: { id: { in: chunk }, userId: root.userId, deletedAt: null },
      select: {
        id: true,
        kind: true,
        parentId: true,
        title: true,
        icon: true,
        blocks: true,
        shareExcludeFromParent: true,
      },
    });
    rows.push(...batch);
  }
  if (!rows.length) return {};

  const candidates = rows.filter((row) => row.id === root.id || (allowSubpages && shareable(row) && !row.shareExcludeFromParent));
  const startParentIds = [...new Set(
    candidates
      .filter((row) => row.id !== root.id && row.parentId !== null && row.parentId !== root.id)
      .map((row) => row.parentId as string),
  )];

  const validStarts = new Set<string>();
  for (let offset = 0; offset < startParentIds.length; offset += MAX_PAGE_CARD_BATCH) {
    const chunk = startParentIds.slice(offset, offset + MAX_PAGE_CARD_BATCH);
    const ancestors = await prisma.$queryRaw<CardAncestorRow[]>(Prisma.sql`
      WITH RECURSIVE chain AS (
        SELECT p."id" AS "startId", p."id", p."kind"::text AS "kind", p."parentId",
               p."shareExcludeFromParent", 1 AS depth, ARRAY[p."id"]::text[] AS seen
        FROM ${table()} p
        WHERE p."id" = ANY(${chunk}::text[]) AND p."userId" = ${root.userId} AND p."deletedAt" IS NULL
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

  const inTreeRows = candidates.filter((row) => row.id === root.id || row.parentId === root.id || (row.parentId !== null && validStarts.has(row.parentId)));
  const inTreeCanvasIds = inTreeRows.filter((row) => isCanvasKind(pageKindOf(row))).map((row) => row.id);
  const canvasDataById = new Map<string, unknown>();
  for (let offset = 0; offset < inTreeCanvasIds.length; offset += MAX_PAGE_CARD_BATCH) {
    const chunk = inTreeCanvasIds.slice(offset, offset + MAX_PAGE_CARD_BATCH);
    const canvases = await prisma.noteCanvas.findMany({
      where: { noteId: { in: chunk } },
      select: { noteId: true, data: true },
    });
    for (const canvas of canvases) canvasDataById.set(canvas.noteId, canvas.data);
  }

  const cards: Record<string, PageCardPreview> = {};
  for (const row of inTreeRows) {
    const kind = pageKindOf(row);
    let summary = "";
    if (kind === "slides") {
      const data = canvasDataById.get(row.id);
      if (data) summary = extractPageCardSummary("slides", null, extractCanvasSegments("slides", publicDeck(data)));
    } else if (kind === "whiteboard") {
      const data = canvasDataById.get(row.id);
      if (data) {
        const sanitized = publicWhiteboardScene(data, token, row.id, { cards: {}, unavailableLabel: "" });
        summary = extractPageCardSummary("whiteboard", null, extractCanvasSegments("whiteboard", sanitized));
      }
    } else {
      summary = extractPageCardSummary("note", row.blocks, null);
    }
    cards[row.id] = {
      id: row.id,
      kind,
      title: row.title,
      icon: noteIconText(row.icon) || null,
      iconUrl: isUploadedNoteIcon(row.icon) ? shareIconUrl(token, row.id) : null,
      summary,
    };
  }
  return cards;
}
