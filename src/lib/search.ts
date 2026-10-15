import { Prisma } from "@/generated/prisma/client";
import { buildSnippet, likePattern } from "@/lib/page-tools";
import { databaseSchema, prisma } from "@/lib/prisma";
import { parseSearchTerms, SEARCH_RESULT_LIMIT, type ChatSearchResult, type NoteSearchResult } from "@/types/search";

export { parseSearchTerms };

// Chats と Notes の横断キーワード検索。語は全部が一致したものだけを返す（大文字小文字は区別しない部分一致）。
// 絞り込みと並べ替えは DB 側で行い、JS には上位 15 件ぶんだけを持ち込む。

// 本文中の文字列（inline の text）だけを集める JSONPath。page-tools.ts の searchPages と同じ。
const TEXT_PATH = 'strict $.** ? (@.type() == "object" && exists(@.text)).text';
// 一致したメッセージの抜粋として DB から受け取る範囲。語の 100 文字前から 600 文字。
const EXCERPT_BEFORE = 100;
const EXCERPT_CHARS = 600;
// 一致するブロックが無いとき（タイトルだけの一致）に、スニペットの元にするノート冒頭の長さ。
const LEADING_CHARS = 400;

// ---- ノートのブロック ----

type BlockLike = { id?: unknown; content?: unknown; children?: unknown };

// 文書の順（親 → 子 → 次の兄弟）にブロックを返す。深さに依存しないよう再帰は使わない。
function* walkBlocks(blocks: unknown): Generator<BlockLike> {
  const stack: unknown[] = Array.isArray(blocks) ? [...blocks].reverse() : [];
  while (stack.length) {
    const block = stack.pop();
    if (!block || typeof block !== "object") continue;
    yield block as BlockLike;
    const children = (block as BlockLike).children;
    if (Array.isArray(children)) for (let index = children.length - 1; index >= 0; index--) stack.push(children[index]);
  }
}

// そのブロック自身の文字列（リンクの文字を含み、子ブロックは含まない）。装飾で区切られた語もつなげて探せる。
function inlineText(content: unknown): string {
  if (Array.isArray(content)) return content.map(inlineText).join("");
  if (!content || typeof content !== "object") return "";
  const node = content as { text?: unknown; content?: unknown };
  return (typeof node.text === "string" ? node.text : "") + inlineText(node.content);
}

// 文書の順で最初に、自身の文字列にいずれかの語を含むブロック。terms は小文字。ID の無いブロックは飛ばす（移動先にできない）。
export function findMatchingBlock(blocks: unknown, terms: string[]): { blockId: string; text: string } | null {
  if (!terms.length) return null;
  for (const block of walkBlocks(blocks)) {
    if (typeof block.id !== "string" || !block.id) continue;
    const text = inlineText(block.content);
    const lower = text.toLowerCase();
    if (terms.some((term) => lower.includes(term))) return { blockId: block.id, text };
  }
  return null;
}

// ノート冒頭の本文（ブロックの文字列を空白でつないだもの）。一致するブロックが無いときのスニペットに使う。
function leadingText(blocks: unknown, limit = LEADING_CHARS) {
  let text = "";
  for (const block of walkBlocks(blocks)) {
    const own = inlineText(block.content).trim();
    if (!own) continue;
    text += (text ? " " : "") + own;
    if (text.length >= limit) break;
  }
  return text;
}

// ---- SQL ----

const table = (name: string) => Prisma.raw(`"${databaseSchema}"."${name}"`);
// substr の位置と長さは int である必要がある（パラメーターにすると bigint で渡り、関数が見つからない）。固定の定数だけを直接埋め込む。
const literal = (value: number) => Prisma.raw(String(Math.trunc(value)));

// column の小文字が全部の語を含む。LIKE の % と _ は文字として扱い、エスケープは ESCAPE '!' と合わせる。
function containsAll(column: string, terms: string[]) {
  return containsAllLowered(`lower(${column})`, terms);
}

// すでに小文字にした式で比べる。語ごとに lower() をかけ直さないよう、重い列（メッセージ本文）はこちらを使う。
function containsAllLowered(lowered: string, terms: string[]) {
  return Prisma.join(terms.map((term) => Prisma.sql`${Prisma.raw(lowered)} LIKE ${likePattern(term)} ESCAPE '!'`), " AND ");
}

const toIso = (value: Date | string) => new Date(value).toISOString();

// ---- Notes ----

type NoteRow = { id: string; title: string; icon: string | null; updatedAt: Date | string; blocks: unknown };

// ごみ箱のノート（deletedAt あり）は対象外。タイトルに一致した語が多いものを先に、次に更新が新しい順。
// 一致した最大 15 件だけが blocks を持ち帰り、移動先のブロックと抜粋は JS で求める。
export async function searchNotes(userId: string, terms: string[]): Promise<NoteSearchResult[]> {
  if (!terms.length) return [];
  const titleHit = (term: string) => Prisma.sql`lower(p."title") LIKE ${likePattern(term)} ESCAPE '!'`;
  const rows = await prisma.$queryRaw<NoteRow[]>(Prisma.sql`
    SELECT p."id", p."title", p."icon", p."updatedAt", p."blocks"
    FROM ${table("NotePage")} p
    CROSS JOIN LATERAL (
      SELECT string_agg(value, ' ') AS "body"
      FROM jsonb_array_elements_text(jsonb_path_query_array(p."blocks", ${TEXT_PATH}::jsonpath))
    ) t
    WHERE p."userId" = ${userId} AND p."deletedAt" IS NULL
      AND ${Prisma.join(terms.map((term) => Prisma.sql`(${titleHit(term)} OR lower(t."body") LIKE ${likePattern(term)} ESCAPE '!')`), " AND ")}
    ORDER BY ${Prisma.join(terms.map((term) => Prisma.sql`(CASE WHEN ${titleHit(term)} THEN 1 ELSE 0 END)`), " + ")} DESC, p."updatedAt" DESC, p."id" DESC
    LIMIT ${SEARCH_RESULT_LIMIT}`);
  return rows.map((row) => {
    const hit = findMatchingBlock(row.blocks, terms);
    return {
      kind: "note",
      id: row.id,
      title: row.title,
      icon: row.icon,
      snippet: buildSnippet(hit ? hit.text : leadingText(row.blocks), terms),
      blockId: hit?.blockId ?? null,
      updatedAt: toIso(row.updatedAt),
    };
  });
}

// ---- Chats ----

type ChatRow = {
  id: string; title: string; icon: string | null; projectId: string | null; updatedAt: Date | string; titleMatch: boolean;
  messageId: string | null; role: string | null; excerpt: string | null;
};

// ノートのアシスタントの会話（noteId あり）は対象外。1 会話 1 件で、全語がタイトルか 1 つのメッセージに入っているものだけ。
// 一致したメッセージは DISTINCT ON で会話ごとに最新の 1 つを選び、全文ではなく語の前後だけを受け取る。
// タイトルに一致したものを先に、次に最新の一致メッセージ（無ければ会話の更新）が新しい順。
export async function searchChats(userId: string, terms: string[]): Promise<ChatSearchResult[]> {
  if (!terms.length) return [];
  const rows = await prisma.$queryRaw<ChatRow[]>(Prisma.sql`
    SELECT r."id", r."title", r."icon", r."projectId", r."updatedAt", r."titleMatch", r."messageId", r."role", r."excerpt"
    FROM (
      SELECT s."id", s."title", s."icon", s."projectId", s."updatedAt",
        (${containsAll('s."title"', terms)}) AS "titleMatch",
        h."messageId", h."role"::text AS "role",
        substr(h."content", GREATEST(1, strpos(lower(h."content"), ${terms[0]}) - ${literal(EXCERPT_BEFORE)}), ${literal(EXCERPT_CHARS)}) AS "excerpt",
        COALESCE(h."messageAt", s."updatedAt") AS "sortAt"
      FROM ${table("Session")} s
      LEFT JOIN (
        SELECT DISTINCT ON (m."sessionId") m."sessionId", m."id" AS "messageId", m."role", m."content", m."createdAt" AS "messageAt"
        FROM ${table("Message")} m
        JOIN ${table("Session")} ms ON ms."id" = m."sessionId"
        CROSS JOIN LATERAL (SELECT lower(m."content") AS "lc") l
        WHERE ms."userId" = ${userId} AND ms."noteId" IS NULL AND m."role" IN ('USER', 'ASSISTANT')
          AND ${containsAllLowered('l."lc"', terms)}
        ORDER BY m."sessionId", m."createdAt" DESC, m."id" DESC
      ) h ON h."sessionId" = s."id"
      WHERE s."userId" = ${userId} AND s."noteId" IS NULL
    ) r
    WHERE r."titleMatch" OR r."messageId" IS NOT NULL
    ORDER BY r."titleMatch" DESC, r."sortAt" DESC, r."id" DESC
    LIMIT ${SEARCH_RESULT_LIMIT}`);
  return rows.map((row) => ({
    kind: "chat",
    id: row.id,
    title: row.title,
    icon: row.icon,
    // excerpt は語の 100 文字前から始まる。buildSnippet が先頭・末尾の省略記号を全文のときと同じ条件で付ける。
    snippet: row.excerpt ? buildSnippet(row.excerpt, terms) : "",
    messageId: row.messageId,
    role: row.role === "USER" || row.role === "ASSISTANT" ? row.role : null,
    projectId: row.projectId,
    titleMatch: row.titleMatch === true,
    updatedAt: toIso(row.updatedAt),
  }));
}
