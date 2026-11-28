import { Prisma } from "@/generated/prisma/client";
import { BACKLINK_LIMIT, type ChatBacklink, type NoteBacklinks, type PageBacklink } from "@/lib/note-backlinks";
import { notePageIdFromUrl } from "@/lib/note-mention";
import { pageKindOf } from "@/lib/page-kinds";
import { databaseSchema, prisma } from "@/lib/prisma";

// バックリンクを読む（GET /api/pages/:id/backlinks）。開いた時に持ち主の生きているページを調べる。
// ノートは検索と同じく本文の JSON をその場で走査する。ホワイトボード・スライドの本体は大きいので読まず、保存のたびに
// 抜き出しておいたリンク（NoteCanvas.links、extractCanvasLinks）だけを見る。
// DB では候補だけを絞り、確かめは JS（エディターがその場で開くリンクと同じ判定 notePageIdFromUrl）で行う。

const table = (name: string) => Prisma.raw(`"${databaseSchema}"."${name}"`);

// targetId のページへの「@」メンションがあるか（search.ts の MENTION_PAGE_ID_PATH と同じたどり方）。
export const MENTION_TO_PAGE_PATH = 'strict $.** ? (@.type() == "object" && @.type == "mention" && exists(@.props)).props ? (@.kind == "page" && @.pageId == $id)';
// targetId のホワイトボードをノートに埋め込んでいるか。
export const WHITEBOARD_EMBED_TO_PAGE_PATH = 'strict $.** ? (@.type() == "object" && @.type == "whiteboard" && exists(@.props)).props ? (@.pageId == $id)';
// 本文のリンク（BlockNote の link の href）。
export const LINK_HREF_PATH = 'strict $.** ? (@.type() == "object" && @.type == "link" && exists(@.href)).href';

// DB で絞った候補の数の上限（JS で確かめて落ちるものがあっても BACKLINK_LIMIT 件を埋められるよう多めに取る）。
const CANDIDATE_LIMIT = BACKLINK_LIMIT * 2;

type PageRow = { id: string; kind: string; title: string; icon: string | null; mentioned: boolean | null; hrefs: string[] | null };

async function linkingPages(userId: string, pageId: string, origin: string): Promise<PageBacklink[]> {
  // どの種類も、ページ ID を含む href だけを持ち帰る。
  const rows = await prisma.$queryRaw<PageRow[]>(Prisma.sql`
    SELECT p."id", p."kind"::text AS "kind", p."title", p."icon", x."mentioned", x."hrefs"
    FROM ${table("NotePage")} p
    LEFT JOIN ${table("NoteCanvas")} c ON c."noteId" = p."id" AND p."kind" <> 'note'
    CROSS JOIN LATERAL (
      SELECT
        CASE WHEN p."kind" = 'note'
          THEN jsonb_path_exists(p."blocks", ${MENTION_TO_PAGE_PATH}::jsonpath, jsonb_build_object('id', ${pageId}::text), true)
            OR jsonb_path_exists(p."blocks", ${WHITEBOARD_EMBED_TO_PAGE_PATH}::jsonpath, jsonb_build_object('id', ${pageId}::text), true)
          ELSE false END AS "mentioned",
        ARRAY(SELECT h FROM jsonb_array_elements_text(CASE WHEN p."kind" = 'note'
            THEN jsonb_path_query_array(p."blocks", ${LINK_HREF_PATH}::jsonpath, '{}'::jsonb, true)
            ELSE COALESCE(c."links", '[]'::jsonb) END) h
          WHERE strpos(h, 'view=pages') > 0 AND strpos(h, ${pageId}::text) > 0) AS "hrefs"
    ) x
    WHERE p."userId" = ${userId} AND p."deletedAt" IS NULL AND p."id" <> ${pageId}
      AND (x."mentioned" OR cardinality(x."hrefs") > 0)
    ORDER BY p."updatedAt" DESC, p."id" DESC
    LIMIT ${CANDIDATE_LIMIT}
  `);
  return rows
    .filter((row) => row.mentioned === true || (row.hrefs ?? []).some((href) => notePageIdFromUrl(href, origin) === pageId))
    .slice(0, BACKLINK_LIMIT)
    .map((row) => ({ id: row.id, kind: pageKindOf(row), title: row.title, icon: row.icon }));
}

async function usingChats(userId: string, pageId: string): Promise<ChatBacklink[]> {
  // 同じ発言が、表示中の版（active）で、このページを添付していること。編集・再生成で置き換えた版は数えない。
  const attaching = { active: true, notes: { some: { noteId: pageId } } };
  // 会話を単位に絞る（添付した発言の数が多い会話があっても、ほかの会話が落ちないように）。
  const sessions = await prisma.session.findMany({
    where: { userId, OR: [{ noteId: pageId }, { messages: { some: attaching } }] },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: BACKLINK_LIMIT,
    select: {
      id: true, title: true, icon: true, noteId: true,
      messages: { where: attaching, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1, select: { id: true } },
    },
  });
  // ノートの AI パネルで始めた会話は、末尾を開く（messageId なし）。
  return sessions.map(({ id, title, icon, noteId, messages }) => ({ id, title, icon, messageId: noteId === pageId ? null : messages[0]?.id ?? null }));
}

// origin はリンクがアプリ内のページかを見分ける基準（リクエストのオリジン。エディターは window.location.origin を使う）。
export async function findNoteBacklinks(userId: string, pageId: string, origin: string): Promise<NoteBacklinks> {
  const [pages, chats] = await Promise.all([linkingPages(userId, pageId, origin), usingChats(userId, pageId)]);
  return { pages, chats };
}
