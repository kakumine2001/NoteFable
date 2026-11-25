import { Prisma } from "@/generated/prisma/client";
import { BACKLINK_LIMIT, whiteboardLinksTo, type ChatBacklink, type NoteBacklinks, type PageBacklink } from "@/lib/note-backlinks";
import { notePageIdFromUrl } from "@/lib/note-mention";
import { pageKindOf } from "@/lib/page-kinds";
import { databaseSchema, prisma } from "@/lib/prisma";

// バックリンクを読む（GET /api/pages/:id/backlinks）。索引の表は持たず、開いた時に持ち主の生きているページを調べる
// （検索と同じく本文の JSON をその場で走査する。書き込みの経路を増やさない）。
// DB では候補だけを絞り、確かめは JS（note-backlinks.ts。エディターがその場で開くリンクと同じ判定）で行う。

const table = (name: string) => Prisma.raw(`"${databaseSchema}"."${name}"`);

// targetId のページへの「@」メンションがあるか（search.ts の MENTION_PAGE_ID_PATH と同じたどり方）。
export const MENTION_TO_PAGE_PATH = 'strict $.** ? (@.type() == "object" && @.type == "mention" && exists(@.props)).props ? (@.kind == "page" && @.pageId == $id)';
// 本文のリンク（BlockNote の link の href）。
export const LINK_HREF_PATH = 'strict $.** ? (@.type() == "object" && @.type == "link" && exists(@.href)).href';

// DB で絞った候補の数の上限（JS で確かめて落ちるものがあっても BACKLINK_LIMIT 件を埋められるよう多めに取る）。
const CANDIDATE_LIMIT = BACKLINK_LIMIT * 2;

type PageRow = { id: string; kind: string; title: string; icon: string | null; mentioned: boolean | null; hrefs: string[] | null; elements: unknown };

async function linkingPages(userId: string, pageId: string, origin: string): Promise<PageBacklink[]> {
  // ノート：ページ ID を含む href だけを持ち帰る。ホワイトボード：リンクかページカードの印にページ ID を含む要素だけを持ち帰る
  // （本体の線の点などは運ばない）。スライドにはページへのリンクが無い。
  const rows = await prisma.$queryRaw<PageRow[]>(Prisma.sql`
    SELECT p."id", p."kind"::text AS "kind", p."title", p."icon", x."mentioned", x."hrefs", w."elements"
    FROM ${table("NotePage")} p
    LEFT JOIN ${table("NoteCanvas")} c ON c."noteId" = p."id" AND p."kind" = 'whiteboard'
    CROSS JOIN LATERAL (
      SELECT
        CASE WHEN p."kind" = 'note'
          THEN jsonb_path_exists(p."blocks", ${MENTION_TO_PAGE_PATH}::jsonpath, jsonb_build_object('id', ${pageId}::text), true)
          ELSE false END AS "mentioned",
        CASE WHEN p."kind" = 'note'
          THEN ARRAY(SELECT h FROM jsonb_array_elements_text(jsonb_path_query_array(p."blocks", ${LINK_HREF_PATH}::jsonpath, '{}'::jsonb, true)) h
            WHERE strpos(h, ${pageId}::text) > 0)
          ELSE NULL END AS "hrefs"
    ) x
    CROSS JOIN LATERAL (
      SELECT jsonb_agg(e) AS "elements"
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(c."data" -> 'elements') = 'array' THEN c."data" -> 'elements' ELSE '[]'::jsonb END) e
      WHERE jsonb_typeof(e) = 'object'
        AND (strpos(COALESCE(e ->> 'link', ''), ${pageId}::text) > 0 OR e #>> '{customData,notefablePage,id}' = ${pageId}::text)
    ) w
    WHERE p."userId" = ${userId} AND p."deletedAt" IS NULL AND p."id" <> ${pageId}
      AND (x."mentioned" OR COALESCE(cardinality(x."hrefs"), 0) > 0 OR w."elements" IS NOT NULL)
    ORDER BY p."updatedAt" DESC, p."id" DESC
    LIMIT ${CANDIDATE_LIMIT}
  `);
  return rows
    .filter((row) => row.mentioned === true
      || (row.hrefs ?? []).some((href) => notePageIdFromUrl(href, origin) === pageId)
      || (row.kind === "whiteboard" && whiteboardLinksTo({ elements: row.elements }, pageId, origin)))
    .slice(0, BACKLINK_LIMIT)
    .map((row) => ({ id: row.id, kind: pageKindOf(row), title: row.title, icon: row.icon }));
}

async function usingChats(userId: string, pageId: string): Promise<ChatBacklink[]> {
  const sessionSelect = { id: true, title: true, icon: true, updatedAt: true } as const;
  const [started, attached] = await Promise.all([
    // ノートの AI パネルで始めた会話。
    prisma.session.findMany({
      where: { userId, noteId: pageId }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: BACKLINK_LIMIT, select: sessionSelect,
    }),
    // 発言にこのページを添付した会話。編集・再生成で置き換えた版（active: false）は数えない。新しい発言から。
    prisma.messageNote.findMany({
      where: { noteId: pageId, message: { active: true, session: { userId } } },
      orderBy: [{ message: { createdAt: "desc" } }, { messageId: "desc" }],
      take: BACKLINK_LIMIT * 4,
      select: { messageId: true, message: { select: { session: { select: sessionSelect } } } },
    }),
  ]);
  const chats = new Map<string, ChatBacklink & { updatedAt: Date }>();
  for (const session of started) chats.set(session.id, { id: session.id, title: session.title, icon: session.icon, messageId: null, updatedAt: session.updatedAt });
  for (const { messageId, message: { session } } of attached) {
    if (!chats.has(session.id)) chats.set(session.id, { id: session.id, title: session.title, icon: session.icon, messageId, updatedAt: session.updatedAt });
  }
  return [...chats.values()]
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || (a.id < b.id ? 1 : -1))
    .slice(0, BACKLINK_LIMIT)
    .map(({ id, title, icon, messageId }) => ({ id, title, icon, messageId }));
}

// origin はリンクがアプリ内のページかを見分ける基準（リクエストのオリジン。エディターは window.location.origin を使う）。
export async function findNoteBacklinks(userId: string, pageId: string, origin: string): Promise<NoteBacklinks> {
  const [pages, chats] = await Promise.all([linkingPages(userId, pageId, origin), usingChats(userId, pageId)]);
  return { pages, chats };
}
