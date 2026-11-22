import { Prisma } from "@/generated/prisma/client";
import { databaseSchema, prisma } from "@/lib/prisma";
import { scheduleNoteEmbeddingBackfill, semanticSearchNotes, UI_SEMANTIC_THRESHOLD } from "@/lib/note-embeddings";
import { inlineText, leadingText, walkBlocks } from "@/lib/note-text";
import { buildSearchSnippet, countMatchedTerms, foldSearchText, likePattern, termMatcher } from "@/lib/search-fold";
import { MAX_SEARCH_TERMS, parseSearchTerms, SEARCH_RESULT_LIMIT, type ChatSearchResult, type NoteSearchResult } from "@/types/search";

export { parseSearchTerms };

// Chats と Notes の横断キーワード検索（大文字小文字・全角半角・ひらがなカタカナを区別しない部分一致）。
// 語は畳み込み（search-fold.ts）して JS 側で比べる。DB 側は本文を畳み込まず、語を「その語に畳み込まれる元の表記すべて」にした正規表現で
// 探す（lower() + normalize() + translate() を全行にかけると 20,000 件で 6〜35 倍遅くなるため）。絞り込みと並べ替えは DB で行い、
// JS には上位 15 件ぶんだけを持ち込む。Notes は全部の語がタイトルか本文にあるもの。Chats は全部の語がタイトル、またはメッセージ
// （と添付ファイルの本文）のどこかにあるもの（同じメッセージに揃っている必要はない）。

// 本文中の文字列（inline の text）だけを集める JSONPath。page-tools.ts の searchPages と同じ。
export const TEXT_PATH = 'strict $.** ? (@.type() == "object" && exists(@.text)).text';
// 一致したメッセージの抜粋として DB から受け取る範囲。語の 100 文字前から 600 文字。
// 添付ファイルの抽出本文は、保存する時点で 120,000 文字に切られている（src/lib/files.ts の MAX_TEXT_CHARS）ので、DB 側ではさらに切らない。
const EXCERPT_BEFORE = 100;
const EXCERPT_CHARS = 600;

// 一致する語がいちばん多いブロック（同数なら文書の順で先）。ID の無いブロックは飛ばす（移動先にできない）。
export function findMatchingBlock(blocks: unknown, terms: string[]): { blockId: string; text: string } | null {
  const needles = prepareTerms(terms);
  if (!needles.length) return null;
  let best: { blockId: string; text: string; count: number } | null = null;
  for (const block of walkBlocks(blocks)) {
    if (typeof block.id !== "string" || !block.id) continue;
    const text = inlineText(block.content);
    const count = countMatchedTerms(text, needles);
    if (count > (best?.count ?? 0)) best = { blockId: block.id, text, count };
    if (count === needles.length) break;
  }
  return best ? { blockId: best.blockId, text: best.text } : null;
}

// ---- SQL ----

const table = (name: string) => Prisma.raw(`"${databaseSchema}"."${name}"`);
// substr の位置と長さは int である必要がある（パラメーターにすると bigint で渡り、関数が見つからない）。固定の定数だけを直接埋め込む。
const literal = (value: number) => Prisma.raw(String(Math.trunc(value)));

// 呼び出し側が畳み込んでいない語でも一致するよう、ここでも畳み込む（畳み込みは何度かけても同じ）。
export function prepareTerms(terms: string[]) {
  return [...new Set(terms.map(foldSearchText).filter(Boolean))].slice(0, MAX_SEARCH_TERMS);
}

// 列 column（利用者の入力ではない、自前の式）がその語を含む。他の表記が無い語（漢字など）は LIKE で、% と _ は文字として扱い、
// エスケープは ESCAPE '!' と合わせる。それ以外（英数字・かな・記号）は、元の表記すべてに当たる正規表現で探す。
export function termHit(column: string, term: string) {
  const matcher = termMatcher(term);
  return matcher.literal
    ? Prisma.sql`${Prisma.raw(column)} LIKE ${likePattern(term)} ESCAPE '!'`
    : Prisma.sql`${Prisma.raw(column)} ~ ${matcher.regex}`;
}

// 語ごとに 1 ビットを立てた整数（語 i が含まれていれば 1 << i）。1 回の走査で「どの語が含まれるか」を取り出す。
function termMask(column: string, terms: string[]) {
  return Prisma.join(terms.map((term, index) => Prisma.sql`(CASE WHEN ${termHit(column, term)} THEN ${literal(1 << index)} ELSE 0 END)`), " | ");
}

// 立っているビットの数（一致した語の数）。bit_count() は PostgreSQL 14 以降なので、語は最大 8 個の整数のビット演算で数える。
const popcount = (mask: string, termCount: number) => Prisma.raw(Array.from({ length: termCount }, (_, index) => `((${mask} >> ${index}) & 1)`).join(" + "));

const toIso = (value: Date | string) => new Date(value).toISOString();

// ---- Notes ----

type NoteRow = { id: string; title: string; icon: string | null; updatedAt: Date | string; blocks: unknown };

// ごみ箱のノート（deletedAt あり）は対象外。タイトルに一致した語が多いものを先に、次に更新が新しい順。
// 一致した最大 15 件だけが blocks を持ち帰り、移動先のブロックと抜粋は JS で求める。
async function searchNotesByKeyword(userId: string, needles: string[]): Promise<NoteSearchResult[]> {
  const rows = await prisma.$queryRaw<NoteRow[]>(Prisma.sql`
    SELECT p."id", p."title", p."icon", p."updatedAt", p."blocks"
    FROM ${table("NotePage")} p
    CROSS JOIN LATERAL (
      SELECT string_agg(value, ' ') AS "body"
      FROM jsonb_array_elements_text(jsonb_path_query_array(p."blocks", ${TEXT_PATH}::jsonpath))
    ) t
    WHERE p."userId" = ${userId} AND p."deletedAt" IS NULL
      AND ${Prisma.join(needles.map((term) => Prisma.sql`(${termHit('p."title"', term)} OR ${termHit('t."body"', term)})`), " AND ")}
    ORDER BY ${Prisma.join(needles.map((term) => Prisma.sql`(CASE WHEN ${termHit('p."title"', term)} THEN 1 ELSE 0 END)`), " + ")} DESC, p."updatedAt" DESC, p."id" DESC
    LIMIT ${SEARCH_RESULT_LIMIT}`);
  return rows.map((row) => {
    const hit = findMatchingBlock(row.blocks, needles);
    return {
      kind: "note",
      id: row.id,
      title: row.title,
      icon: row.icon,
      snippet: buildSearchSnippet(hit ? hit.text : leadingText(row.blocks), needles),
      blockId: hit?.blockId ?? null,
      updatedAt: toIso(row.updatedAt),
    };
  });
}

export type NoteSearchOptions = {
  // 利用者が打った検索語そのまま。意味検索はこちらを使う（空白で割った語ではなく、文として埋め込む）。
  rawQuery?: string;
  signal?: AbortSignal;
};

// キーワードで見つかったノートを先に（順序・移動先・抜粋はそのまま）、意味が近いノートを後ろに足す（言い回しや言語が違っても見つかる）。
export async function searchNotes(userId: string, terms: string[], options: NoteSearchOptions = {}): Promise<NoteSearchResult[]> {
  const needles = prepareTerms(terms);
  const rawQuery = options.rawQuery?.trim() || needles.join(" ");
  if (!needles.length && !rawQuery) return [];
  const [keyword, semantic] = await Promise.all([
    needles.length ? searchNotesByKeyword(userId, needles) : [],
    semanticSearchNotes(userId, rawQuery, { limit: SEARCH_RESULT_LIMIT, minSimilarity: UI_SEMANTIC_THRESHOLD, maxBackfillNotes: 0, timeoutMs: 2500, signal: options.signal }),
  ]);
  if (semantic.hasMoreBackfill) scheduleNoteEmbeddingBackfill(userId);
  const seen = new Set(keyword.map((note) => note.id));
  const extra: NoteSearchResult[] = semantic.hits
    .filter((hit) => !seen.has(hit.id))
    .map((hit) => ({
      kind: "note",
      id: hit.id,
      title: hit.title,
      icon: hit.icon,
      snippet: hit.chunkText ? buildSearchSnippet(hit.chunkText, needles) : "",
      blockId: hit.blockId,
      updatedAt: toIso(hit.updatedAt),
    }));
  return [...keyword, ...extra].slice(0, SEARCH_RESULT_LIMIT);
}

// ---- Chats ----

type ChatRow = {
  id: string; title: string; icon: string | null; projectId: string | null; updatedAt: Date | string; titleMatch: boolean;
  messageId: string | null; role: string | null; attachmentName: string | null; excerpt: string | null;
};

export type ChatSearchOptions = {
  // 指定すると、そのプロジェクトの会話だけを探す。利用者本人のプロジェクトでなければ、結果は空になる。
  projectId?: string | null;
};

// ノートのアシスタントの会話（noteId あり）は対象外。1 会話 1 件で、全語がタイトルか、いずれかのメッセージ（添付ファイルの本文を含む）にあるものだけ。
// 並び順は、タイトルに全語がある会話 → 1 つのメッセージに全語が揃っている会話 → 語が複数のメッセージに散らばっている会話。
// 同じ区分の中では、タイトルに入っている語が多い順、最新の一致メッセージ（無ければ会話の更新）が新しい順。
// 抜粋と移動先は、会話の中で一致する語がいちばん多い（同数なら新しい）メッセージ。その抜粋だけを DB から受け取る。
export async function searchChats(userId: string, terms: string[], options: ChatSearchOptions = {}): Promise<ChatSearchResult[]> {
  const needles = prepareTerms(terms);
  if (!needles.length) return [];
  const count = needles.length;
  const full = literal((1 << count) - 1);
  const inProject = (alias: string) => (options.projectId ? Prisma.sql`AND ${Prisma.raw(alias)}."projectId" = ${options.projectId}` : Prisma.empty);
  // 最も手前の一致の位置を探す正規表現（全部の語の候補をまとめたもの）。一致した文字列を本文から探し直して位置にする。
  const anyTerm = needles.map((term) => `(?:${termMatcher(term).regex})`).join("|");
  const rows = await prisma.$queryRaw<ChatRow[]>(Prisma.sql`
    WITH "hit" AS (
      SELECT x."sessionId", x."messageId", x."createdAt", x."mask" FROM (
        SELECT m."sessionId", m."id" AS "messageId", m."createdAt", ${termMask('m."content"', needles)} AS "mask"
        FROM ${table("Message")} m
        JOIN ${table("Session")} ms ON ms."id" = m."sessionId"
        WHERE ms."userId" = ${userId} AND ms."noteId" IS NULL ${inProject("ms")} AND m."role" IN ('USER', 'ASSISTANT') AND m."active"
        OFFSET 0
      ) x WHERE x."mask" > 0
      UNION ALL
      SELECT y."sessionId", y."messageId", y."createdAt", y."mask" FROM (
        SELECT m."sessionId", a."messageId", m."createdAt", ${termMask('a."extractedText"', needles)} AS "mask"
        FROM ${table("Attachment")} a
        JOIN ${table("Message")} m ON m."id" = a."messageId"
        JOIN ${table("Session")} ms ON ms."id" = m."sessionId"
        WHERE ms."userId" = ${userId} AND ms."noteId" IS NULL ${inProject("ms")} AND m."role" IN ('USER', 'ASSISTANT') AND m."active" AND a."extractedText" IS NOT NULL
        OFFSET 0
      ) y WHERE y."mask" > 0
    ), "msg" AS (
      SELECT "sessionId", "messageId", max("createdAt") AS "createdAt", bit_or("mask") AS "mask"
      FROM "hit" GROUP BY "sessionId", "messageId"
    ), "agg" AS (
      SELECT "sessionId", bit_or("mask") AS "allMask", bool_or("mask" = ${full}) AS "oneMessage", max("createdAt") AS "lastHitAt",
        (array_agg("messageId" ORDER BY ${popcount('"mask"', count)} DESC, "createdAt" DESC, "messageId" DESC))[1] AS "bestId"
      FROM "msg" GROUP BY "sessionId"
    )
    SELECT r."id", r."title", r."icon", r."projectId", r."updatedAt", r."titleMatch", r."messageId", b."role", b."attachmentName",
      CASE WHEN b."text" IS NULL THEN NULL
        ELSE substr(b."text", GREATEST(1, b."pos" - ${literal(EXCERPT_BEFORE)}), ${literal(EXCERPT_CHARS)}) END AS "excerpt"
    FROM (
      SELECT s."id", s."title", s."icon", s."projectId", s."updatedAt", (tm."mask" = ${full}) AS "titleMatch", ag."bestId" AS "messageId",
        CASE WHEN tm."mask" = ${full} THEN 0 WHEN COALESCE(ag."oneMessage", false) THEN 1 ELSE 2 END AS "tier",
        ${popcount('tm."mask"', count)} AS "titleTerms",
        COALESCE(ag."lastHitAt", s."updatedAt") AS "sortAt"
      FROM ${table("Session")} s
      CROSS JOIN LATERAL (SELECT ${termMask('s."title"', needles)} AS "mask" OFFSET 0) tm
      LEFT JOIN "agg" ag ON ag."sessionId" = s."id"
      WHERE s."userId" = ${userId} AND s."noteId" IS NULL ${inProject("s")} AND (tm."mask" | COALESCE(ag."allMask", 0)) = ${full}
      ORDER BY "tier", "titleTerms" DESC, "sortAt" DESC, s."id" DESC
      LIMIT ${SEARCH_RESULT_LIMIT}
    ) r
    LEFT JOIN LATERAL (
      SELECT c."text", c."attachmentName", c."role", strpos(c."text", substring(c."text" FROM ${anyTerm})) AS "pos"
      FROM (
        SELECT t.*, ${termMask('t."text"', needles)} AS "mask" FROM (
          SELECT 0 AS "rank", m."content" AS "text", NULL::text AS "attachmentName", m."role"::text AS "role", m."createdAt" AS "at"
          FROM ${table("Message")} m WHERE m."id" = r."messageId"
          UNION ALL
          SELECT 1, a."extractedText", a."filename", m."role"::text, a."createdAt"
          FROM ${table("Attachment")} a JOIN ${table("Message")} m ON m."id" = a."messageId"
          WHERE a."messageId" = r."messageId" AND a."extractedText" IS NOT NULL
        ) t
        OFFSET 0
      ) c
      WHERE c."mask" > 0
      ORDER BY ${popcount('c."mask"', count)} DESC, c."rank", c."at", c."attachmentName"
      LIMIT 1
    ) b ON TRUE
    ORDER BY r."tier", r."titleTerms" DESC, r."sortAt" DESC, r."id" DESC`);
  return rows.map((row) => ({
    kind: "chat",
    id: row.id,
    title: row.title,
    icon: row.icon,
    // excerpt は語の 100 文字前から始まる。buildSearchSnippet が語の前後を切り出し、先頭・末尾の省略記号を全文のときと同じ条件で付ける。
    snippet: row.excerpt ? buildSearchSnippet(row.excerpt, needles) : "",
    messageId: row.messageId,
    role: row.role === "USER" || row.role === "ASSISTANT" ? row.role : null,
    attachmentName: row.attachmentName ?? null,
    projectId: row.projectId,
    titleMatch: row.titleMatch === true,
    updatedAt: toIso(row.updatedAt),
  }));
}
