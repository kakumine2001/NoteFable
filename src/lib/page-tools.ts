import { Prisma } from "@/generated/prisma/client";
import type { ToolDefinition, ToolRun } from "@/lib/chat-tools";
import { NoteValidationError, validateNoteContent } from "@/lib/note-document";
import { blocksToMarkdown, type NoteBlock } from "@/lib/note-markdown";
import { applyPageEdits, MAX_EDITS, PageEditError, parseNewPageMarkdown, type PageCreateProposal, type PageEditProposal } from "@/lib/page-edit";
import { databaseSchema, prisma } from "@/lib/prisma";

export { blocksToMarkdown };

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
    description: "Read one of the user's StudyMate Pages as Markdown. Use a page ID returned by search_pages. Every block starts with its number like [3]; propose_page_edit refers to blocks by these numbers and needs the version shown here.",
    parameters: {
      type: "object",
      properties: { pageId: { type: "string", description: "The page ID from search_pages." } },
      required: ["pageId"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_page_edit",
    description: `Propose changes to one of the user's StudyMate Pages. This does NOT change the page: the user sees the proposal and must approve it, so never say the page was changed. Call read_page first and pass its pageId and version; if the page changed since then the proposal is rejected and you must read again. Edits refer to the [n] block numbers shown by read_page (all edits in one call use the numbering of that read). Operations: "replace" swaps block n and its nested children for the markdown; "insert_after" adds the markdown after block n (block 0 = at the very start of the page); "delete" removes block n and its nested children (markdown must be null). Markdown: each non-empty line becomes one block; # to ### headings, - bullets, 1. numbered items, - [ ] tasks, > quotes, code fences, --- dividers; indent nested list items by 2 spaces; **bold**, *italic*, ~~strike~~, \`code\`, [text](https://url). Up to ${MAX_EDITS} edits per call. Use title to rename the page (null keeps the title).`,
    parameters: {
      type: "object",
      properties: {
        pageId: { type: "string", description: "The page ID from search_pages or read_page." },
        version: { type: "integer", description: "The version shown by read_page." },
        title: { type: ["string", "null"], description: "New page title, or null to keep it." },
        edits: {
          type: "array",
          items: {
            type: "object",
            properties: {
              op: { type: "string", enum: ["replace", "insert_after", "delete"] },
              block: { type: "integer", description: "Block number from read_page; 0 only for insert_after at the start." },
              markdown: { type: ["string", "null"], description: "New content; null for delete." },
            },
            required: ["op", "block", "markdown"],
            additionalProperties: false,
          },
        },
      },
      required: ["pageId", "version", "title", "edits"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_page_create",
    description: "Propose a brand-new StudyMate Page for the user. This does NOT create anything: the user sees the proposal and must approve it, so never say the page was created. Use it only when the user asks for a new page or note (to change an existing page use propose_page_edit). markdown is the page body in the same format as propose_page_edit (each non-empty line becomes one block; # to ### headings, - bullets, 1. numbered items, - [ ] tasks, > quotes, code fences, --- dividers; indent nested list items by 2 spaces; **bold**, *italic*, ~~strike~~, `code`, [text](https://url)). Do not repeat the title as a heading in the body. icon is one emoji or null.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "The page title (at most 200 characters)." },
        markdown: { type: ["string", "null"], description: "The page body, or null for an empty page." },
        icon: { type: ["string", "null"], description: "A single emoji for the page icon, or null." },
      },
      required: ["title", "markdown", "icon"],
      additionalProperties: false,
    },
  },
];

const SEARCH_RESULT_LIMIT = 10;
const MAX_SEARCH_TERMS = 8;
const SNIPPET_CHARS = 160;
export const MAX_READ_CHARS = 20_000;

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

function toolError(content: string, label = "Edit proposal rejected"): ToolRun {
  return { content, isError: true, label };
}

// ページは変更しない。編集案を検証して画面に出し、ユーザーが適用するまで DB は動かない。
async function proposePageEdit(args: unknown, userId: string): Promise<ToolRun> {
  const value = args && typeof args === "object" ? args as Record<string, unknown> : {};
  const pageId = typeof value.pageId === "string" ? value.pageId.trim().slice(0, 200) : "";
  if (!pageId) return toolError("pageId must be a non-empty string.");
  if (!Number.isSafeInteger(value.version)) return toolError("version must be the integer shown by read_page.");
  if (value.title !== null && value.title !== undefined && typeof value.title !== "string") return toolError("title must be a string or null.");
  const page = await prisma.notePage.findFirst({ where: { id: pageId, userId }, select: { id: true, title: true, blocks: true, version: true } });
  if (!page) return toolError("Page not found.", "Page not found");
  if (page.version !== value.version) {
    return toolError(`The page changed after you read it (it is now version ${page.version}). Call read_page again and redo the edits.`, "Page changed since it was read");
  }
  try {
    const { blocks, changes } = applyPageEdits(page.blocks as NoteBlock[], value.edits);
    const requested = typeof value.title === "string" ? value.title.trim() : "";
    const content = validateNoteContent({ title: requested || page.title, blocks });
    if (!changes.length && content.title === page.title) return toolError("The edits change nothing.");
    const proposal: PageEditProposal = {
      id: crypto.randomUUID(), pageId: page.id, pageTitle: page.title, baseVersion: page.version,
      ...(content.title !== page.title ? { title: { before: page.title, after: content.title } } : {}),
      changes, proposed: { title: content.title, blocks: content.blocks },
    };
    return {
      content: JSON.stringify({ status: "proposed", applied: false, message: "The proposal is shown to the user. Nothing has been changed yet. Briefly say what you proposed and ask the user to review and apply it; do not say the page was updated." }),
      label: `Proposed edits to “${page.title}”`,
      events: [{ type: "studymate.proposal", ...proposal }],
    };
  } catch (error) {
    if (error instanceof PageEditError || error instanceof NoteValidationError) return toolError(error.message);
    throw error;
  }
}

// 新規ページも、ユーザーが適用するまで DB には何も作らない。DB を読まないので userId は要らない。
function proposePageCreate(args: unknown): ToolRun {
  const value = args && typeof args === "object" ? args as Record<string, unknown> : {};
  const title = typeof value.title === "string" ? value.title.trim() : "";
  if (!title) return toolError("title must be a non-empty string.");
  if (value.icon !== null && value.icon !== undefined && typeof value.icon !== "string") return toolError("icon must be a single emoji or null.");
  try {
    const blocks = parseNewPageMarkdown(value.markdown);
    const icon = typeof value.icon === "string" && value.icon.trim() ? value.icon.trim() : null;
    const content = validateNoteContent({ title, icon, blocks });
    const proposal: PageCreateProposal = {
      id: crypto.randomUUID(), title: content.title, icon: content.icon, content: blocksToMarkdown(content.blocks),
      proposed: { title: content.title, icon: content.icon, blocks: content.blocks },
    };
    return {
      content: JSON.stringify({ status: "proposed", created: false, message: "The proposal is shown to the user. No page has been created yet. Briefly say what you proposed and ask the user to review and apply it; do not say the page was created." }),
      label: `Proposed new page “${content.title}”`,
      events: [{ type: "studymate.create_proposal", ...proposal }],
    };
  } catch (error) {
    if (error instanceof PageEditError || error instanceof NoteValidationError) return toolError(error.message, "Page proposal rejected");
    throw error;
  }
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
    const page = await prisma.notePage.findFirst({ where: { id: pageId, userId }, select: { id: true, title: true, blocks: true, version: true, updatedAt: true } });
    if (!page) return { content: "Page not found.", isError: true, label: "Page not found" };
    const markdown = `# ${page.title}\n\n${blocksToMarkdown(page.blocks, 0, { n: 0 })}`;
    const content = markdown.length > MAX_READ_CHARS
      ? `${markdown.slice(0, MAX_READ_CHARS)}\n\n[Truncated: the page is longer than ${MAX_READ_CHARS} characters.]`
      : markdown;
    return { content: `pageId: ${page.id}\nversion: ${page.version}\nupdatedAt: ${page.updatedAt.toISOString()}\n\n${content}`, label: `Read “${page.title}”` };
  }
  if (name === "propose_page_edit") return proposePageEdit(args, userId);
  if (name === "propose_page_create") return proposePageCreate(args);
  return { content: `Unknown tool: ${name}`, isError: true, label: "Unknown tool" };
}
