import { Prisma } from "@/generated/prisma/client";
import type { ToolDefinition, ToolRun } from "@/lib/chat-tools";
import { databaseSchema, prisma } from "@/lib/prisma";

// チャットのモデルに渡す Pages ツール。定義はプロバイダー非依存の JSON Schema で持ち、
// 各プロバイダーの形式への変換は送信直前（anthropic-messages.ts / chat-tools.ts）で行う。

export const PAGE_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "search_pages",
    description: "Search all of the user's StudyMate Pages (their own notes) by title and text. Every word must appear (case-insensitive substring match, no synonyms or translation), so try other wordings or languages if nothing matches. Returns up to 10 matches with page IDs and short snippets, title matches first. An empty query lists the most recently edited pages.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "Words to look for in page titles and text. Use an empty string to list recent pages." } },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "read_page",
    description: "Read one of the user's StudyMate Pages as Markdown. Use a page ID returned by search_pages.",
    parameters: {
      type: "object",
      properties: { pageId: { type: "string", description: "The page ID from search_pages." } },
      required: ["pageId"],
      additionalProperties: false,
    },
  },
];

const SEARCH_RESULT_LIMIT = 10;
const MAX_SEARCH_TERMS = 8;
const SNIPPET_CHARS = 160;
export const MAX_READ_CHARS = 20_000;

type Inline = { type?: unknown; text?: unknown; styles?: unknown; content?: unknown; href?: unknown };
type NoteBlock = { type?: unknown; props?: Record<string, unknown>; content?: unknown; children?: unknown };

function inlineToMarkdown(content: unknown, plain = false): string {
  if (!Array.isArray(content)) return "";
  return (content as Inline[]).map((entry) => {
    if (entry?.type === "link" && typeof entry.href === "string") {
      const text = inlineToMarkdown(entry.content, plain);
      return plain ? text : `[${text}](${entry.href})`;
    }
    if (entry?.type !== "text" || typeof entry.text !== "string") return "";
    if (plain || !entry.text.trim()) return entry.text;
    const styles = (entry.styles ?? {}) as Record<string, unknown>;
    let text = entry.text;
    if (styles.code) text = `\`${text}\``;
    if (styles.bold) text = `**${text}**`;
    if (styles.italic) text = `*${text}*`;
    if (styles.strike) text = `~~${text}~~`;
    return text;
  }).join("");
}

// 保存済みの BlockNote JSON を、モデルが読みやすい Markdown にする。不明なブロックは本文だけ残す。
export function blocksToMarkdown(blocks: unknown, depth = 0): string {
  if (!Array.isArray(blocks) || depth > 8) return "";
  const indent = "  ".repeat(depth);
  const lines: string[] = [];
  for (const block of blocks as NoteBlock[]) {
    if (!block || typeof block !== "object") continue;
    const props = block.props ?? {};
    if (block.type === "codeBlock") {
      const code = inlineToMarkdown(block.content, true);
      const language = typeof props.language === "string" ? props.language : "";
      lines.push(`${indent}\`\`\`${language}`, ...code.split("\n").map((line) => indent + line), `${indent}\`\`\``);
    } else if (block.type === "divider") {
      lines.push(`${indent}---`);
    } else {
      const text = inlineToMarkdown(block.content);
      const prefix =
        block.type === "heading" ? `${"#".repeat(Math.min(Math.max(Number(props.level) || 1, 1), 3))} ` :
        block.type === "bulletListItem" ? "- " :
        block.type === "numberedListItem" ? "1. " :
        block.type === "checkListItem" ? (props.checked ? "- [x] " : "- [ ] ") :
        block.type === "quote" ? "> " : "";
      if (text.trim() || prefix) lines.push(`${indent}${prefix}${text}`);
    }
    const children = blocksToMarkdown(block.children, depth + 1);
    if (children) lines.push(children);
  }
  return lines.join("\n");
}

// 本文中の文字列（inline の text）だけを集める JSONPath。ブロック種別やスタイルのキーには一致させない。
const TEXT_PATH = 'strict $.** ? (@.type() == "object" && exists(@.text)).text';

type SearchRow = { id: string; title: string; updatedAt: Date; body: string | null };

// LIKE の % と _ を文字として扱う。エスケープ文字は SQL 側の ESCAPE '!' と合わせる。
export function likePattern(term: string) {
  return `%${term.replace(/[!%_]/g, (char) => `!${char}`)}%`;
}

// 一致した語の周辺だけを返す。語が本文になくタイトルだけで一致した場合は本文の先頭を返す。
export function buildSnippet(body: string | null, terms: string[]) {
  const text = (body ?? "").replace(/\s+/g, " ").trim();
  const lower = text.toLowerCase();
  const at = terms.map((term) => lower.indexOf(term)).find((index) => index >= 0) ?? 0;
  const start = Math.max(0, at - SNIPPET_CHARS / 4);
  return (start > 0 ? "…" : "") + text.slice(start, start + SNIPPET_CHARS) + (start + SNIPPET_CHARS < text.length ? "…" : "");
}

// 所有者のすべてのページを DB 側で検索する。全語を含むページだけを、タイトル一致の多い順、更新日の新しい順に返す。
// 本文は JSON 文字列をデコードしてから連結するため、\ や " を含む語もそのまま一致する。
// 本文 JSON 全体は転送せず、一致した最大 10 件の本文文字列だけを受け取る。
export async function searchPages(userId: string, query: string) {
  const terms = [...new Set(query.toLowerCase().split(/\s+/).filter(Boolean))].slice(0, MAX_SEARCH_TERMS);
  const table = Prisma.raw(`"${databaseSchema}"."NotePage"`);
  const titleMatches = (term: string) => Prisma.sql`lower(p."title") LIKE ${likePattern(term)} ESCAPE '!'`;
  const filter = terms.length
    ? Prisma.sql` AND ${Prisma.join(terms.map((term) => Prisma.sql`(${titleMatches(term)} OR lower(t."body") LIKE ${likePattern(term)} ESCAPE '!')`), " AND ")}`
    : Prisma.empty;
  const order = terms.length
    ? Prisma.sql`${Prisma.join(terms.map((term) => Prisma.sql`(CASE WHEN ${titleMatches(term)} THEN 1 ELSE 0 END)`), " + ")} DESC, `
    : Prisma.empty;
  const rows = await prisma.$queryRaw<SearchRow[]>(Prisma.sql`
    SELECT p."id", p."title", p."updatedAt", t."body"
    FROM ${table} p
    CROSS JOIN LATERAL (
      SELECT string_agg(value, ' ') AS "body"
      FROM jsonb_array_elements_text(jsonb_path_query_array(p."blocks", ${TEXT_PATH}::jsonpath))
    ) t
    WHERE p."userId" = ${userId}${filter}
    ORDER BY ${order}p."updatedAt" DESC
    LIMIT ${SEARCH_RESULT_LIMIT}`);
  return rows.map((row) => ({ id: row.id, title: row.title, snippet: buildSnippet(row.body, terms), updatedAt: new Date(row.updatedAt).toISOString() }));
}

function input(value: unknown, key: string) {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
  return typeof raw === "string" ? raw.trim().slice(0, 200) : null;
}

// モデルが求めたツールを実行する。userId はサーバーのセッションから渡し、モデルの入力からは決して取らない。
// 失敗はエラー結果としてモデルへ返し、モデル自身に言い直しや説明をさせる。
export async function runPageTool(name: string, args: unknown, userId: string): Promise<ToolRun> {
  if (name === "search_pages") {
    const query = input(args, "query");
    if (query === null) return { content: "query must be a string.", isError: true, label: "Invalid page search" };
    const results = await searchPages(userId, query);
    return {
      content: JSON.stringify({ results, ...(results.length ? {} : { note: "No matching pages." }) }),
      label: query ? `Searched pages for “${query}”` : "Listed recent pages",
    };
  }
  if (name === "read_page") {
    const pageId = input(args, "pageId");
    if (!pageId) return { content: "pageId must be a non-empty string.", isError: true, label: "Invalid page read" };
    const page = await prisma.notePage.findFirst({ where: { id: pageId, userId }, select: { id: true, title: true, blocks: true, updatedAt: true } });
    if (!page) return { content: "Page not found.", isError: true, label: "Page not found" };
    const markdown = `# ${page.title}\n\n${blocksToMarkdown(page.blocks)}`;
    const content = markdown.length > MAX_READ_CHARS
      ? `${markdown.slice(0, MAX_READ_CHARS)}\n\n[Truncated: the page is longer than ${MAX_READ_CHARS} characters.]`
      : markdown;
    return { content: `pageId: ${page.id}\nupdatedAt: ${page.updatedAt.toISOString()}\n\n${content}`, label: `Read “${page.title}”` };
  }
  return { content: `Unknown tool: ${name}`, isError: true, label: "Unknown tool" };
}
