import { beforeEach, describe, expect, it, vi } from "vitest";

// ホワイトボード・スライド（ノート以外のページ）の作成・読み込み・保存・復元・ノート専用操作の拒否を、ルートの単位で確かめる。
const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn(),
  canvasFindFirst: vi.fn(), canvasFindUnique: vi.fn(), canvasUpsert: vi.fn(),
  revisionCreate: vi.fn(), revisionFindFirst: vi.fn(), revisionFindMany: vi.fn(), revisionDeleteMany: vi.fn(),
  raw: vi.fn(), unsafe: vi.fn(), resolveParent: vi.fn(), schedule: vi.fn(), claim: vi.fn(), claimFiles: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getOrCreateUser: async () => ({ id: "mine" }) }));
vi.mock("@/lib/note-embeddings", () => ({ scheduleNoteEmbeddingSync: mocks.schedule }));
vi.mock("@/lib/note-covers", async (original) => ({ ...(await original<typeof import("@/lib/note-covers")>()), claimCover: mocks.claim }));
vi.mock("@/lib/note-tree-server", async (original) => ({
  ...(await original<typeof import("@/lib/note-tree-server")>()), lockNoteOrder: async () => {}, resolveParent: mocks.resolveParent,
}));
vi.mock("@/lib/prisma", () => {
  const notePage = { findFirst: mocks.findFirst, create: mocks.create, updateMany: mocks.updateMany };
  const noteCanvas = { findFirst: mocks.canvasFindFirst, findUnique: mocks.canvasFindUnique, upsert: mocks.canvasUpsert };
  const noteRevision = { create: mocks.revisionCreate, findFirst: mocks.revisionFindFirst, findMany: mocks.revisionFindMany, deleteMany: mocks.revisionDeleteMany };
  const tx = { notePage, noteCanvas, noteRevision, storedFile: { updateMany: mocks.claimFiles }, $executeRaw: mocks.raw, $executeRawUnsafe: mocks.unsafe };
  return { databaseSchema: "notefable", prisma: { ...tx, $transaction: async (fn: (client: unknown) => unknown) => fn(tx) } };
});
import { POST as create } from "./route";
import { GET as read, PATCH as save } from "./[pageId]/route";
import { POST as restore } from "./[pageId]/revisions/[revisionId]/restore/route";
import { PUT as share } from "./[pageId]/share/route";
import { PUT as changeIcon } from "./[pageId]/icon/route";

const context = { params: Promise.resolve({ pageId: "w1" }) };
const json = (body: unknown, headers: Record<string, string> = {}) => new Request("http://localhost/api/pages", { method: "POST", body: JSON.stringify(body), headers });
const patch = (body: unknown, headers: Record<string, string> = {}) => new Request("http://localhost/api/pages/w1", { method: "PATCH", body: JSON.stringify(body), headers });
const board = (text = "Hello") => ({ elements: [{ id: "t1", type: "text", text }, { id: "s1", type: "freedraw", points: [[0, 0], [5, 5]] }] });
const row = (extra: Record<string, unknown> = {}) => ({
  id: "w1", userId: "mine", kind: "whiteboard", title: "Board", icon: null, cover: null, coverPosition: null, blocks: [], version: 3, groupId: null, parentId: null, ...extra,
});
const fileUrl = (owner: string) => `/api/pages/files?key=note-files/${owner}/123e4567-e89b-12d3-a456-426614174000.png&name=a.png`;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.raw.mockResolvedValue(0);
  mocks.revisionFindMany.mockResolvedValue([]);
  mocks.revisionCreate.mockResolvedValue({ id: "rev1" });
  mocks.create.mockImplementation(async ({ data }) => ({ id: "w1", version: 0, ...data }));
});

describe("creating whiteboards and slide decks", () => {
  it("creates an empty whiteboard: the page row has no blocks and the content lives in its own row", async () => {
    const response = await create(json({ kind: "whiteboard", title: "Plan", icon: null }));
    expect(response.status).toBe(201);
    expect(mocks.create.mock.calls[0][0].data).toMatchObject({ userId: "mine", kind: "whiteboard", title: "Plan", blocks: [], cover: null, coverPosition: null, parentId: null, groupId: null });
    const upsert = mocks.canvasUpsert.mock.calls[0][0];
    expect(upsert.where).toEqual({ noteId: "w1" });
    expect(upsert.create).toMatchObject({ noteId: "w1", data: { elements: [] }, segments: [], size: 15 });
    expect(upsert.create.hash).toMatch(/^[0-9a-f]{64}$/);
    expect((await response.json()).page).toMatchObject({ id: "w1", kind: "whiteboard", data: { elements: [] } });
    expect(mocks.schedule).toHaveBeenCalledWith("mine", ["w1"]);
  });

  it("creates a slide deck inside a note (kinds nest freely) and extracts its text on the server", async () => {
    mocks.resolveParent.mockResolvedValue({ id: "n1", groupId: "g1" });
    const data = { slides: [{ id: "s1", notes: "Speaker", elements: [{ id: "e1", type: "text", text: "Title" }] }] };
    expect((await create(json({ kind: "slides", title: "Deck", icon: "📊", parentId: "n1", data }))).status).toBe(201);
    expect(mocks.resolveParent).toHaveBeenCalledWith(expect.anything(), "mine", null, "n1");
    expect(mocks.create.mock.calls[0][0].data).toMatchObject({ kind: "slides", parentId: "n1", groupId: "g1", icon: "📊" });
    expect(mocks.canvasUpsert.mock.calls[0][0].create.segments).toEqual([{ id: "s1", text: "Title Speaker" }]);
  });

  it("rejects unknown kinds, embedded images and other users' files without creating anything", async () => {
    expect((await create(json({ kind: "canvas", title: "x" }))).status).toBe(400);
    expect((await create(json({ kind: "whiteboard", title: "x", data: { elements: [], files: { f: { dataURL: "data:image/png;base64,AAA" } } } }))).status).toBe(400);
    const foreign = await create(json({ kind: "whiteboard", title: "x", data: { elements: [], files: { f: { dataURL: fileUrl("someoneelse") } } } }));
    expect(foreign.status).toBe(400);
    expect((await foreign.json()).error).toBe("This page refers to a file that is not yours.");
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.canvasUpsert).not.toHaveBeenCalled();
  });

  it("refuses an oversized request with the size message of the kind it asked for", async () => {
    // 2 MB と少しを超えた本文は最後まで読まない。種類は読めた先頭から見分ける。
    const huge = "x".repeat(2 * 1024 * 1024 + 70 * 1024);
    const board = await create(json({ kind: "whiteboard", title: "x", data: { elements: [{ id: "f", type: "freedraw", points: huge }] } }));
    expect(board.status).toBe(413);
    expect((await board.json()).error).toBe("This page is larger than 2 MB and cannot be saved.");
    // kind が先頭でなくても、最上位なら見分ける（本体の中の "kind" には惑わされない）。
    const deck = await create(new Request("http://localhost/api/pages", { method: "POST", body: `{"title":"x","kind":"slides","data":{"slides":[{"id":"s","kind":"note","notes":"${huge}"}]}}` }));
    expect((await deck.json()).error).toBe("This page is larger than 2 MB and cannot be saved.");
    // kind が読めなかった先にあっても、本体（data）があって本文（blocks）がなければホワイトボード・スライドの文。
    const late = await create(new Request("http://localhost/api/pages", { method: "POST", body: `{"title":"x","data":{"slides":[{"id":"s","notes":"${huge}"}]},"kind":"slides"}` }));
    expect((await late.json()).error).toBe("This page is larger than 2 MB and cannot be saved.");
    const note = await create(json({ title: "x", blocks: [{ type: "paragraph", content: huge }] }));
    expect(note.status).toBe(413);
    expect((await note.json()).error).toBe("Note content exceeds 1 MiB.");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("still creates notes as before (kind defaults to note)", async () => {
    expect((await create(json({ title: "Note", icon: null, cover: null, coverPosition: null, blocks: [] }))).status).toBe(201);
    expect(mocks.create.mock.calls[0][0].data).not.toHaveProperty("kind");
    expect(mocks.canvasUpsert).not.toHaveBeenCalled();
  });
});

describe("reading and saving a whiteboard", () => {
  it("reads the content from its own row", async () => {
    mocks.findFirst.mockResolvedValue(row());
    mocks.canvasFindFirst.mockResolvedValue({ data: board() });
    const response = await read(new Request("http://localhost/api/pages/w1"), context);
    expect((await response.json()).page).toMatchObject({ id: "w1", kind: "whiteboard", data: board() });
    expect(mocks.canvasFindFirst).toHaveBeenCalledWith({ where: { noteId: "w1", note: { userId: "mine", deletedAt: null } }, select: { data: true } });
  });

  it("saves the content, snapshots first, and answers with the new version only (no content sent back)", async () => {
    mocks.findFirst.mockResolvedValueOnce({ kind: "whiteboard" }).mockResolvedValue({ id: "w1", kind: "whiteboard", title: "Board", icon: null, version: 4 });
    mocks.updateMany.mockResolvedValue({ count: 1 });
    const response = await save(patch({ title: "Board", data: board("Hi there"), version: 3 }), context);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ version: 4, page: { id: "w1", kind: "whiteboard", title: "Board", icon: null, version: 4 } });
    expect(JSON.stringify(body)).not.toContain("freedraw");
    expect(mocks.updateMany.mock.calls[0][0]).toEqual({ where: { id: "w1", userId: "mine", version: 3, deletedAt: null, kind: "whiteboard" }, data: { title: "Board", version: { increment: 1 } } });
    expect(mocks.canvasUpsert.mock.calls[0][0].update).toMatchObject({ data: board("Hi there"), segments: [{ id: "t1", text: "Hi there" }] });
    const snapshot = mocks.raw.mock.calls[0][0] as { sql: string };
    expect(snapshot.sql).toContain('LEFT JOIN "notefable"."NoteCanvas" c');
    expect(mocks.raw.mock.invocationCallOrder[0]).toBeLessThan(mocks.updateMany.mock.invocationCallOrder[0]);
    expect(mocks.schedule).toHaveBeenCalledWith("mine", ["w1"]);
  });

  it("marks the files the content refers to as in use, before moving the version (the storage cleanup must not delete them)", async () => {
    mocks.findFirst.mockResolvedValueOnce({ kind: "whiteboard" }).mockResolvedValue({ id: "w1", kind: "whiteboard", title: "Board", icon: null, version: 4 });
    mocks.updateMany.mockResolvedValue({ count: 1 });
    const data = { elements: [{ id: "i1", type: "image", fileId: "f1" }], files: { f1: { dataURL: fileUrl("mine") }, f2: { url: fileUrl("mine") } } };
    expect((await save(patch({ title: "Board", data, version: 3 }), context)).status).toBe(200);
    expect(mocks.claimFiles).toHaveBeenCalledWith({ where: { path: { in: ["note-files/mine/123e4567-e89b-12d3-a456-426614174000.png"] }, userId: "mine", deletingAt: null, releasedAt: { not: null } }, data: { releasedAt: null } });
    expect(mocks.claimFiles.mock.invocationCallOrder[0]).toBeLessThan(mocks.updateMany.mock.invocationCallOrder[0]);
    // 作成と履歴の復元でも同じく使用中へ戻す。
    vi.clearAllMocks();
    mocks.create.mockImplementation(async ({ data: row }) => ({ id: "w2", version: 0, ...row }));
    expect((await create(json({ kind: "whiteboard", title: "Plan", icon: null, data }))).status).toBe(201);
    expect(mocks.claimFiles.mock.calls[0][0].where.path).toEqual({ in: ["note-files/mine/123e4567-e89b-12d3-a456-426614174000.png"] });
    vi.clearAllMocks();
    mocks.raw.mockResolvedValue(0);
    mocks.revisionFindMany.mockResolvedValue([]);
    mocks.findFirst.mockResolvedValueOnce(row()).mockResolvedValue(row({ version: 4 }));
    mocks.revisionFindFirst.mockResolvedValue({ id: "r1", title: "Board", icon: null, blocks: [], data });
    mocks.canvasFindUnique.mockResolvedValue({ data: board("Current") });
    mocks.updateMany.mockResolvedValue({ count: 1 });
    const restored = await restore(new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ version: 3 }) }), { params: Promise.resolve({ pageId: "w1", revisionId: "r1" }) });
    expect(restored.status).toBe(200);
    expect(mocks.claimFiles.mock.calls[0][0].where.path).toEqual({ in: ["note-files/mine/123e4567-e89b-12d3-a456-426614174000.png"] });
  });

  it("renames without touching the content when data is left out", async () => {
    mocks.findFirst.mockResolvedValueOnce({ kind: "whiteboard" }).mockResolvedValue({ id: "w1", kind: "whiteboard", title: "New", icon: null, version: 4 });
    mocks.updateMany.mockResolvedValue({ count: 1 });
    expect((await save(patch({ title: "New", version: 3 }), context)).status).toBe(200);
    expect(mocks.canvasUpsert).not.toHaveBeenCalled();
    // 題名だけの変更でも、上書き前の状態は履歴の候補になる（間隔はノートと同じく SQL が判断する）。
    expect(mocks.raw).toHaveBeenCalledTimes(1);
  });

  it("answers a stale save with 409 and the current version, but accepts an identical resend after a lost response", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    mocks.findFirst.mockResolvedValueOnce({ kind: "whiteboard" }).mockResolvedValue({ id: "w1", kind: "whiteboard", title: "Board", icon: null, version: 9 });
    mocks.canvasFindUnique.mockResolvedValue({ hash: "different" });
    const stale = await save(patch({ title: "Board", data: board(), version: 3 }), context);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ version: 9, page: { id: "w1", version: 9 } });
    expect(mocks.canvasUpsert).not.toHaveBeenCalled();

    const { canvasHash } = await import("@/lib/canvas-store");
    mocks.findFirst.mockResolvedValueOnce({ kind: "whiteboard" }).mockResolvedValue({ id: "w1", kind: "whiteboard", title: "Board", icon: null, version: 4 });
    mocks.canvasFindUnique.mockResolvedValue({ hash: canvasHash(board()) });
    expect((await save(patch({ title: "Board", data: board(), version: 3 }), context)).status).toBe(200);
  });

  it("answers a stale rename (no content sent) with 409, since it cannot tell whether the content changed meanwhile", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    mocks.findFirst.mockResolvedValueOnce({ kind: "whiteboard" }).mockResolvedValue({ id: "w1", kind: "whiteboard", title: "Board", icon: null, version: 4 });
    const response = await save(patch({ title: "Board", version: 3 }), context);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ version: 4 });
    expect(mocks.canvasFindUnique).not.toHaveBeenCalled();
  });

  it("refuses a note body from an old note editor, in the requester's language, without writing", async () => {
    mocks.findFirst.mockResolvedValue({ kind: "slides" });
    const response = await save(patch({ title: "x", blocks: [], version: 3 }, { "accept-language": "ko" }), context);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toMatchObject({ code: "wrong_page_kind", kind: "slides" });
    expect(body.error).toMatch(/[가-힣]/);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("refuses content larger than 2 MB with 413", async () => {
    mocks.findFirst.mockResolvedValue({ kind: "whiteboard" });
    const big = { elements: [{ id: "f", type: "freedraw", points: "x".repeat(2 * 1024 * 1024) }] };
    expect((await save(patch({ title: "Board", data: big, version: 3 }), context)).status).toBe(413);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("answers 404 for someone else's or a trashed page", async () => {
    mocks.findFirst.mockResolvedValue(null);
    expect((await save(patch({ title: "x", data: board(), version: 1 }), context)).status).toBe(404);
  });
});

describe("restoring a whiteboard revision", () => {
  it("keeps the current content as a RESTORE revision, then writes the revision's content and returns it", async () => {
    const revisionData = board("Old text");
    mocks.findFirst.mockResolvedValueOnce(row()).mockResolvedValue(row({ version: 4 }));
    mocks.revisionFindFirst.mockResolvedValue({ id: "r1", title: "Board", icon: null, blocks: [], data: revisionData });
    mocks.canvasFindUnique.mockResolvedValue({ data: board("Current") });
    mocks.updateMany.mockResolvedValue({ count: 1 });
    const request = new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ version: 3 }) });
    const response = await restore(request, { params: Promise.resolve({ pageId: "w1", revisionId: "r1" }) });
    expect(response.status).toBe(200);
    expect((await response.json()).page).toMatchObject({ id: "w1", version: 4, data: revisionData });
    expect(mocks.revisionCreate.mock.calls[0][0].data).toMatchObject({ reason: "RESTORE", blocks: [], data: board("Current"), version: 3 });
    expect(mocks.canvasUpsert.mock.calls[0][0].update).toMatchObject({ data: revisionData, segments: [{ id: "t1", text: "Old text" }] });
    // 履歴はホワイトボードの上限（5 + 5 件）で切りそろえる。
    expect(mocks.revisionFindMany.mock.calls[0][0].skip).toBe(5);
  });
});

describe("changing the icon of a whiteboard", () => {
  it("returns the content too, read after the page row, so the screen never pairs a new version with old content", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findFirst.mockResolvedValue(row({ icon: "🎨", version: 5 }));
    mocks.canvasFindFirst.mockResolvedValue({ data: board("Latest") });
    const response = await changeIcon(new Request("http://localhost/x", { method: "PUT", body: JSON.stringify({ icon: "🎨" }) }), context);
    expect((await response.json()).page).toMatchObject({ icon: "🎨", version: 5, data: board("Latest") });
    expect(mocks.findFirst.mock.invocationCallOrder.at(-1)!).toBeLessThan(mocks.canvasFindFirst.mock.invocationCallOrder[0]);
  });
});

describe("publishing", () => {
  it("refuses to publish a whiteboard (no public view yet) in the requester's language", async () => {
    mocks.findFirst.mockResolvedValue({ id: "w1", kind: "whiteboard", shareToken: null, shareEnabled: false, shareExpiresAt: null });
    const response = await share(new Request("http://localhost/x", { method: "PUT", body: JSON.stringify({ enabled: true }), headers: { "accept-language": "ja" } }), context);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toMatchObject({ code: "wrong_page_kind", kind: "whiteboard" });
    expect(body.error).toBe("ホワイトボードとスライドはまだ公開できません。");
  });
});
