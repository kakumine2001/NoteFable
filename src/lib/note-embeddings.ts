import { createHash } from "node:crypto";
import { after } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { searchableBlocks } from "@/lib/canvas-document";
import { optionalEnv } from "@/lib/env";
import { pageKindOf, type PageKind } from "@/lib/page-kinds";
import { excerptFromBlock, extractNoteChunks, type NoteTextChunk } from "@/lib/note-text";
import { databaseSchema, prisma } from "@/lib/prisma";
import { usageDay } from "@/lib/usage-limits";

// ノートの意味検索（セマンティック検索）。ノート本文をチャンクに分け、埋め込み（意味を表すベクトル）にして NoteEmbedding に持つ。
// 本文のコピーは索引に持たず、NotePage.version と一致するチャンクだけを使って、一致した上位ノートの現在の本文から抜粋を作る。
// ホワイトボード・スライドは本体ではなく、保存時に取り出した文字（NoteCanvas.segments）からチャンクを作る（searchableBlocks）。
// 検索語はリクエストをまたいで保持せず（キャッシュしない）、1 回の検索の中だけで使う。
// どの検索も利用者本人の分だけを対象にするので、pgvector は使わず、BYTEA の Float32 を JS で比べる（1 利用者ぶんは数千チャンクまで）。
// OPENAI_API_KEY が無い、または NOTEFABLE_SEMANTIC_SEARCH が 0 / false のときは何もしない（キーワード検索だけが働く）。

export const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
export const SUPPORTED_EMBEDDING_MODELS = new Set(["text-embedding-3-small", "text-embedding-3-large"]);
export const EMBEDDING_DIMENSIONS = 512;
export const UI_SEMANTIC_THRESHOLD = 0.34;
export const AI_SEMANTIC_THRESHOLD = 0.32;

const MAX_TEXTS_PER_REQUEST = 64;
const INDEX_TIMEOUT_MS = 10_000;
const MAX_SCANNED_CHUNKS = 2000;
const MIN_QUERY_CHARS = 2;
const BACKGROUND_BACKFILL_NOTES = 20;
const BACKGROUND_BACKFILL_ROUNDS = 5;
// インスタンスをまたいで共有する 1 日あたりの埋め込み上限（UsageCounter を使う）。
export const EMBED_QUERY_DAILY_LIMIT = 200;
export const EMBED_INDEX_DAILY_LIMIT = 200;

// 空白以外の文字を 1 文字以上含むテキストノードがあるか（extractNoteChunks の trim() と条件をそろえる）。
// PostgreSQL の JSONPath 文字列リテラルでは \\S を渡して正規表現の \S にする。
export const HAS_NON_WHITESPACE_TEXT = 'strict $.** ? (@.type() == "object" && exists(@.text) && @.text like_regex "\\\\S")';

let warnedInvalidModel: string | null = null;
const inFlightNoteVersions = new Set<string>();

export function resetEmbeddingStateForTest() {
  warnedInvalidModel = null;
  inFlightNoteVersions.clear();
}

export type EmbeddingConfig = { apiKey: string; baseUrl: string; model: string; dimensions: number };

export function embeddingConfig(): EmbeddingConfig | null {
  const switchValue = optionalEnv("NOTEFABLE_SEMANTIC_SEARCH")?.toLowerCase();
  if (switchValue === "0" || switchValue === "false") return null;
  const apiKey = optionalEnv("OPENAI_API_KEY");
  if (!apiKey) return null;
  const requested = optionalEnv("OPENAI_EMBEDDING_MODEL");
  let model = DEFAULT_EMBEDDING_MODEL;
  if (requested) {
    if (SUPPORTED_EMBEDDING_MODELS.has(requested)) {
      model = requested;
    } else if (warnedInvalidModel !== requested) {
      warnedInvalidModel = requested;
      console.warn(`Unsupported OPENAI_EMBEDDING_MODEL "${requested}"; falling back to ${DEFAULT_EMBEDDING_MODEL}.`);
    }
  }
  return {
    apiKey,
    baseUrl: (optionalEnv("OPENAI_BASE_URL") || "https://api.openai.com/v1").replace(/\/$/, ""),
    model,
    dimensions: EMBEDDING_DIMENSIONS,
  };
}

export const isSemanticSearchEnabled = () => embeddingConfig() !== null;

// ---- ベクトル ----

export function normalizeVector(values: number[]): Float32Array | null {
  let sum = 0;
  for (const value of values) {
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    sum += value * value;
  }
  const norm = Math.sqrt(sum);
  if (!(norm > 0)) return null;
  return Float32Array.from(values, (value) => value / norm);
}

// リトルエンディアンの Float32。byteOffset に関わらず同じバイト列になる。
export function encodeVector(vector: Float32Array): Uint8Array<ArrayBuffer> {
  const buffer = new ArrayBuffer(vector.length * 4);
  const view = new DataView(buffer);
  for (let index = 0; index < vector.length; index++) view.setFloat32(index * 4, vector[index], true);
  return new Uint8Array(buffer);
}

export function decodeVector(bytes: Uint8Array, expectedDimensions: number): Float32Array | null {
  if (bytes.byteLength !== expectedDimensions * 4) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const vector = new Float32Array(expectedDimensions);
  for (let index = 0; index < expectedDimensions; index++) vector[index] = view.getFloat32(index * 4, true);
  return vector;
}

export function dotProduct(a: Float32Array, b: Float32Array): number {
  const length = Math.min(a.length, b.length);
  let sum = 0;
  for (let index = 0; index < length; index++) sum += a[index] * b[index];
  return sum;
}

export function computeContentHash(title: string, chunks: NoteTextChunk[]): string {
  return createHash("sha256").update(JSON.stringify([title.trim(), ...chunks.map((chunk) => [chunk.blockId, chunk.embedInput])])).digest("hex").slice(0, 32);
}

// ---- 共有の上限（UsageCounter）----

async function consumeEmbeddingBudget(userId: string, kind: "embed:query" | "embed:index", limit: number): Promise<boolean> {
  const table = Prisma.raw(`"${databaseSchema}"."UsageCounter"`);
  const day = usageDay();
  const updated = await prisma.$executeRaw(Prisma.sql`
    INSERT INTO ${table} ("key", "kind", "day", "count", "updatedAt")
    VALUES (${`user:${userId}`}, ${kind}, ${day}::date, 1, NOW())
    ON CONFLICT ("key", "kind", "day")
    DO UPDATE SET "count" = ${table}."count" + 1, "updatedAt" = NOW()
    WHERE ${table}."count" < ${limit}`);
  return Number(updated) > 0;
}

// ---- 埋め込み API ----

type EmbedOptions = { timeoutMs?: number; signal?: AbortSignal; userId?: string };

function signalFor(options: EmbedOptions, defaultTimeout: number) {
  const timeout = AbortSignal.timeout(options.timeoutMs ?? defaultTimeout);
  return options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
}

async function embedBatch(config: EmbeddingConfig, texts: string[], signal: AbortSignal): Promise<Float32Array[]> {
  const response = await fetch(`${config.baseUrl}/embeddings`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: config.model, input: texts, dimensions: config.dimensions }),
    signal,
  });
  if (!response.ok) throw new Error(`Embeddings request failed with status ${response.status}.`);
  const json = (await response.json()) as { data?: { index?: number; embedding?: number[] }[] };
  const data = Array.isArray(json.data) ? [...json.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)) : [];
  if (data.length !== texts.length) throw new Error("Embeddings response did not match the request.");
  return data.map((item) => {
    const vector = Array.isArray(item.embedding) && item.embedding.length === config.dimensions ? normalizeVector(item.embedding) : null;
    if (!vector) throw new Error("Embeddings response has an unusable vector.");
    return vector;
  });
}

// texts を同じ順の L2 正規化済みベクトルにする。多いときは 64 件ずつ送る。
export async function embedTexts(texts: string[], options: EmbedOptions = {}): Promise<Float32Array[]> {
  const config = embeddingConfig();
  if (!config) throw new Error("Semantic search is not configured.");
  const signal = signalFor(options, INDEX_TIMEOUT_MS);
  const vectors: Float32Array[] = [];
  for (let start = 0; start < texts.length; start += MAX_TEXTS_PER_REQUEST) {
    vectors.push(...await embedBatch(config, texts.slice(start, start + MAX_TEXTS_PER_REQUEST), signal));
  }
  return vectors;
}

// 検索語の埋め込み。検索語はリクエストをまたいで保持せず、共有の 1 日上限を超えたときは呼ばない。
export async function embedQuery(query: string, options: EmbedOptions = {}): Promise<Float32Array | null> {
  const config = embeddingConfig();
  if (!config) throw new Error("Semantic search is not configured.");
  if (options.userId && !(await consumeEmbeddingBudget(options.userId, "embed:query", EMBED_QUERY_DAILY_LIMIT))) return null;
  const [vector] = await embedTexts([query.trim()], { ...options, timeoutMs: options.timeoutMs ?? 2500 });
  return vector;
}

// ---- 索引の更新 ----

// ノート単位の排他ロックの下で、現在の版が expectedVersion のままのときに限り索引を書き換える。
async function mutateNoteIndexIfCurrent(
  userId: string,
  noteId: string,
  expectedVersion: number,
  action: (tx: Prisma.TransactionClient) => Promise<boolean>,
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`note-emb:${noteId}`}))`);
    const latest = await tx.notePage.findFirst({ where: { id: noteId, userId, deletedAt: null }, select: { version: true } });
    if (!latest || latest.version !== expectedVersion) return false;
    return action(tx);
  });
}

// pageIds のうち、利用者本人の通常のノート（ゴミ箱を除く）の索引を、本文が変わっているものだけ作り直す。
// すべての更新（削除・版番号の付け替え・作り直し）で排他ロックと版番号の確認を行い、新しい版の索引を古い処理が壊さないようにする。
export async function syncNoteEmbeddingsForIds(userId: string, pageIds: string[], options: { signal?: AbortSignal } = {}): Promise<number> {
  const config = embeddingConfig();
  if (!config) return 0;
  const ids = [...new Set(pageIds)].filter(Boolean);
  if (!ids.length) return 0;
  const claimedKeys: string[] = [];
  try {
    const notes = await prisma.notePage.findMany({
      where: { id: { in: ids }, userId, deletedAt: null },
      select: { id: true, kind: true, title: true, blocks: true, version: true, canvas: { select: { segments: true } } },
    });
    if (!notes.length) return 0;
    const existing = await prisma.noteEmbedding.findMany({
      where: { noteId: { in: notes.map((note) => note.id) }, userId },
      select: { noteId: true, contentHash: true, model: true, dimensions: true, noteVersion: true },
    });
    const rowsByNote = new Map<string, typeof existing>();
    for (const row of existing) rowsByNote.set(row.noteId, [...(rowsByNote.get(row.noteId) ?? []), row]);

    const pending: { id: string; version: number; hash: string; chunks: NoteTextChunk[] }[] = [];
    for (const note of notes) {
      const rows = rowsByNote.get(note.id) ?? [];
      const chunks = extractNoteChunks(note.title, searchableBlocks(pageKindOf(note), note.blocks, note.canvas?.segments));
      if (!chunks.length) {
        if (rows.length) {
          await mutateNoteIndexIfCurrent(userId, note.id, note.version, async (tx) => {
            await tx.noteEmbedding.deleteMany({ where: { noteId: note.id, userId } });
            return true;
          });
        }
        continue;
      }
      const hash = computeContentHash(note.title, chunks);
      const sameContent = rows.length === chunks.length && rows.every((row) => row.contentHash === hash && row.model === config.model && row.dimensions === config.dimensions);
      if (sameContent) {
        // 本文は同じ（カバー変更など）。ロックの下でハッシュと版番号を再確認してから版番号だけ進める。
        if (rows.some((row) => row.noteVersion !== note.version)) {
          await mutateNoteIndexIfCurrent(userId, note.id, note.version, async (tx) => {
            const currentRows = await tx.noteEmbedding.findMany({
              where: { noteId: note.id, userId },
              select: { contentHash: true, model: true, dimensions: true },
            });
            if (currentRows.length !== chunks.length || !currentRows.every((row) => row.contentHash === hash && row.model === config.model && row.dimensions === config.dimensions)) {
              return false;
            }
            await tx.noteEmbedding.updateMany({ where: { noteId: note.id, userId }, data: { noteVersion: note.version, updatedAt: new Date() } });
            return true;
          });
        }
        continue;
      }
      // 同じノートの同じ版を並行処理で二重に埋め込まない。
      const key = `${note.id}:${note.version}`;
      if (inFlightNoteVersions.has(key)) continue;
      inFlightNoteVersions.add(key);
      claimedKeys.push(key);
      pending.push({ id: note.id, version: note.version, hash, chunks });
    }
    if (!pending.length) return 0;

    if (!(await consumeEmbeddingBudget(userId, "embed:index", EMBED_INDEX_DAILY_LIMIT))) return 0;

    const vectors = await embedTexts(pending.flatMap((note) => note.chunks.map((chunk) => chunk.embedInput)), { signal: options.signal });
    let offset = 0;
    let written = 0;
    for (const note of pending) {
      const noteVectors = vectors.slice(offset, offset + note.chunks.length);
      offset += note.chunks.length;
      const saved = await mutateNoteIndexIfCurrent(userId, note.id, note.version, async (tx) => {
        await tx.noteEmbedding.deleteMany({ where: { noteId: note.id, userId } });
        await tx.noteEmbedding.createMany({
          data: note.chunks.map((chunk, index) => ({
            noteId: note.id, userId, chunkIndex: chunk.chunkIndex, blockId: chunk.blockId, noteVersion: note.version,
            contentHash: note.hash, model: config.model, dimensions: config.dimensions, vector: encodeVector(noteVectors[index]),
          })),
        });
        return true;
      });
      if (saved) written++;
    }
    return written;
  } catch (error) {
    console.error("Failed to update note embeddings", error instanceof Error ? error.message : error);
    return 0;
  } finally {
    for (const key of claimedKeys) inFlightNoteVersions.delete(key);
  }
}

async function findStaleNoteIds(userId: string, config: EmbeddingConfig, limit: number): Promise<string[]> {
  const table = (name: string) => Prisma.raw(`"${databaseSchema}"."${name}"`);
  const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT p."id"
    FROM ${table("NotePage")} p
    LEFT JOIN ${table("NoteCanvas")} c ON c."noteId" = p."id"
    LEFT JOIN (
      SELECT "noteId",
        min("noteVersion") AS "minVersion", max("noteVersion") AS "maxVersion",
        count(*) FILTER (WHERE "model" = ${config.model} AND "dimensions" = ${config.dimensions}) AS "current", count(*) AS "total"
      FROM ${table("NoteEmbedding")} WHERE "userId" = ${userId} GROUP BY "noteId"
    ) e ON e."noteId" = p."id"
    WHERE p."userId" = ${userId} AND p."deletedAt" IS NULL
      AND ((btrim(p."title") <> '' AND p."title" <> 'Untitled') OR jsonb_path_exists(p."blocks", ${HAS_NON_WHITESPACE_TEXT}::jsonpath)
        OR jsonb_path_exists(COALESCE(c."segments", '[]'::jsonb), ${HAS_NON_WHITESPACE_TEXT}::jsonpath))
      AND (e."noteId" IS NULL OR e."current" <> e."total" OR e."minVersion" <> p."version" OR e."maxVersion" <> p."version")
    ORDER BY p."updatedAt" DESC, p."id" DESC
    LIMIT ${limit}`);
  return rows.map((row) => row.id);
}

// 索引が無い・版が古い通常のノートを新しい順に maxNotes 件だけ作り直す。まだ残りがあれば hasMore。
export async function backfillStaleNoteEmbeddings(userId: string, maxNotes: number, options: { signal?: AbortSignal } = {}): Promise<{ synced: number; hasMore: boolean }> {
  const config = embeddingConfig();
  if (!config || maxNotes <= 0) return { synced: 0, hasMore: false };
  const ids = await findStaleNoteIds(userId, config, maxNotes + 1);
  if (!ids.length) return { synced: 0, hasMore: false };
  const synced = await syncNoteEmbeddingsForIds(userId, ids.slice(0, maxNotes), options);
  return { synced, hasMore: ids.length > maxNotes };
}

function runAfterResponse(task: () => Promise<unknown>) {
  const guarded = async () => {
    try { await task(); } catch (error) { console.error("Note embedding task failed", error instanceof Error ? error.message : error); }
  };
  try { after(guarded); } catch { /* リクエストの外（テストなど）では、応答のあとに回せない。次の検索の遅延更新が追いつく。 */ }
}

// ノートを書いた応答のあとで、そのノートの索引を作り直す。失敗しても保存には影響しない。
export function scheduleNoteEmbeddingSync(userId: string, pageIds: string[]) {
  if (!isSemanticSearchEnabled() || !pageIds.length) return;
  runAfterResponse(() => syncNoteEmbeddingsForIds(userId, pageIds));
}

// 索引が足りない古いノートを、検索の応答のあとで少しずつ作る。
export function scheduleNoteEmbeddingBackfill(userId: string) {
  if (!isSemanticSearchEnabled()) return;
  runAfterResponse(async () => {
    for (let round = 0; round < BACKGROUND_BACKFILL_ROUNDS; round++) {
      const { synced, hasMore } = await backfillStaleNoteEmbeddings(userId, BACKGROUND_BACKFILL_NOTES);
      if (!hasMore || !synced) break;
    }
  });
}

// ---- 意味検索 ----

export type SemanticNoteHit = { id: string; kind: PageKind; title: string; icon: string | null; blockId: string | null; chunkText: string; score: number; updatedAt: Date };
// kind を渡すとその種類のページだけを探す（検索の種類の絞り込み）。
export type SemanticSearchOptions = { limit: number; minSimilarity: number; maxBackfillNotes?: number; timeoutMs?: number; signal?: AbortSignal; kind?: PageKind };

type ChunkRow = { noteId: string; chunkIndex: number; blockId: string | null; noteVersion: number; vector: Uint8Array; kind: string; title: string; icon: string | null; updatedAt: Date | string };

function withDeadline<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => { timer = setTimeout(() => resolve(fallback), ms); });
  return Promise.race([promise.finally(() => { if (timer) clearTimeout(timer); }), timeout]);
}

// kind を渡すとその種類のページの塊だけ（LIMIT の前に絞る：ほかの種類の新しい塊で枠が埋まらないように）。
async function loadIndexedChunks(userId: string, config: EmbeddingConfig, kind?: PageKind): Promise<ChunkRow[]> {
  const table = (name: string) => Prisma.raw(`"${databaseSchema}"."${name}"`);
  return prisma.$queryRaw<ChunkRow[]>(Prisma.sql`
    SELECT e."noteId", e."chunkIndex", e."blockId", e."noteVersion", e."vector", p."kind"::text AS "kind", p."title", p."icon", p."updatedAt"
    FROM ${table("NoteEmbedding")} e
    JOIN ${table("NotePage")} p ON p."id" = e."noteId"
    WHERE e."userId" = ${userId} AND p."userId" = ${userId} AND p."deletedAt" IS NULL ${kind ? Prisma.sql`AND p."kind"::text = ${kind}` : Prisma.empty}
      AND e."noteVersion" = p."version"
      AND e."model" = ${config.model} AND e."dimensions" = ${config.dimensions}
    ORDER BY p."updatedAt" DESC, e."chunkIndex" ASC
    LIMIT ${MAX_SCANNED_CHUNKS}`);
}

async function runSemanticSearch(userId: string, query: string, config: EmbeddingConfig, options: SemanticSearchOptions): Promise<{ hits: SemanticNoteHit[]; hasMoreBackfill: boolean }> {
  const timeoutMs = options.timeoutMs ?? 2500;
  const [initialRows, staleIds] = await Promise.all([
    loadIndexedChunks(userId, config, options.kind),
    findStaleNoteIds(userId, config, 1).catch(() => []),
  ]);
  let rows = initialRows;
  let hasMoreBackfill = staleIds.length > 0;

  // すでに索引があるノートは待たずにそのまま検索する。初回で索引が 0 件の AI 検索だけ少量を先に作る。
  if (!rows.length && hasMoreBackfill && options.maxBackfillNotes && options.maxBackfillNotes > 0) {
    const backfill = await backfillStaleNoteEmbeddings(userId, options.maxBackfillNotes, {
      signal: signalFor({ timeoutMs, signal: options.signal }, timeoutMs),
    }).catch(() => ({ synced: 0, hasMore: true }));
    hasMoreBackfill = backfill.hasMore;
    if (backfill.synced > 0) rows = await loadIndexedChunks(userId, config, options.kind);
  }

  // 検索できる通常のノートが 1 件も無ければ、埋め込み API を呼ばない（匿名検索での無駄な課金を防ぐ）。
  if (!rows.length) return { hits: [], hasMoreBackfill };

  const queryVector = await embedQuery(query, { userId, timeoutMs, signal: options.signal });
  if (!queryVector) return { hits: [], hasMoreBackfill };

  const best = new Map<string, { id: string; kind: PageKind; title: string; icon: string | null; chunkIndex: number; blockId: string | null; noteVersion: number; score: number; updatedAt: Date }>();
  for (const row of rows) {
    const vector = decodeVector(row.vector, config.dimensions);
    if (!vector) continue;
    const score = dotProduct(queryVector, vector);
    const current = best.get(row.noteId);
    if (!current || score > current.score) {
      best.set(row.noteId, {
        id: row.noteId, kind: pageKindOf(row), title: row.title, icon: row.icon, chunkIndex: row.chunkIndex, blockId: row.blockId,
        noteVersion: row.noteVersion, score, updatedAt: new Date(row.updatedAt),
      });
    }
  }
  const ranked = [...best.values()]
    .filter((hit) => hit.score >= options.minSimilarity)
    .sort((a, b) => b.score - a.score || b.updatedAt.getTime() - a.updatedAt.getTime() || (a.id < b.id ? 1 : -1))
    .slice(0, options.limit);
  if (!ranked.length) return { hits: [], hasMoreBackfill };

  // 抜粋は索引に複製せず、一致した上位ノートだけ現在の本文を読み、版が一致する該当チャンクから直接作る。
  const livePages = await prisma.notePage.findMany({
    where: { id: { in: ranked.map((hit) => hit.id) }, userId, deletedAt: null },
    select: { id: true, kind: true, title: true, version: true, blocks: true, canvas: { select: { segments: true } } },
  });
  const byId = new Map(livePages.map((page) => [page.id, page]));
  const hits: SemanticNoteHit[] = [];
  for (const hit of ranked) {
    const page = byId.get(hit.id);
    if (!page || page.version !== hit.noteVersion) continue;
    const blocks = searchableBlocks(pageKindOf(page), page.blocks, page.canvas?.segments);
    const chunks = extractNoteChunks(page.title, blocks);
    const matchedChunk = chunks[hit.chunkIndex];
    hits.push({
      id: hit.id,
      kind: hit.kind,
      title: hit.title,
      icon: hit.icon,
      blockId: matchedChunk?.blockId ?? hit.blockId,
      chunkText: matchedChunk?.chunkText || excerptFromBlock(blocks, hit.blockId),
      score: hit.score,
      updatedAt: hit.updatedAt,
    });
  }
  return { hits, hasMoreBackfill };
}

// query に意味が近い通常のノートを、ノートごとに一番近いチャンクで返す。使えないとき・失敗したとき・期限を超えたときは空（キーワード検索に影響しない）。
export async function semanticSearchNotes(userId: string, query: string, options: SemanticSearchOptions): Promise<{ hits: SemanticNoteHit[]; hasMoreBackfill: boolean }> {
  const config = embeddingConfig();
  const none = { hits: [], hasMoreBackfill: false };
  if (!config || query.replace(/\s+/g, "").length < MIN_QUERY_CHARS) return none;
  const deadline = options.timeoutMs ?? 2500;
  try {
    return await withDeadline(runSemanticSearch(userId, query, config, options), deadline, none);
  } catch (error) {
    console.error("Semantic note search failed", error instanceof Error ? error.message : error);
    return none;
  }
}
