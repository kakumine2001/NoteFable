import { Prisma } from "@/generated/prisma/client";
import type { ToolDefinition, ToolRun } from "@/lib/chat-tools";
import { NoteValidationError, validateNoteContent } from "@/lib/note-document";
import { isEmojiIcon } from "@/lib/emoji-icon";
import { createAttachmentResolver, listChatAttachments } from "@/lib/note-attachments";
import { assertNoteFilesOwner } from "@/lib/note-files";
import { blocksToMarkdown, type NoteBlock } from "@/lib/note-markdown";
import { saveProposal } from "@/lib/note-proposals";
import { applyPageEdits, MAX_EDITS, PageEditError, parseNewPageMarkdown } from "@/lib/page-edit";
import { AI_SEMANTIC_THRESHOLD, scheduleNoteEmbeddingBackfill, semanticSearchNotes } from "@/lib/note-embeddings";
import { databaseSchema, prisma } from "@/lib/prisma";
import { noteBodyValues, termHit } from "@/lib/search";
import { buildSearchSnippet, foldSearchText, likePattern } from "@/lib/search-fold";
import { parseSearchTerms } from "@/types/search";
import { fmt, msg } from "@/lib/i18n/translate";

export { blocksToMarkdown };

// チャットのモデルに渡す Pages ツール。定義はプロバイダー非依存の JSON Schema で持ち、
// 各プロバイダーの形式への変換は送信直前（anthropic-messages.ts / chat-tools.ts）で行う。

export const PAGE_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "search_notes",
    description: "Search all of the user's notes in their NoteFable Workspace by keywords and by meaning. Notes whose title or text contain every word (ignoring case, full-width/half-width and hiragana/katakana differences) come first, then notes with a similar meaning even when they use different wording or another language. Returns up to 10 matches with note IDs and short snippets. An empty query lists the most recently edited notes.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "Words to look for in note titles and text. Use an empty string to list recent notes." } },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "read_note",
    description: "Read one of the user's notes (in their NoteFable Workspace) as Markdown. Use a note ID returned by search_notes. Every block starts with its number like [3]; propose_note_edit refers to blocks by these numbers and needs the version shown here.",
    parameters: {
      type: "object",
      properties: { noteId: { type: "string", description: "The note ID from search_notes." } },
      required: ["noteId"],
      additionalProperties: false,
    },
  },
  {
    name: "list_chat_attachments",
    description: "List the files the user has attached in this chat (newest first) with their attachment IDs. Use it when the user wants an image they sent put into a note: then write a line `![caption](attachment:ID)` in the markdown of propose_note_edit or propose_note_create. Only images can be placed in a note; for other files you already have their text in the conversation.",
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  {
    name: "propose_note_edit",
    description: `Propose changes to one of the user's notes (in their NoteFable Workspace). This does NOT change the note: the user sees the proposal and must approve it, so never say the note was changed. Call read_note first and pass its noteId and version; if the note changed since then the proposal is rejected and you must read again. Edits refer to the [n] block numbers shown by read_note (all edits in one call use the numbering of that read). Operations: "replace" swaps block n and its nested children for the markdown; "insert_after" adds the markdown after block n (block 0 = at the very start of the note); "delete" removes block n and its nested children (markdown must be null). read_note shows an uploaded image or file as [Image: name — caption] or [File: name]; you can replace or delete those blocks like any other (the user is warned that the upload leaves the note), and a replacement may contain an image line (below). To put an image the user sent in this chat into the note, use the line \`![caption](attachment:ID)\` with an ID from list_chat_attachments, on its own line. Markdown: each non-empty line becomes one block; # to ### headings, - bullets, 1. numbered items, - [ ] tasks, > quotes, code fences, --- dividers, '▸ text' toggles ('# ▸ text' is a toggle heading; indent the hidden content by 2 spaces below it), '> [!💡] text' callouts (any single emoji), GFM tables (a '| a | b |' header row, a '| --- | --- |' line, then rows; the whole table is one block, so replace it as a whole), and block math ('$$' on its own lines around LaTeX); indent nested list items by 2 spaces; **bold**, *italic*, ~~strike~~, \`code\`, \`$inline math$\`, [text](https://url). Up to ${MAX_EDITS} edits per call. Use title to rename the note (null keeps the title).`,
    parameters: {
      type: "object",
      properties: {
        noteId: { type: "string", description: "The note ID from search_notes or read_note." },
        version: { type: "integer", description: "The version shown by read_note." },
        title: { type: ["string", "null"], description: "New note title, or null to keep it." },
        edits: {
          type: "array",
          items: {
            type: "object",
            properties: {
              op: { type: "string", enum: ["replace", "insert_after", "delete"] },
              block: { type: "integer", description: "Block number from read_note; 0 only for insert_after at the start." },
              markdown: { type: ["string", "null"], description: "New content; null for delete." },
            },
            required: ["op", "block", "markdown"],
            additionalProperties: false,
          },
        },
      },
      required: ["noteId", "version", "title", "edits"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_note_create",
    description: "Propose a brand-new note in the user's NoteFable Workspace. This does NOT create anything: the user sees the proposal and must approve it, so never say the note was created. Use it only when the user asks for a new note or note (to change an existing note use propose_note_edit). markdown is the note body in the same format as propose_note_edit (each non-empty line becomes one block; # to ### headings, - bullets, 1. numbered items, - [ ] tasks, > quotes, code fences, --- dividers, '▸ text' toggles ('# ▸ text' is a toggle heading; indent the hidden content by 2 spaces below it), '> [!💡] text' callouts (any single emoji), GFM tables (a '| a | b |' header row, a '| --- | --- |' line, then rows; the whole table is one block, so replace it as a whole), and block math ('$$' on its own lines around LaTeX); indent nested list items by 2 spaces; **bold**, *italic*, ~~strike~~, `code`, `$inline math$`, [text](https://url)). Do not repeat the title as a heading in the body. To include an image the user sent in this chat, put `![caption](attachment:ID)` on its own line, with an ID from list_chat_attachments. icon is one emoji or null.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "The note title (at most 200 characters)." },
        markdown: { type: ["string", "null"], description: "The note body, or null for an empty note." },
        icon: { type: ["string", "null"], description: "A single emoji for the note icon, or null." },
      },
      required: ["title", "markdown", "icon"],
      additionalProperties: false,
    },
  },
];

const SEARCH_RESULT_LIMIT = 10;
export const MAX_READ_CHARS = 20_000;

type SearchRow = { id: string; title: string; updatedAt: Date; body: string | null };

export { likePattern };

// 一致した語の周辺だけを返す。語が本文になくタイトルだけで一致した場合は本文の先頭を返す。表記ゆれ（全角・半角、かな）を越えて一致した位置を探す。
export function buildSnippet(body: string | null, terms: string[]) {
  return buildSearchSnippet(body, terms.map(foldSearchText));
}

type PageSearchResult = { id: string; title: string; snippet: string; updatedAt: string };

// 所有者のページ（ゴミ箱のものを除く）を DB 側で検索する。全語を含むページだけを、タイトル一致の多い順、更新日の新しい順に返す。
// 語は畳み込み（search-fold.ts）、DB 側は本文を畳み込まず語のほうを正規表現に広げる（サイト内検索と同じ）。
// 本文は JSON 文字列をデコードしてから連結するため、\ や " を含む語もそのまま一致する。
// 本文 JSON 全体は転送せず、一致した最大 10 件の本文文字列だけを受け取る。語が空なら最近編集したノートを返す。
async function searchPagesByKeyword(userId: string, terms: string[]): Promise<PageSearchResult[]> {
  const table = Prisma.raw(`"${databaseSchema}"."NotePage"`);
  const filter = terms.length
    ? Prisma.sql` AND ${Prisma.join(terms.map((term) => Prisma.sql`(${termHit('p."title"', term)} OR ${termHit('t."body"', term)})`), " AND ")}`
    : Prisma.empty;
  const order = terms.length
    ? Prisma.sql`${Prisma.join(terms.map((term) => Prisma.sql`(CASE WHEN ${termHit('p."title"', term)} THEN 1 ELSE 0 END)`), " + ")} DESC, `
    : Prisma.empty;
  const rows = await prisma.$queryRaw<SearchRow[]>(Prisma.sql`
    SELECT p."id", p."title", p."updatedAt", t."body"
    FROM ${table} p
    CROSS JOIN LATERAL (
      SELECT string_agg(value, ' ') AS "body"
      FROM jsonb_array_elements_text(${noteBodyValues(table)})
    ) t
    WHERE p."userId" = ${userId} AND p."deletedAt" IS NULL${filter}
    ORDER BY ${order}p."updatedAt" DESC
    LIMIT ${SEARCH_RESULT_LIMIT}`);
  return rows.map((row) => ({ id: row.id, title: row.title, snippet: buildSearchSnippet(row.body, terms), updatedAt: new Date(row.updatedAt).toISOString() }));
}

// キーワード（表記ゆれを吸収した部分一致）で見つかったものを先に、枠が余っていれば意味が近いもの（別の言い回し・別の言語）を後ろに足す。
export async function searchPages(userId: string, query: string): Promise<PageSearchResult[]> {
  const terms = parseSearchTerms(query);
  if (!terms.length) return searchPagesByKeyword(userId, []);
  const keyword = await searchPagesByKeyword(userId, terms);
  if (keyword.length >= SEARCH_RESULT_LIMIT) return keyword;
  const semantic = await semanticSearchNotes(userId, query, { limit: SEARCH_RESULT_LIMIT, minSimilarity: AI_SEMANTIC_THRESHOLD, maxBackfillNotes: 10, timeoutMs: 4000 });
  if (semantic.hasMoreBackfill) scheduleNoteEmbeddingBackfill(userId);
  const seen = new Set(keyword.map((page) => page.id));
  const extra = semantic.hits
    .filter((hit) => !seen.has(hit.id))
    .map((hit) => ({ id: hit.id, title: hit.title, snippet: buildSearchSnippet(hit.chunkText || hit.title, terms), updatedAt: hit.updatedAt.toISOString() }));
  return [...keyword, ...extra].slice(0, SEARCH_RESULT_LIMIT);
}
function input(value: unknown, key: string) {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
  return typeof raw === "string" ? raw.trim().slice(0, 200) : null;
}

function toolError(content: string, label: string = msg("Edit proposal rejected")): ToolRun {
  return { content, isError: true, label };
}

// ノートは変更しない。編集案を検証して保存し画面に出す。ユーザーが適用するまでノートは動かない。
async function proposePageEdit(args: unknown, userId: string, sessionId: string, excludeMessageIds: string[]): Promise<ToolRun> {
  const value = args && typeof args === "object" ? args as Record<string, unknown> : {};
  const pageId = typeof value.noteId === "string" ? value.noteId.trim().slice(0, 200) : "";
  if (!pageId) return toolError("noteId must be a non-empty string.");
  if (!Number.isSafeInteger(value.version)) return toolError("version must be the integer shown by read_note.");
  if (value.title !== null && value.title !== undefined && typeof value.title !== "string") return toolError("title must be a string or null.");
  const page = await prisma.notePage.findFirst({ where: { id: pageId, userId, deletedAt: null }, select: { id: true, title: true, blocks: true, version: true } });
  if (!page) return toolError("Note not found.", msg("Note not found"));
  if (page.version !== value.version) {
    return toolError(`The note changed after you read it (it is now version ${page.version}). Call read_note again and redo the edits.`, msg("Note changed since it was read"));
  }
  try {
    // 添付画像の参照は、すべての edit をまとめて検証・コピーしてから URL に置き換える（順番に処理し、並列にはしない）。
    let edits = value.edits;
    if (Array.isArray(value.edits)) {
      const entries = value.edits.map((edit: unknown) => edit && typeof edit === "object" ? edit as Record<string, unknown> : null);
      const markdowns = entries.map((entry) => entry && typeof entry.markdown === "string" ? entry.markdown : "");
      const resolved = await createAttachmentResolver(userId, sessionId, excludeMessageIds)(markdowns);
      edits = value.edits.map((edit: unknown, index: number) => entries[index] && typeof entries[index]!.markdown === "string" ? { ...entries[index], markdown: resolved[index] } : edit);
    }
    const { blocks, changes } = applyPageEdits(page.blocks as NoteBlock[], edits);
    const requested = typeof value.title === "string" ? value.title.trim() : "";
    const content = validateNoteContent({ title: requested || page.title, blocks });
    assertNoteFilesOwner(content.blocks, userId);
    if (!changes.length && content.title === page.title) return toolError("The edits change nothing.");
    const proposal = await saveProposal(userId, sessionId, { kind: "EDIT", payload: {
      pageId: page.id, pageTitle: page.title, baseVersion: page.version,
      ...(content.title !== page.title ? { title: { before: page.title, after: content.title } } : {}),
      changes, proposed: { title: content.title, blocks: content.blocks },
    } });
    return {
      content: JSON.stringify({ status: "proposed", applied: false, message: "The proposal is shown to the user. Nothing has been changed yet. Briefly say what you proposed and ask the user to review and apply it; do not say the note was updated." }),
      label: fmt("Proposed edits to “{title}”", { title: page.title }),
      events: [{ ...proposal, type: "notefable.proposal" }],
    };
  } catch (error) {
    if (error instanceof PageEditError || error instanceof NoteValidationError) return toolError(error.message);
    throw error;
  }
}

// 新規ノートも、ユーザーが適用するまでは作らない（提案だけを保存する）。
async function proposePageCreate(args: unknown, userId: string, sessionId: string, excludeMessageIds: string[]): Promise<ToolRun> {
  const value = args && typeof args === "object" ? args as Record<string, unknown> : {};
  const title = typeof value.title === "string" ? value.title.trim() : "";
  if (!title) return toolError("title must be a non-empty string.");
  if (value.icon !== null && value.icon !== undefined && typeof value.icon !== "string") return toolError("icon must be a single emoji or null.");
  try {
    const blocks = parseNewPageMarkdown(typeof value.markdown === "string" ? (await createAttachmentResolver(userId, sessionId, excludeMessageIds)([value.markdown]))[0] : value.markdown);
    const icon = typeof value.icon === "string" && value.icon.trim() ? value.icon.trim() : null;
    if (icon !== null && !isEmojiIcon(icon)) return toolError("icon must be a single emoji or null.");
    const content = validateNoteContent({ title, icon, blocks });
    assertNoteFilesOwner(content.blocks, userId);
    const proposal = await saveProposal(userId, sessionId, { kind: "CREATE", payload: {
      title: content.title, icon: content.icon, content: blocksToMarkdown(content.blocks),
      proposed: { title: content.title, icon: content.icon, blocks: content.blocks },
    } });
    return {
      content: JSON.stringify({ status: "proposed", created: false, message: "The proposal is shown to the user. No note has been created yet. Briefly say what you proposed and ask the user to review and apply it; do not say the note was created." }),
      label: fmt("Proposed new note “{title}”", { title: content.title }),
      events: [{ ...proposal, type: "notefable.create_proposal" }],
    };
  } catch (error) {
    if (error instanceof PageEditError || error instanceof NoteValidationError) return toolError(error.message, msg("Note proposal rejected"));
    throw error;
  }
}

// モデルが求めたツールを実行する。userId はサーバーのセッションから渡し、モデルの入力からは決して取らない。
// 失敗はエラー結果としてモデルへ返し、モデル自身に言い直しや説明をさせる。
// excludeMessageIds：再生成で置き換えられる発言。まだ表示中のまま残っているので、チャットの添付を扱うツールからは外す。
export async function runPageTool(name: string, args: unknown, userId: string, sessionId: string, excludeMessageIds: string[] = []): Promise<ToolRun> {
  if (name === "search_notes") {
    const query = input(args, "query");
    if (query === null) return { content: "query must be a string.", isError: true, label: msg("Invalid note search") };
    const results = await searchPages(userId, query);
    return {
      content: JSON.stringify({ results, ...(results.length ? {} : { note: "No matching notes." }) }),
      label: query ? fmt("Searched notes for “{query}”", { query }) : msg("Listed recent notes"),
    };
  }
  if (name === "read_note") {
    const pageId = input(args, "noteId");
    if (!pageId) return { content: "noteId must be a non-empty string.", isError: true, label: msg("Invalid note read") };
    const page = await prisma.notePage.findFirst({ where: { id: pageId, userId, deletedAt: null }, select: { id: true, title: true, blocks: true, version: true, updatedAt: true } });
    if (!page) return { content: "Note not found.", isError: true, label: msg("Note not found") };
    const markdown = `# ${page.title}\n\n${blocksToMarkdown(page.blocks, 0, { n: 0 })}`;
    const content = markdown.length > MAX_READ_CHARS
      ? `${markdown.slice(0, MAX_READ_CHARS)}\n\n[Truncated: the note is longer than ${MAX_READ_CHARS} characters.]`
      : markdown;
    return { content: `noteId: ${page.id}\nversion: ${page.version}\nupdatedAt: ${page.updatedAt.toISOString()}\n\n${content}`, label: fmt("Read “{title}”", { title: page.title }) };
  }
  if (name === "list_chat_attachments") {
    const attachments = await listChatAttachments(userId, sessionId, excludeMessageIds);
    return { content: JSON.stringify({ attachments, ...(attachments.length ? {} : { note: "The user has not attached anything in this chat." }) }), label: msg("Listed attached files") };
  }
  if (name === "propose_note_edit") return proposePageEdit(args, userId, sessionId, excludeMessageIds);
  if (name === "propose_note_create") return proposePageCreate(args, userId, sessionId, excludeMessageIds);
  return { content: `Unknown tool: ${name}`, isError: true, label: msg("Unknown tool") };
}
