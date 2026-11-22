import { createHash } from "node:crypto";
import { after } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { optionalEnv } from "@/lib/env";
import { extractNoteChunks, type NoteTextChunk } from "@/lib/note-text";
import { databaseSchema, prisma } from "@/lib/prisma";

// ノートの意味検索（セマンティック検索）。ノート本文をチャンクに分け、埋め込み（意味を表すベクトル）にして NoteEmbedding に持つ。
// 検索語も埋め込みにして、内積（ベクトルは L2 正規化済みなので = コサイン類似度）が高いチャンクのノートを返す。
// どの検索も利用者本人の分だけを対象にするので、pgvector は使わず、BYTEA の Float32 を JS で比べる（1 利用者ぶんは数千チャンクまで）。
// OPENAI_API_KEY が無い、または NOTEFABLE_SEMANTIC_SEARCH が 0 / false のときは何もしない（キーワード検索だけが働く）。

export const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 512;
export const UI_SEMANTIC_THRESHOLD = 0.34;
export const AI_SEMANTIC_THRESHOLD = 0.32;

const MAX_TEXTS_PER_REQUEST = 64;
const INDEX_TIMEOUT_MS = 10_000;
const MAX_SCANNED_CHUNKS = 2000;
const QUERY_CACHE_MAX = 64;
const QUERY_CACHE_TTL_MS = 60_000;
const MIN_QUERY_CHARS = 2;
const BACKGROUND_BACKFILL_NOTES = 20;
const BACKGROUND_BACKFILL_ROUNDS = 5;

export type EmbeddingConfig = { apiKey: string; baseUrl: string; model: string; dimensions: number };

export function embeddingConfig(): EmbeddingConfig | null {
  const switchValue = optionalEnv("NOTEFABLE_SEMANTIC_SEARCH")?.toLowerCase();
  if (switchValue === "0" || switchValue === "false") return null;
  const apiKey = optionalEnv("OPENAI_API_KEY");
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: (optionalEnv("OPENAI_BASE_URL") || "https://api.openai.com/v1").replace(/\/$/, ""),
    model: optionalEnv("OPENAI_EMBEDDING_MODEL") || DEFAULT_EMBEDDING_MODEL,
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

// ---- 埋め込み API ----

type EmbedOptions = { timeoutMs?: number; signal?: AbortSignal };

function signalFor(options: EmbedOptions, defaultTimeout: number) {
  const timeout = AbortSignal.timeout(options.timeoutMs ?? defaultTimeout);
  return options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
}

async function embedBatch(config: EmbeddingConfig, texts: string[], signal: AbortSignal): Promise<Float32Array[]> {
  const response = await fetch(`${config.baseUrl}/embeddings`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: config.model, input: texts, ...(config.model.startsWith("text-embedding-3") ? { dimensions: config.dimensions } : {}) }),
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

const queryCache = new Map<string, { at: number; vector: Float32Array }>();
export const clearQueryEmbeddingCacheForTest = () => queryCache.clear();

// 検索語の埋め込み。同じ語を続けて検索したとき（入力中の再送や AI の再検索）に API を呼び直さない。
export async function embedQuery(query: string, options: EmbedOptions = {}): Promise<Float32Array> {
  const config = embeddingConfig();
  if (!config) throw new Error("Semantic search is not configured.");
  const key = `${config.model}:${config.dimensions}:${query.trim().toLowerCase()}`;
  const cached = queryCache.get(key);
  if (cached && Date.now() - cached.at < QUERY_CACHE_TTL_MS) {
    queryCache.delete(key);
    queryCache.set(key, cached);
    return cached.vector;
  }
  const [vector] = await embedTexts([query.trim()], { ...options, timeoutMs: options.timeoutMs ?? 3000 });
  queryCache.set(key, { at: Date.now(), vector });
  while (queryCache.size > QUERY_CACHE_MAX) queryCache.delete(queryCache.keys().next().value as string);
  return vector;
}

// ---- 索引の更新 ----

// pageIds のうち、利用者本人の通常のノート（ゴミ箱を除く）の索引を、本文が変わっているものだけ作り直す。
// 本文の版が書き込み前に変わっていたら捨てる（古い本文の索引を新しい本文に付けない）。例外は呼び出し側へ出さない。
export async function syncNoteEmbeddingsForIds(userId: string, pageIds: string[], options: { signal?: AbortSignal } = {}): Promise<number> {
  const config = embeddingConfig();
  if (!config) return 0;
  const ids = [...new Set(pageIds)].filter(Boolean);
  if (!ids.length) return 0;
  try {
    const notes = await prisma.notePage.findMany({ where: { id: { in: ids }, userId, deletedAt: null }, select: { id: true, title: true, blocks: true, version: true } });
    if (!notes.length) return 0;
    const existing = await prisma.noteEmbedding.findMany({ where: { noteId: { in: notes.map((note) => note.id) }, userId }, select: { noteId: true, contentHash: true, model: true, dimensions: true } });
    const rowsByNote = new Map<string, typeof existing>();
    for (const row of existing) rowsByNote.set(row.noteId, [...(rowsByNote.get(row.noteId) ?? []), row]);

    const pending: { id: string; version: number; hash: string; chunks: NoteTextChunk[] }[] = [];
    for (const note of notes) {
      const rows = rowsByNote.get(note.id) ?? [];
      const chunks = extractNoteChunks(note.title, note.blocks);
      if (!chunks.length) {
        if (rows.length) await prisma.noteEmbedding.deleteMany({ where: { noteId: note.id, userId } });
        continue;
      }
      const hash = computeContentHash(note.title, chunks);
      const upToDate = rows.length === chunks.length && rows.every((row) => row.contentHash === hash && row.model === config.model && row.dimensions === config.dimensions);
      if (upToDate) {
        // 本文は同じ（アイコンの変更など）。ノートの更新日時に追いつかせ、遅延更新の対象から外す。
        await prisma.noteEmbedding.updateMany({ where: { noteId: note.id, userId }, data: { updatedAt: new Date() } });
        continue;
      }
      pending.push({ id: note.id, version: note.version, hash, chunks });
    }
    if (!pending.length) return 0;

    const vectors = await embedTexts(pending.flatMap((note) => note.chunks.map((chunk) => chunk.embedInput)), { signal: options.signal });
    let offset = 0;
    let written = 0;
    for (const note of pending) {
      const noteVectors = vectors.slice(offset, offset + note.chunks.length);
      offset += note.chunks.length;
      const saved = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`note-emb:${note.id}`}))`);
        const latest = await tx.notePage.findFirst({ where: { id: note.id, userId, deletedAt: null }, select: { version: true } });
        if (!latest || latest.version !== note.version) return false;
        await tx.noteEmbedding.deleteMany({ where: { noteId: note.id, userId } });
        await tx.noteEmbedding.createMany({
          data: note.chunks.map((chunk, index) => ({
            noteId: note.id, userId, chunkIndex: chunk.chunkIndex, blockId: chunk.blockId, chunkText: chunk.chunkText,
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
  }
}

// 索引が無い・ノートの更新より古い通常のノートを新しい順に maxNotes 件だけ作り直す。まだ残りがあれば hasMore。
export async function backfillStaleNoteEmbeddings(userId: string, maxNotes: number, options: { signal?: AbortSignal } = {}): Promise<{ synced: number; hasMore: boolean }> {
  const config = embeddingConfig();
  if (!config || maxNotes <= 0) return { synced: 0, hasMore: false };
  const table = (name: string) => Prisma.raw(`"${databaseSchema}"."${name}"`);
  // 本文の文字もタイトルも無いノート（空のノート、画像だけのノート）は索引が作れないので数えない。
  const hasText = 'strict $.** ? (@.type() == "object" && exists(@.text) && @.text != "")';
  const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT p."id"
    FROM ${table("NotePage")} p
    LEFT JOIN (
      SELECT "noteId", max("updatedAt") AS "at",
        count(*) FILTER (WHERE "model" = ${config.model} AND "dimensions" = ${config.dimensions}) AS "current", count(*) AS "total"
      FROM ${table("NoteEmbedding")} WHERE "userId" = ${userId} GROUP BY "noteId"
    ) e ON e."noteId" = p."id"
    WHERE p."userId" = ${userId} AND p."deletedAt" IS NULL
      AND ((btrim(p."title") <> '' AND p."title" <> 'Untitled') OR jsonb_path_exists(p."blocks", ${hasText}::jsonpath))
      AND (e."noteId" IS NULL OR e."current" <> e."total" OR p."updatedAt" > e."at")
    ORDER BY p."updatedAt" DESC, p."id" DESC
    LIMIT ${maxNotes + 1}`);
  const synced = await syncNoteEmbeddingsForIds(userId, rows.slice(0, maxNotes).map((row) => row.id), options);
  return { synced, hasMore: rows.length > maxNotes };
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

export type SemanticNoteHit = { id: string; title: string; icon: string | null; blockId: string | null; chunkText: string; score: number; updatedAt: Date };
export type SemanticSearchOptions = { limit: number; minSimilarity: number; maxBackfillNotes?: number; timeoutMs?: number; signal?: AbortSignal };

type ChunkRow = { noteId: string; blockId: string | null; chunkText: string; vector: Uint8Array; title: string; icon: string | null; updatedAt: Date | string };

// query に意味が近い通常のノートを、ノートごとに一番近いチャンクで返す。使えないとき・失敗したときは空（キーワード検索に影響しない）。
export async function semanticSearchNotes(userId: string, query: string, options: SemanticSearchOptions): Promise<{ hits: SemanticNoteHit[]; hasMoreBackfill: boolean }> {
  const config = embeddingConfig();
  const none = { hits: [], hasMoreBackfill: false };
  if (!config || query.replace(/\s+/g, "").length < MIN_QUERY_CHARS) return none;
  const timeout = { timeoutMs: options.timeoutMs, signal: options.signal };
  let queryVector: Float32Array;
  let hasMoreBackfill = false;
  try {
    const [vector, backfill] = await Promise.all([
      embedQuery(query, timeout),
      options.maxBackfillNotes && options.maxBackfillNotes > 0
        ? backfillStaleNoteEmbeddings(userId, options.maxBackfillNotes, { signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs ?? 3000)]) : AbortSignal.timeout(options.timeoutMs ?? 3000) }).catch(() => ({ synced: 0, hasMore: false }))
        : { synced: 0, hasMore: false },
    ]);
    queryVector = vector;
    hasMoreBackfill = backfill.hasMore;
  } catch (error) {
    console.error("Semantic note search failed", error instanceof Error ? error.message : error);
    return none;
  }
  try {
    const table = (name: string) => Prisma.raw(`"${databaseSchema}"."${name}"`);
    const rows = await prisma.$queryRaw<ChunkRow[]>(Prisma.sql`
      SELECT e."noteId", e."blockId", e."chunkText", e."vector", p."title", p."icon", p."updatedAt"
      FROM ${table("NoteEmbedding")} e
      JOIN ${table("NotePage")} p ON p."id" = e."noteId"
      WHERE e."userId" = ${userId} AND p."userId" = ${userId} AND p."deletedAt" IS NULL
        AND e."model" = ${config.model} AND e."dimensions" = ${config.dimensions}
      ORDER BY p."updatedAt" DESC, e."chunkIndex" ASC
      LIMIT ${MAX_SCANNED_CHUNKS}`);
    const best = new Map<string, SemanticNoteHit>();
    for (const row of rows) {
      const vector = decodeVector(row.vector, config.dimensions);
      if (!vector) continue;
      const score = dotProduct(queryVector, vector);
      const current = best.get(row.noteId);
      if (!current || score > current.score) {
        best.set(row.noteId, { id: row.noteId, title: row.title, icon: row.icon, blockId: row.blockId, chunkText: row.chunkText, score, updatedAt: new Date(row.updatedAt) });
      }
    }
    const hits = [...best.values()]
      .filter((hit) => hit.score >= options.minSimilarity)
      .sort((a, b) => b.score - a.score || b.updatedAt.getTime() - a.updatedAt.getTime() || (a.id < b.id ? 1 : -1))
      .slice(0, options.limit);
    return { hits, hasMoreBackfill };
  } catch (error) {
    console.error("Semantic note search failed", error instanceof Error ? error.message : error);
    return none;
  }
}
