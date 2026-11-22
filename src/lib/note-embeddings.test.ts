import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  executeRaw: vi.fn(),
  notePageFindMany: vi.fn(),
  notePageFindFirst: vi.fn(),
  noteEmbeddingFindMany: vi.fn(),
  noteEmbeddingDeleteMany: vi.fn(),
  noteEmbeddingUpdateMany: vi.fn(),
  noteEmbeddingCreateMany: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  databaseSchema: "notefable",
  prisma: {
    $queryRaw: mocks.queryRaw,
    $executeRaw: mocks.executeRaw,
    $transaction: mocks.transaction,
    notePage: { findMany: mocks.notePageFindMany, findFirst: mocks.notePageFindFirst },
    noteEmbedding: {
      findMany: mocks.noteEmbeddingFindMany,
      deleteMany: mocks.noteEmbeddingDeleteMany,
      updateMany: mocks.noteEmbeddingUpdateMany,
      createMany: mocks.noteEmbeddingCreateMany,
    },
  },
}));

import {
  clearQueryEmbeddingCacheForTest,
  computeContentHash,
  decodeVector,
  dotProduct,
  EMBEDDING_DIMENSIONS,
  embedQuery,
  embedTexts,
  encodeVector,
  isSemanticSearchEnabled,
  normalizeVector,
  semanticSearchNotes,
  syncNoteEmbeddingsForIds,
} from "./note-embeddings";
import { extractNoteChunks } from "./note-text";

function makeUnitVector(axis: number, dims = EMBEDDING_DIMENSIONS): number[] {
  const arr = new Array<number>(dims).fill(0);
  arr[axis] = 1;
  return arr;
}

function mockEmbeddingsResponse(vectors: number[][]) {
  return new Response(JSON.stringify({ data: vectors.map((embedding, index) => ({ index, embedding })) }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("note-embeddings", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    clearQueryEmbeddingCacheForTest();
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        $executeRaw: mocks.executeRaw,
        notePage: { findFirst: mocks.notePageFindFirst },
        noteEmbedding: { deleteMany: mocks.noteEmbeddingDeleteMany, createMany: mocks.noteEmbeddingCreateMany },
      }));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  it("normalizes, encodes, decodes and computes dot products accurately", () => {
    const normalized = normalizeVector([3, 4]);
    expect(normalized).not.toBeNull();
    expect(normalized![0]).toBeCloseTo(0.6, 5);
    expect(normalized![1]).toBeCloseTo(0.8, 5);
    expect(normalizeVector([0, 0])).toBeNull();
    expect(normalizeVector([Number.NaN, 1])).toBeNull();

    const encoded = encodeVector(normalized!);
    expect(encoded.byteLength).toBe(8);
    const decoded = decodeVector(encoded, 2);
    expect(decoded).not.toBeNull();
    expect(dotProduct(normalized!, decoded!)).toBeCloseTo(1, 5);
    expect(decodeVector(encoded, 3)).toBeNull();
  });

  it("computes deterministic content hashes that change with title or body", () => {
    const c1 = extractNoteChunks("Title", [{ id: "b1", type: "paragraph", content: [{ type: "text", text: "hello" }] }]);
    const c2 = extractNoteChunks("Title", [{ id: "b1", type: "paragraph", content: [{ type: "text", text: "hello" }] }]);
    const c3 = extractNoteChunks("Title", [{ id: "b1", type: "paragraph", content: [{ type: "text", text: "world" }] }]);
    expect(computeContentHash("Title", c1)).toBe(computeContentHash("Title", c2));
    expect(computeContentHash("Title", c1)).not.toBe(computeContentHash("Title", c3));
  });

  it("gates semantic search on OPENAI_API_KEY and NOTEFABLE_SEMANTIC_SEARCH kill switch", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(isSemanticSearchEnabled()).toBe(false);
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    expect(isSemanticSearchEnabled()).toBe(true);
    vi.stubEnv("NOTEFABLE_SEMANTIC_SEARCH", "false");
    expect(isSemanticSearchEnabled()).toBe(false);
    vi.stubEnv("NOTEFABLE_SEMANTIC_SEARCH", "0");
    expect(isSemanticSearchEnabled()).toBe(false);
  });

  it("calls OpenAI /embeddings with dimensions and caches query embeddings", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("OPENAI_BASE_URL", "https://example.openai.test/v1/");
    const fetchMock = vi.fn().mockResolvedValue(mockEmbeddingsResponse([makeUnitVector(0)]));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const first = await embedQuery("装修坑");
    const second = await embedQuery("  装修坑 ");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://example.openai.test/v1/embeddings");
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body).toEqual({ model: "text-embedding-3-small", input: ["装修坑"], dimensions: EMBEDDING_DIMENSIONS });
    expect(dotProduct(first, second)).toBeCloseTo(1, 5);
  });

  it("rejects failed or malformed embedding responses", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    globalThis.fetch = vi.fn().mockResolvedValue(new Response("err", { status: 500 })) as unknown as typeof fetch;
    await expect(embedTexts(["hello"])).rejects.toThrow("status 500");
  });

  it("skips unchanged notes via contentHash, deletes embeddings for blank notes, and guards version races", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    const blocks = [{ id: "b1", type: "paragraph", content: [{ type: "text", text: "水电改造拍照留底" }] }];
    const chunks = extractNoteChunks("新房验收", blocks);
    const sameHash = computeContentHash("新房验收", chunks);

    mocks.notePageFindMany.mockResolvedValue([
      { id: "same", title: "新房验收", blocks, version: 2 },
      { id: "blank", title: "Untitled", blocks: [], version: 1 },
      { id: "changed", title: "新房验收踩雷记录", blocks, version: 3 },
      { id: "raced", title: "竞态笔记", blocks, version: 5 },
    ]);
    mocks.noteEmbeddingFindMany.mockResolvedValue([
      { noteId: "same", contentHash: sameHash, model: "text-embedding-3-small", dimensions: EMBEDDING_DIMENSIONS },
      { noteId: "blank", contentHash: "old", model: "text-embedding-3-small", dimensions: EMBEDDING_DIMENSIONS },
    ]);
    const fetchMock = vi.fn().mockResolvedValue(mockEmbeddingsResponse([makeUnitVector(0), makeUnitVector(1)]));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    // changed matches version 3; raced moved to version 6 while embedding was in flight.
    mocks.notePageFindFirst
      .mockResolvedValueOnce({ version: 3 })
      .mockResolvedValueOnce({ version: 6 });

    const synced = await syncNoteEmbeddingsForIds("u1", ["same", "blank", "changed", "raced"]);
    expect(synced).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.noteEmbeddingUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { noteId: "same", userId: "u1" } }));
    expect(mocks.noteEmbeddingDeleteMany).toHaveBeenCalledWith({ where: { noteId: "blank", userId: "u1" } });
    expect(mocks.executeRaw).toHaveBeenCalledTimes(2);
    expect(mocks.noteEmbeddingCreateMany).toHaveBeenCalledTimes(1);
    expect(mocks.noteEmbeddingCreateMany.mock.calls[0][0].data[0]).toMatchObject({ noteId: "changed", userId: "u1", blockId: "b1" });
  });

  it("scores live chunks, picks best chunk per note, filters below threshold, and degrades cleanly on API failure", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    const updatedAt = new Date("2026-11-01T00:00:00Z");
    const fetchMock = vi.fn().mockResolvedValue(mockEmbeddingsResponse([makeUnitVector(0)]));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const matchVec = encodeVector(normalizeVector(makeUnitVector(0))!);
    const weakVec = encodeVector(normalizeVector(makeUnitVector(1))!);
    const mid = makeUnitVector(0);
    mid[1] = 1;
    const midVec = encodeVector(normalizeVector(mid)!); // score ~0.707

    mocks.queryRaw.mockResolvedValue([
      { noteId: "n1", blockId: "b1", chunkText: "weak chunk", vector: weakVec, title: "新房验收踩雷记录", icon: "🏠", updatedAt },
      { noteId: "n1", blockId: "b2", chunkText: "水电改造拍照留底", vector: matchVec, title: "新房验收踩雷记录", icon: "🏠", updatedAt },
      { noteId: "n2", blockId: "b3", chunkText: "相关但稍弱", vector: midVec, title: "装修预算", icon: null, updatedAt },
      { noteId: "n3", blockId: "b4", chunkText: "完全无关", vector: weakVec, title: "菜谱", icon: null, updatedAt },
    ]);

    const { hits } = await semanticSearchNotes("u1", "装修坑", { limit: 10, minSimilarity: 0.34 });
    expect(hits.map((h) => ({ id: h.id, blockId: h.blockId }))).toEqual([
      { id: "n1", blockId: "b2" },
      { id: "n2", blockId: "b3" },
    ]);
    // 1-char query skips semantic search completely.
    expect(await semanticSearchNotes("u1", "a", { limit: 10, minSimilarity: 0.34 })).toEqual({ hits: [], hasMoreBackfill: false });

    // API failure degrades gracefully to empty hits without throwing.
    clearQueryEmbeddingCacheForTest();
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;
    expect(await semanticSearchNotes("u1", "装修坑", { limit: 10, minSimilarity: 0.34 })).toEqual({ hits: [], hasMoreBackfill: false });
  });
});
