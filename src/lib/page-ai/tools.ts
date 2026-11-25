import { Prisma } from "@/generated/prisma/client";
import type { ToolDefinition, ToolRun } from "@/lib/chat-tools";
import { parseCanvasSegments } from "@/lib/canvas-document";
import { readCanvasData } from "@/lib/canvas-store";
import { listChatAttachments } from "@/lib/note-attachments";
import { blocksToMarkdown } from "@/lib/note-markdown";
import { AI_SEMANTIC_THRESHOLD, scheduleNoteEmbeddingBackfill, scheduleNoteEmbeddingSync, semanticSearchNotes } from "@/lib/note-embeddings";
import { databaseSchema, prisma } from "@/lib/prisma";
import { isPageKind, PAGE_KINDS, pageKindOf, type PageKind } from "@/lib/page-kinds";
import { canvasBodyValues, noteBodyValues, termHit } from "@/lib/search";
import { buildSearchSnippet, foldSearchText, likePattern } from "@/lib/search-fold";
import { discardStoredFiles } from "@/lib/stored-files";
import { parseSearchTerms } from "@/types/search";
import { fmt, msg } from "@/lib/i18n/translate";
import { AdapterError, MAX_READ_CHARS, type AdapterContext, type AdapterPage, type PageAdapter } from "@/lib/page-ai/adapter";
import { applyProposal, proposalView, saveProposal, type ProposalView } from "@/lib/page-ai/proposals";
import { delimitPageContent } from "@/lib/page-ai/delimit";
import { adapterFor, allAdapters } from "@/lib/page-ai/registry";

export { blocksToMarkdown, likePattern, MAX_READ_CHARS };

// AI 操控底座のツール（docs/architecture/chat-flow.md の「AI 操控底座」）。定義はプロバイダー非依存の JSON Schema で 1 つだけ持ち、
// 各プロバイダーの形式への変換は送信直前（anthropic-messages.ts / responses-tool-loop.ts）で行う。
// 共通のツール（探す・一覧・読む・添付の一覧・予覧）はここ、種類ごとの操作のツール（propose_note_edit など）は各アダプターが持つ。
// ツール名は会話の履歴に残るので、一度出したら変えない。

const SEARCH_TOOL: ToolDefinition = {
  name: "search_notes",
  description: "Search all of the user's pages in their NoteFable Workspace (notes, whiteboards and slide decks) by keywords and by meaning. Pages whose title or text contain every word (ignoring case, full-width/half-width and hiragana/katakana differences) come first, then pages with a similar meaning even when they use different wording or another language. Returns up to 10 matches with page IDs, their kind (note, whiteboard or slides), title, last update time and short snippets. An empty query lists the most recently edited pages.",
  parameters: {
    type: "object",
    properties: { query: { type: "string", description: "Words to look for in page titles and text. Use an empty string to list recent pages." } },
    required: ["query"],
    additionalProperties: false,
  },
};

const LIST_TOOL: ToolDefinition = {
  name: "list_pages",
  description: "List the user's pages in their NoteFable Workspace with their IDs, kind (note, whiteboard or slides), title, project, parent page, number of sub-pages and last update time. Use parentId to list the sub-pages inside one page (in their order); otherwise it lists pages of any depth, most recently edited first. Use kind to list only notes, whiteboards or slide decks. Returns up to 50 pages.",
  parameters: {
    type: "object",
    properties: {
      kind: { type: ["string", "null"], description: "\"note\", \"whiteboard\" or \"slides\" to list only that kind, or null for every kind." },
      parentId: { type: ["string", "null"], description: "A page ID to list the sub-pages inside it, or null." },
    },
    required: ["kind", "parentId"],
    additionalProperties: false,
  },
};

const READ_TOOL: ToolDefinition = {
  name: "read_note",
  description: "Read one of the user's pages in their NoteFable Workspace. Use an ID returned by search_notes or list_pages. Shows the page kind and version. A note comes back as Markdown where every block starts with its number like [3]; propose_note_edit refers to blocks by these numbers and needs the version shown here. A whiteboard comes back with its frames, elements (with IDs, types, text, groups, page links) and arrow/line connections; a slide deck comes back with its theme, sections, slides (with stable slide IDs, layouts, elements with IDs/roles, tables, image descriptions and speaker notes).",
  parameters: {
    type: "object",
    properties: { noteId: { type: "string", description: "The page ID from search_notes or list_pages." } },
    required: ["noteId"],
    additionalProperties: false,
  },
};

const ATTACHMENTS_TOOL: ToolDefinition = {
  name: "list_chat_attachments",
  description: "List the files the user has attached in this chat (newest first) with their attachment IDs. Use it when the user wants an image they sent put into a note: then write a line `![caption](attachment:ID)` in the markdown of propose_note_edit or propose_note_create. Only images can be placed in a note; for other files you already have their text in the conversation.",
  parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
};

const PREVIEW_TOOL: ToolDefinition = {
  name: "preview_page",
  description: "Render a whiteboard or one slide of a slide deck as an image so you can see its layout, colors and drawings. slideId picks the slide (an ID from read_note); elementIds limits a whiteboard to the area around those elements (empty for the whole board).",
  parameters: {
    type: "object",
    properties: {
      noteId: { type: "string", description: "The page ID." },
      slideId: { type: ["string", "null"], description: "For a slide deck, the slide to render; null for the first slide." },
      elementIds: { type: "array", items: { type: "string" }, description: "For a whiteboard, the elements to frame; empty for the whole board." },
    },
    required: ["noteId", "slideId", "elementIds"],
    additionalProperties: false,
  },
};

// このリクエストで使えるツール。vision はモデルが画像を読めるか（予覧は、描けるアダプターがあって画像を読めるときだけ）。
export function pageToolDefinitions({ vision = false }: { vision?: boolean } = {}): ToolDefinition[] {
  const adapters = allAdapters();
  return [
    SEARCH_TOOL, LIST_TOOL, READ_TOOL, ATTACHMENTS_TOOL,
    ...adapters.flatMap((adapter) => (adapter.edit ? [adapter.edit.tool] : [])),
    ...adapters.flatMap((adapter) => (adapter.create ? [adapter.create.tool] : [])),
    ...(vision && adapters.some((adapter) => adapter.preview) ? [PREVIEW_TOOL] : []),
  ];
}

// ツールを実行するときの文脈。userId・sessionId はサーバーのセッションのもので、モデルの入力からは決して取らない。
// autoApply は AI パネルの「自動適用」（提案をすぐ適用する）。vision はモデルが画像を読めるか。
// autoApply は AI パネルの「自動適用」。編集はそのパネルのページ（panelPageId）だけ、ロックしていなければすぐ適用する。
// ほかのページへの編集は、自動適用のときも待確認の提案のまま。新しいページは自動適用ならすぐ作る。
export type ToolContext = AdapterContext & {
  autoApply?: boolean;
  panelPageId?: string;
  vision?: boolean;
  focusSelection?: { pageId: string; ids: readonly string[] };
};

const SEARCH_RESULT_LIMIT = 10;
const LIST_LIMIT = 50;

type SearchRow = { id: string; kind: string; title: string; updatedAt: Date; body: string | null };

// 一致した語の周辺だけを返す。語が本文になくタイトルだけで一致した場合は本文の先頭を返す。表記ゆれ（全角・半角、かな）を越えて一致した位置を探す。
export function buildSnippet(body: string | null, terms: string[]) {
  return buildSearchSnippet(body, terms.map(foldSearchText));
}

type PageSearchResult = { id: string; kind: PageKind; title: string; snippet: string; updatedAt: string };

// 所有者のページ（ゴミ箱のものを除く）を DB 側で検索する。全語を含むページだけを、タイトル一致の多い順、更新日の新しい順に返す。
// 語は畳み込み（search-fold.ts）、DB 側は本文を畳み込まず語のほうを正規表現に広げる（サイト内検索と同じ）。
// 本文は JSON 文字列をデコードしてから連結するため、\ や " を含む語もそのまま一致する。
// 本文 JSON 全体は転送せず、一致した最大 10 件の本文文字列だけを受け取る。語が空なら最近編集したページを返す。
async function searchPagesByKeyword(userId: string, terms: string[]): Promise<PageSearchResult[]> {
  const table = Prisma.raw(`"${databaseSchema}"."NotePage"`);
  const filter = terms.length
    ? Prisma.sql` AND ${Prisma.join(terms.map((term) => Prisma.sql`(${termHit('p."title"', term)} OR ${termHit('t."body"', term)})`), " AND ")}`
    : Prisma.empty;
  const order = terms.length
    ? Prisma.sql`${Prisma.join(terms.map((term) => Prisma.sql`(CASE WHEN ${termHit('p."title"', term)} THEN 1 ELSE 0 END)`), " + ")} DESC, `
    : Prisma.empty;
  const rows = await prisma.$queryRaw<SearchRow[]>(Prisma.sql`
    SELECT p."id", p."kind"::text AS "kind", p."title", p."updatedAt", t."body"
    FROM ${table} p
    LEFT JOIN ${Prisma.raw(`"${databaseSchema}"."NoteCanvas"`)} c ON c."noteId" = p."id"
    CROSS JOIN LATERAL (
      SELECT string_agg(value, ' ') AS "body"
      FROM jsonb_array_elements_text(${noteBodyValues(table)} || ${canvasBodyValues()})
    ) t
    WHERE p."userId" = ${userId} AND p."deletedAt" IS NULL${filter}
    ORDER BY ${order}p."updatedAt" DESC
    LIMIT ${SEARCH_RESULT_LIMIT}`);
  return rows.map((row) => ({ id: row.id, kind: pageKindOf(row), title: row.title, snippet: buildSearchSnippet(row.body, terms), updatedAt: new Date(row.updatedAt).toISOString() }));
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
    .map((hit) => ({ id: hit.id, kind: hit.kind, title: hit.title, snippet: buildSearchSnippet(hit.chunkText || hit.title, terms), updatedAt: hit.updatedAt.toISOString() }));
  return [...keyword, ...extra].slice(0, SEARCH_RESULT_LIMIT);
}

function args(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function input(value: unknown, key: string) {
  const raw = args(value)[key];
  return typeof raw === "string" ? raw.trim().slice(0, 200) : null;
}

function toolError(content: string, label: string = msg("Edit proposal rejected")): ToolRun {
  return { content, isError: true, label };
}

// ページの内容を区切る印は delimit.ts（画成図など、ツールの外の 1 回きりの生成も同じ印を使う）。
export { delimitPageContent } from "@/lib/page-ai/delimit";

// 本人の、ゴミ箱に入っていないページ。本体（NoteCanvas.data）は、それを読むアダプターのときだけ後から読む（大きいので）。
async function loadPage(userId: string, pageId: string): Promise<{ page: AdapterPage; adapter: PageAdapter } | null> {
  const row = await prisma.notePage.findFirst({
    where: { id: pageId, userId, deletedAt: null },
    select: { id: true, kind: true, title: true, icon: true, blocks: true, version: true, updatedAt: true, locked: true, canvas: { select: { segments: true } } },
  });
  if (!row) return null;
  const { canvas, ...rest } = row;
  const page: AdapterPage = { ...rest, kind: pageKindOf(row), segments: parseCanvasSegments(canvas?.segments) };
  const adapter = adapterFor(page.kind);
  if (adapter.needsData && page.kind !== "note") page.data = await readCanvasData(userId, pageId);
  return { page, adapter };
}

async function readPage(userId: string, pageId: string, focusIds?: readonly string[]): Promise<ToolRun> {
  const loaded = await loadPage(userId, pageId);
  if (!loaded) return { content: "Page not found.", isError: true, label: msg("Page not found") };
  const { page, adapter } = loaded;
  if (focusIds?.length) page.focusIds = focusIds;
  const body = adapter.read(page);
  const content = body.length > MAX_READ_CHARS ? `${body.slice(0, MAX_READ_CHARS)}\n\n[Truncated: the page is longer than ${MAX_READ_CHARS} characters.]` : body;
  const note = adapter.readNote?.(page);
  return {
    content: `noteId: ${page.id}\nkind: ${page.kind}\nversion: ${page.version}\nupdatedAt: ${page.updatedAt.toISOString()}\n${note ? `\n${note}\n` : ""}\n${delimitPageContent(content)}`,
    label: fmt("Read “{title}”", { title: page.title }),
  };
}

async function listPages(userId: string, value: unknown): Promise<ToolRun> {
  const { kind: rawKind, parentId: rawParent } = args(value);
  if (rawKind !== null && rawKind !== undefined && !isPageKind(rawKind)) return { content: `kind must be one of ${PAGE_KINDS.join(", ")}, or null.`, isError: true, label: msg("Invalid page list") };
  if (rawParent !== null && rawParent !== undefined && typeof rawParent !== "string") return { content: "parentId must be a page ID or null.", isError: true, label: msg("Invalid page list") };
  const kind = isPageKind(rawKind) ? rawKind : null;
  const parentId = typeof rawParent === "string" && rawParent.trim() ? rawParent.trim().slice(0, 200) : null;
  if (parentId && !await prisma.notePage.findFirst({ where: { id: parentId, userId, deletedAt: null }, select: { id: true } })) {
    return { content: "Page not found.", isError: true, label: msg("Page not found") };
  }
  const rows = await prisma.notePage.findMany({
    where: { userId, deletedAt: null, ...(kind ? { kind } : {}), ...(parentId ? { parentId } : {}) },
    orderBy: parentId ? [{ position: "asc" }, { createdAt: "desc" }, { id: "desc" }] : [{ updatedAt: "desc" }, { id: "desc" }],
    take: LIST_LIMIT + 1,
    select: {
      id: true, kind: true, title: true, parentId: true, updatedAt: true, group: { select: { name: true } },
      _count: { select: { children: { where: { deletedAt: null } } } },
    },
  });
  const pages = rows.slice(0, LIST_LIMIT).map((row) => ({
    id: row.id, kind: pageKindOf(row), title: row.title, project: row.group?.name ?? null, parentId: row.parentId,
    subpages: row._count.children, updatedAt: row.updatedAt.toISOString(),
  }));
  return {
    content: JSON.stringify({ pages, ...(rows.length > LIST_LIMIT ? { more: true } : {}), ...(pages.length ? {} : { note: "No pages." }) }),
    label: msg("Listed pages"),
  };
}

// 提案を保存し、apply（自動適用の対象・確認なしに作るアダプター）ならすぐ適用する。保存できなかったら、提案のために写したファイルを消す。
async function saveAndMaybeApply(
  ctx: ToolContext, save: () => Promise<ProposalView>, copiedFiles: string[] | undefined, apply: boolean, skipped?: string,
) {
  let view: ProposalView;
  try {
    view = await save();
  } catch (error) {
    if (copiedFiles?.length) await discardStoredFiles(copiedFiles);
    throw error;
  }
  if (!apply) return { view, applied: false as const, ...(skipped ? { failure: skipped } : {}) };
  // 適用に失敗しても（DB の一時的な失敗を含む）、保存した提案はカードとして出し、利用者が自分で適用・破棄できるようにする。
  // ただし、書き込みは済んだ後の読み直しで失敗したときは、適用済みとして扱う（待確認として出すと、モデルも画面も食い違う）。
  const committed = async () => {
    const latest = await proposalView(ctx.userId, view.id).catch(() => null);
    if (latest?.status !== "applied") return null;
    if (latest.appliedPageId) scheduleNoteEmbeddingSync(ctx.userId, [latest.appliedPageId]);
    return { view: latest, applied: true as const };
  };
  let result: Awaited<ReturnType<typeof applyProposal>>;
  try {
    result = await applyProposal(ctx.userId, view.id, { auto: true });
  } catch (error) {
    console.error("Failed to auto-apply a page proposal", error);
    return (await committed()) ?? { view, applied: false as const, failure: "The change could not be applied automatically." };
  }
  if (!result.ok) return (await committed()) ?? { view, applied: false as const, failure: result.error };
  // 手動の適用（/api/proposals/:id/apply）と同じく、意味検索の索引を書き直す。
  const pageId = (result.page as { id?: unknown } | null)?.id;
  if (typeof pageId === "string") scheduleNoteEmbeddingSync(ctx.userId, [pageId]);
  // 読み直せなくても、適用した結果をカードに出す（待確認のまま出すと、適用・破棄のボタンが出て、開いた編集も読み直されない）。
  const applied: ProposalView = { ...view, status: "applied", autoApplied: true, undoable: true, ...(typeof pageId === "string" ? { appliedPageId: pageId } : {}) };
  return { view: (await proposalView(ctx.userId, view.id).catch(() => null)) ?? applied, applied: true as const };
}

function proposalResult(kind: "edit" | "create", outcome: { applied: boolean; failure?: string }) {
  if (outcome.applied) {
    return JSON.stringify({
      status: "applied", applied: true,
      message: kind === "edit"
        ? "The change was applied right away because the user turned on auto-apply. The user can undo it from the card. Briefly say what you changed."
        : "The page was created right away. The user can undo it from the card (it moves to Trash). Briefly say what you created.",
    });
  }
  return JSON.stringify({
    status: "proposed", applied: false, ...(kind === "create" ? { created: false } : {}),
    ...(outcome.failure ? { autoApplyFailed: outcome.failure } : {}),
    message: kind === "edit"
      ? "The proposal is shown to the user. Nothing has been changed yet. Briefly say what you proposed and ask the user to review and apply it; do not say the page was updated."
      : "The proposal is shown to the user. No page has been created yet. Briefly say what you proposed and ask the user to review and apply it; do not say the page was created.",
  });
}

// 種類ごとの操作のツール。対象のページを読み、版を確かめてからアダプターに提案を作らせる。
async function runEdit(adapter: PageAdapter, value: unknown, ctx: ToolContext): Promise<ToolRun> {
  const tool = adapter.edit!.tool.name;
  const raw = args(value);
  const pageId = typeof raw.noteId === "string" ? raw.noteId.trim().slice(0, 200) : "";
  if (!pageId) return toolError("noteId must be a non-empty string.");
  if (!Number.isSafeInteger(raw.version)) return toolError("version must be the integer shown by read_note.");
  const loaded = await loadPage(ctx.userId, pageId);
  if (!loaded) return toolError("Page not found.", msg("Page not found"));
  const { page } = loaded;
  const kind = page.kind;
  if (kind !== adapter.kind) {
    // 別の種類のページ。その種類に操作のツールがあれば、そちらを使うように言う。
    const other = adapterFor(kind).edit?.tool.name;
    return toolError(other
      ? `This page is ${KIND_NAMES[kind]}, not ${KIND_NAMES[adapter.kind]}, so ${tool} cannot change it. Use ${other}.`
      : `This page is ${KIND_NAMES[kind]}, not ${KIND_NAMES[adapter.kind]}, so ${tool} cannot change it. Tell the user it cannot be edited from chat yet.`);
  }
  if (page.version !== raw.version) {
    return toolError(`The page changed after you read it (it is now version ${page.version}). Call read_note again and redo the edits.`, msg("Note changed since it was read"));
  }
  const draft = await adapter.edit!.propose(ctx, page, value);
  if (draft.unchanged) {
    if (draft.copiedFiles?.length) await discardStoredFiles(draft.copiedFiles);
    return toolError("The edits change nothing.");
  }
  // 自動適用は、AI パネルのページそのもので、ロックしていないときだけ。ほかのページ・ロックしたページは待確認の提案のまま。
  const own = Boolean(ctx.autoApply && ctx.panelPageId === page.id);
  const skipped = ctx.autoApply
    ? (!own ? "Auto-apply only changes the page the user has open, so this edit to another page waits for the user to apply it."
      : page.locked ? "The page is locked, so the edit was not applied automatically and waits for the user to apply it." : undefined)
    : undefined;
  const outcome = await saveAndMaybeApply(ctx, () => saveProposal(ctx.userId, ctx.sessionId, { kind: "EDIT", pageKind: kind, page, draft }), draft.copiedFiles, own && !page.locked, skipped);
  return {
    content: proposalResult("edit", outcome),
    label: outcome.applied ? fmt("Applied edits to “{title}”", { title: page.title }) : fmt("Proposed edits to “{title}”", { title: page.title }),
    events: [{ ...outcome.view, type: "notefable.proposal" }],
  };
}

async function runCreate(adapter: PageAdapter, value: unknown, ctx: ToolContext): Promise<ToolRun> {
  const draft = await adapter.create!.propose(ctx, value);
  // サブページの親は、自分のゴミ箱に入っていないページだけ（作るときにもう一度確かめる）。
  let parentTitle: string | undefined;
  if (draft.parentId) {
    const parent = await prisma.notePage.findFirst({ where: { id: draft.parentId, userId: ctx.userId, deletedAt: null }, select: { title: true } })
      .catch(async (error) => {
        if (draft.copiedFiles?.length) await discardStoredFiles(draft.copiedFiles);
        throw error;
      });
    if (!parent) {
      if (draft.copiedFiles?.length) await discardStoredFiles(draft.copiedFiles);
      return toolError("The parent page was not found. Use an ID from search_notes or list_pages, or null.", msg("Note proposal rejected"));
    }
    parentTitle = parent.title;
  }
  const outcome = await saveAndMaybeApply(ctx, () => saveProposal(ctx.userId, ctx.sessionId, { kind: "CREATE", pageKind: adapter.kind, draft, parentTitle }), draft.copiedFiles, Boolean(ctx.autoApply || adapter.create!.direct));
  return {
    content: proposalResult("create", outcome),
    label: outcome.applied ? fmt("Created page “{title}”", { title: draft.title }) : fmt("Proposed new note “{title}”", { title: draft.title }),
    events: [{ ...outcome.view, type: "notefable.create_proposal" }],
  };
}

async function runPreview(value: unknown, ctx: ToolContext): Promise<ToolRun> {
  const raw = args(value);
  const pageId = typeof raw.noteId === "string" ? raw.noteId.trim().slice(0, 200) : "";
  if (!pageId) return { content: "noteId must be a non-empty string.", isError: true, label: msg("Preview failed") };
  if (!ctx.vision) return { content: "This model cannot view images.", isError: true, label: msg("Preview failed") };
  const loaded = await loadPage(ctx.userId, pageId);
  if (!loaded) return { content: "Page not found.", isError: true, label: msg("Page not found") };
  const { page, adapter } = loaded;
  if (!adapter.preview) return { content: `A preview of ${KIND_NAMES[adapter.kind]} is not available. Use read_note instead.`, isError: true, label: msg("Preview failed") };
  if (!page.data && page.kind !== "note") page.data = await readCanvasData(ctx.userId, pageId);
  const elementIds = Array.isArray(raw.elementIds) ? raw.elementIds.filter((id): id is string => typeof id === "string").slice(0, 200) : [];
  const image = await adapter.preview(page, { slideId: typeof raw.slideId === "string" && raw.slideId ? raw.slideId : null, elementIds });
  if (!image) return { content: "The preview could not be rendered.", isError: true, label: msg("Preview failed") };
  return { content: `Preview of “${page.title}” (${page.kind}).`, label: fmt("Previewed “{title}”", { title: page.title }), images: [image] };
}

const KIND_NAMES: Record<PageKind, string> = { note: "a note", whiteboard: "a whiteboard", slides: "a slide deck" };

// モデルが求めたツールを実行する。userId はサーバーのセッションから渡し、モデルの入力からは決して取らない。
// 失敗はエラー結果としてモデルへ返し、モデル自身に言い直しや説明をさせる。
// excludeMessageIds：再生成で置き換えられる発言。まだ表示中のまま残っているので、チャットの添付を扱うツールからは外す。
export async function runPageTool(name: string, value: unknown, ctx: ToolContext): Promise<ToolRun> {
  try {
    if (name === "search_notes") {
      const query = input(value, "query");
      if (query === null) return { content: "query must be a string.", isError: true, label: msg("Invalid page search") };
      const results = await searchPages(ctx.userId, query);
      return {
        content: JSON.stringify({ results, ...(results.length ? {} : { note: "No matching notes." }) }),
        label: query ? fmt("Searched pages for “{query}”", { query }) : msg("Listed recent pages"),
      };
    }
    if (name === "list_pages") return await listPages(ctx.userId, value);
    if (name === "read_note") {
      const pageId = input(value, "noteId");
      if (!pageId) return { content: "noteId must be a non-empty string.", isError: true, label: msg("Invalid page read") };
      const focusIds = ctx.focusSelection?.pageId === pageId ? ctx.focusSelection.ids : undefined;
      return await readPage(ctx.userId, pageId, focusIds);
    }
    if (name === "list_chat_attachments") {
      const attachments = await listChatAttachments(ctx.userId, ctx.sessionId, ctx.excludeMessageIds);
      return { content: JSON.stringify({ attachments, ...(attachments.length ? {} : { note: "The user has not attached anything in this chat." }) }), label: msg("Listed attached files") };
    }
    if (name === "preview_page") return await runPreview(value, ctx);
    for (const adapter of allAdapters()) {
      if (adapter.edit?.tool.name === name) return await runEdit(adapter, value, ctx);
      if (adapter.create?.tool.name === name) return await runCreate(adapter, value, ctx);
    }
    return { content: `Unknown tool: ${name}`, isError: true, label: msg("Unknown tool") };
  } catch (error) {
    if (error instanceof AdapterError) return toolError(error.message, error.label);
    throw error;
  }
}
