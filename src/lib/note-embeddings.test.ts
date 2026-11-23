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
  computeContentHash,
  decodeVector,
  DEFAULT_EMBEDDING_MODEL,
  dotProduct,
  EMBEDDING_DIMENSIONS,
  embeddingConfig,
  embedQuery,
  embedTexts,
  encodeVector,
  HAS_NON_WHITESPACE_TEXT,
  isSemanticSearchEnabled,
  normalizeVector,
  resetEmbeddingStateForTest,
  semanticSearchNotes,
  syncNoteEmbeddingsForIds,
} from "./note-embeddings";
import { extractNoteChunks, MAX_CHUNK_CHARS } from "./note-text";

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
    resetEmbeddingStateForTest();
    mocks.executeRaw.mockResolvedValue(1);
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        $executeRaw: mocks.executeRaw,
        notePage: { findFirst: mocks.notePageFindFirst },
        noteEmbedding: {
          findMany: mocks.noteEmbeddingFindMany,
          deleteMany: mocks.noteEmbeddingDeleteMany,
          updateMany: mocks.noteEmbeddingUpdateMany,
          createMany: mocks.noteEmbeddingCreateMany,
        },
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

  it("uses double-escaped \\\\S in PostgreSQL JSONPath regex for non-whitespace text", () => {
    expect(HAS_NON_WHITESPACE_TEXT).toContain('like_regex "\\\\S"');
  });

  it("computes deterministic content hashes that change with title or body", () => {
    const c1 = extractNoteChunks("Title", [{ id: "b1", type: "paragraph", content: [{ type: "text", text: "hello" }] }]);
    const c2 = extractNoteChunks("Title", [{ id: "b1", type: "paragraph", content: [{ type: "text", text: "hello" }] }]);
    const c3 = extractNoteChunks("Title", [{ id: "b1", type: "paragraph", content: [{ type: "text", text: "world" }] }]);
    expect(computeContentHash("Title", c1)).toBe(computeContentHash("Title", c2));
    expect(computeContentHash("Title", c1)).not.toBe(computeContentHash("Title", c3));
  });

  it("gates semantic search on OPENAI_API_KEY, kill switch, and validates model overrides", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(isSemanticSearchEnabled()).toBe(false);
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    expect(isSemanticSearchEnabled()).toBe(true);
    vi.stubEnv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-large");
    expect(embeddingConfig()?.model).toBe("text-embedding-3-large");
    vi.stubEnv("OPENAI_EMBEDDING_MODEL", "text-embedding-ada-002");
    expect(embeddingConfig()?.model).toBe(DEFAULT_EMBEDDING_MODEL);
    vi.stubEnv("NOTEFABLE_SEMANTIC_SEARCH", "false");
    expect(isSemanticSearchEnabled()).toBe(false);
    vi.stubEnv("NOTEFABLE_SEMANTIC_SEARCH", "0");
    expect(isSemanticSearchEnabled()).toBe(false);
  });

  it("calls OpenAI /embeddings without retaining raw queries and enforces shared daily budget", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("OPENAI_BASE_URL", "https://example.openai.test/v1/");
    const fetchMock = vi.fn().mockResolvedValue(mockEmbeddingsResponse([makeUnitVector(0)]));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const vec = await embedQuery("装修坑", { userId: "u1" });
    expect(vec).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body).toEqual({ model: "text-embedding-3-small", input: ["装修坑"], dimensions: EMBEDDING_DIMENSIONS });

    // Shared UsageCounter budget exhausted (0 rows updated) -> skips OpenAI call.
    mocks.executeRaw.mockResolvedValueOnce(0);
    expect(await embedQuery("装修坑", { userId: "u1" })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects failed or malformed embedding responses", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    globalThis.fetch = vi.fn().mockResolvedValue(new Response("err", { status: 500 })) as unknown as typeof fetch;
    await expect(embedTexts(["hello"])).rejects.toThrow("status 500");
  });

  it("locks and version-checks every mutation (blank delete, sameContent version update, rebuild)", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    const blocks = [{ id: "b1", type: "paragraph", content: [{ type: "text", text: "水电改造拍照留底" }] }];
    const chunks = extractNoteChunks("新房验收", blocks);
    const sameHash = computeContentHash("新房验收", chunks);

    mocks.notePageFindMany.mockResolvedValue([
      { id: "same", title: "新房验收", blocks, version: 4 },
      { id: "blank", title: "Untitled", blocks: [], version: 1 },
      { id: "changed", title: "新房验收踩雷记录", blocks, version: 3 },
      { id: "raced", title: "竞态笔记", blocks, version: 5 },
    ]);
    mocks.noteEmbeddingFindMany
      .mockResolvedValueOnce([
        { noteId: "same", contentHash: sameHash, model: "text-embedding-3-small", dimensions: EMBEDDING_DIMENSIONS, noteVersion: 2 },
        { noteId: "blank", contentHash: "old", model: "text-embedding-3-small", dimensions: EMBEDDING_DIMENSIONS, noteVersion: 1 },
      ])
      // Inside locked sameContent tx re-check:
      .mockResolvedValueOnce([
        { contentHash: sameHash, model: "text-embedding-3-small", dimensions: EMBEDDING_DIMENSIONS },
      ]);
    const fetchMock = vi.fn().mockResolvedValue(mockEmbeddingsResponse([makeUnitVector(0), makeUnitVector(1)]));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    // Order of mutateNoteIndexIfCurrent calls: same (v4), blank (v1), changed (v3), raced (moved to v6).
    mocks.notePageFindFirst
      .mockResolvedValueOnce({ version: 4 })
      .mockResolvedValueOnce({ version: 1 })
      .mockResolvedValueOnce({ version: 3 })
      .mockResolvedValueOnce({ version: 6 });

    const synced = await syncNoteEmbeddingsForIds("u1", ["same", "blank", "changed", "raced"]);
    expect(synced).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.transaction).toHaveBeenCalledTimes(4);
    expect(mocks.noteEmbeddingUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { noteId: "same", userId: "u1" },
      data: expect.objectContaining({ noteVersion: 4 }),
    }));
    expect(mocks.noteEmbeddingDeleteMany).toHaveBeenCalledWith({ where: { noteId: "blank", userId: "u1" } });
    expect(mocks.noteEmbeddingCreateMany).toHaveBeenCalledTimes(1);
    expect(mocks.noteEmbeddingCreateMany.mock.calls[0][0].data[0]).toMatchObject({ noteId: "changed", userId: "u1", blockId: "b1", noteVersion: 3 });
  });

  it("indexes a whiteboard or slide deck from its extracted text (never its drawing data), keyed by element or slide", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    mocks.notePageFindMany.mockResolvedValue([
      { id: "w1", kind: "whiteboard", title: "Plan", blocks: [], version: 2, canvas: { segments: [{ id: "e1", text: "Launch checklist" }] } },
      { id: "s1", kind: "slides", title: "Deck", blocks: [], version: 1, canvas: null },
    ]);
    mocks.noteEmbeddingFindMany.mockResolvedValueOnce([]);
    mocks.notePageFindFirst.mockResolvedValue({ version: 2 });
    globalThis.fetch = vi.fn().mockResolvedValue(mockEmbeddingsResponse([makeUnitVector(0), makeUnitVector(1)])) as unknown as typeof fetch;
    await syncNoteEmbeddingsForIds("u1", ["w1", "s1"]);
    expect(mocks.notePageFindMany.mock.calls[0][0].select).toEqual({ id: true, kind: true, title: true, blocks: true, version: true, canvas: { select: { segments: true } } });
    const sent = JSON.parse((globalThis.fetch as unknown as { mock: { calls: [string, { body: string }][] } }).mock.calls[0][1].body).input;
    expect(sent).toEqual(["Plan\n\nLaunch checklist", "Deck"]);
    expect(mocks.noteEmbeddingCreateMany.mock.calls[0][0].data[0]).toMatchObject({ noteId: "w1", blockId: "e1", noteVersion: 2 });
  });

  it("finds stale whiteboards and slide decks through their extracted text", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    mocks.queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
    await semanticSearchNotes("u1", "checklist", { limit: 10, minSimilarity: 0.34, maxBackfillNotes: 0 });
    const staleSql = (mocks.queryRaw.mock.calls[1][0] as { sql: string }).sql.replace(/\s+/g, " ");
    expect(staleSql).toContain('LEFT JOIN "notefable"."NoteCanvas" c ON c."noteId" = p."id"');
    expect(staleSql).toContain(`jsonb_path_exists(COALESCE(c."segments", '[]'::jsonb), ?::jsonpath)`);
    expect(staleSql).not.toContain('c."data"');
  });

  it("skips calling OpenAI when the user has no live indexed notes", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    mocks.queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await semanticSearchNotes("anon", "装修坑", { limit: 10, minSimilarity: 0.34, maxBackfillNotes: 0 });
    expect(result).toEqual({ hits: [], hasMoreBackfill: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("searches only the asked page kind and skips OpenAI when none of that kind is indexed", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    mocks.queryRaw
      .mockResolvedValueOnce([{ noteId: "n1", chunkIndex: 0, blockId: null, noteVersion: 1, vector: new Uint8Array(4), kind: "note", title: "Note", icon: null, updatedAt: new Date() }])
      .mockResolvedValueOnce([]);
    const result = await semanticSearchNotes("u1", "装修坑", { limit: 10, minSimilarity: 0.34, maxBackfillNotes: 0, kind: "whiteboard" });
    expect(result).toEqual({ hits: [], hasMoreBackfill: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the kind of each hit and points a slide deck hit at the matching slide", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    const updatedAt = new Date("2026-11-01T00:00:00Z");
    globalThis.fetch = vi.fn().mockResolvedValue(mockEmbeddingsResponse([makeUnitVector(0)])) as unknown as typeof fetch;
    mocks.queryRaw
      .mockResolvedValueOnce([{ noteId: "s1", chunkIndex: 0, blockId: "slide-2", noteVersion: 1, vector: encodeVector(normalizeVector(makeUnitVector(0))!), kind: "slides", title: "Deck", icon: null, updatedAt }])
      .mockResolvedValueOnce([]);
    mocks.notePageFindMany.mockResolvedValue([{ id: "s1", kind: "slides", title: "Deck", version: 1, blocks: [], canvas: { segments: [{ id: "slide-2", text: "Quarterly goals" }] } }]);
    const { hits } = await semanticSearchNotes("u1", "goals", { limit: 10, minSimilarity: 0.34, maxBackfillNotes: 0 });
    expect(hits[0]).toMatchObject({ id: "s1", kind: "slides", blockId: "slide-2", chunkText: "Quarterly goals" });
  });

  it("builds excerpts from the exact matching chunkIndex even when multiple chunks share one blockId", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    const updatedAt = new Date("2026-11-01T00:00:00Z");
    globalThis.fetch = vi.fn().mockResolvedValue(mockEmbeddingsResponse([makeUnitVector(0)])) as unknown as typeof fetch;

    const matchVec = encodeVector(normalizeVector(makeUnitVector(0))!);
    const weakVec = encodeVector(normalizeVector(makeUnitVector(1))!);
    const longBlockText = `${"开头的无关内容".repeat(Math.ceil(MAX_CHUNK_CHARS / 7))}第二段的关键水电验收细节`;

    mocks.queryRaw
      .mockResolvedValueOnce([
        { noteId: "n1", chunkIndex: 0, blockId: "b1", noteVersion: 2, vector: weakVec, title: "长笔记", icon: "🏠", updatedAt },
        { noteId: "n1", chunkIndex: 1, blockId: "b1", noteVersion: 2, vector: matchVec, title: "长笔记", icon: "🏠", updatedAt },
      ])
      .mockResolvedValueOnce([]);
    mocks.notePageFindMany.mockResolvedValue([
      { id: "n1", title: "长笔记", version: 2, blocks: [{ id: "b1", type: "paragraph", content: [{ type: "text", text: longBlockText }] }] },
    ]);

    const { hits } = await semanticSearchNotes("u1", "水电验收", { limit: 10, minSimilarity: 0.34, maxBackfillNotes: 0 });
    expect(hits).toHaveLength(1);
    expect(hits[0].chunkText).toContain("第二段的关键水电验收细节");
    expect(hits[0].chunkText.startsWith("开头的无关内容开头的无关内容")).toBe(false);
  });

  it("degrades cleanly on API failure and skips 1-character queries", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    const updatedAt = new Date("2026-11-01T00:00:00Z");
    const matchVec = encodeVector(normalizeVector(makeUnitVector(0))!);

    expect(await semanticSearchNotes("u1", "a", { limit: 10, minSimilarity: 0.34 })).toEqual({ hits: [], hasMoreBackfill: false });

    mocks.queryRaw
      .mockResolvedValueOnce([{ noteId: "n1", chunkIndex: 0, blockId: "b1", noteVersion: 1, vector: matchVec, title: "新房验收", icon: null, updatedAt }])
      .mockResolvedValueOnce([]);
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;
    expect(await semanticSearchNotes("u1", "装修坑", { limit: 10, minSimilarity: 0.34, maxBackfillNotes: 0 })).toEqual({ hits: [], hasMoreBackfill: false });
  });
});
