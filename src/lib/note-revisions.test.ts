import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ raw: vi.fn(), unsafe: vi.fn(), create: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ databaseSchema: "notefable", prisma: {} }));
import {
  AUTO_REVISION_INTERVAL_MS, AUTO_REVISION_MAX_AGE_MS, createRevision, MAX_AUTO_REVISIONS_PER_NOTE, MAX_MARKED_REVISIONS_PER_NOTE, MAX_REVISIONS_PER_NOTE, snapshotBeforeSave, snapshotSql, toRevisionDetail, toRevisionSummary,
} from "./note-revisions";

const tx = { $executeRaw: mocks.raw, $executeRawUnsafe: mocks.unsafe, noteRevision: { create: mocks.create, findMany: mocks.findMany, deleteMany: mocks.deleteMany } } as unknown as Parameters<typeof snapshotBeforeSave>[0];
const input = { noteId: "n1", userId: "mine", version: 7 };
const flat = (sql: string) => sql.replace(/\s+/g, " ").trim();

describe("auto-save snapshot SQL", () => {
  it("is one INSERT ... SELECT from the live note, qualified with the database schema", () => {
    const { sql, values } = snapshotSql(input);
    const text = flat(sql);
    expect(text).toContain('INSERT INTO "notefable"."NoteRevision" ("id", "noteId", "userId", "reason", "title", "icon", "blocks", "version", "createdAt")');
    expect(text).toContain('FROM "notefable"."NotePage" p');
    expect(text).toContain("gen_random_uuid()::text");
    expect(text).toContain(`'AUTO'::"notefable"."NoteRevisionReason"`);
    expect(text).toContain('p."title", p."icon", p."blocks", p."version"');
    expect(values).toEqual(["n1", "mine", 7]);
  });

  it("copies only an owned, live note whose stored version is the one being overwritten", () => {
    const text = flat(snapshotSql(input).sql);
    expect(text).toContain('WHERE p."id" = ? AND p."userId" = ? AND p."version" = ? AND p."deletedAt" IS NULL');
  });

  it("skips empty notes without risking an error on a non-array blocks value", () => {
    const text = flat(snapshotSql(input).sql);
    expect(text).toContain(`jsonb_typeof(p."blocks") = 'array' AND p."blocks" <> '[]'::jsonb`);
    expect(text).not.toContain("jsonb_array_length");
  });

  it("skips the copy when an auto revision of the note is newer than 10 minutes, comparing in UTC", () => {
    expect(AUTO_REVISION_INTERVAL_MS).toBe(10 * 60 * 1000);
    const text = flat(snapshotSql(input).sql);
    expect(text).toContain(`NOT EXISTS ( SELECT 1 FROM "notefable"."NoteRevision" r WHERE r."noteId" = p."id" AND r."reason" = 'AUTO'::"notefable"."NoteRevisionReason" AND r."createdAt" > (now() AT TIME ZONE 'UTC') - interval '600 seconds' )`);
    expect(text).toContain(`(now() AT TIME ZONE 'UTC')`);
  });

  it("locks the note row so two saves of the same version cannot both snapshot", () => {
    expect(flat(snapshotSql(input).sql)).toMatch(/FOR UPDATE OF p$/);
  });
});

describe("snapshotBeforeSave and createRevision", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.findMany.mockResolvedValue([]); });

  it("reports false and does not prune when nothing was inserted", async () => {
    mocks.raw.mockResolvedValue(0);
    expect(await snapshotBeforeSave(tx, input)).toBe(false);
    expect(mocks.findMany).not.toHaveBeenCalled();
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });

  it("keeps separate budgets for auto-saves and for AI-edit / restore snapshots", async () => {
    mocks.raw.mockResolvedValue(1);
    mocks.findMany.mockResolvedValueOnce([{ id: "a31" }]).mockResolvedValueOnce([{ id: "m21" }]);
    expect(await snapshotBeforeSave(tx, input)).toBe(true);
    expect(MAX_AUTO_REVISIONS_PER_NOTE).toBe(30);
    expect(MAX_MARKED_REVISIONS_PER_NOTE).toBe(20);
    expect(MAX_REVISIONS_PER_NOTE).toBe(50);
    const order = [{ createdAt: "desc" }, { id: "desc" }];
    expect(mocks.findMany).toHaveBeenNthCalledWith(1, { where: { noteId: "n1", userId: "mine", reason: "AUTO" }, orderBy: order, skip: 30, select: { id: true } });
    expect(mocks.findMany).toHaveBeenNthCalledWith(2, { where: { noteId: "n1", userId: "mine", reason: { not: "AUTO" } }, orderBy: order, skip: 20, select: { id: true } });
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["a31", "m21"] }, noteId: "n1", userId: "mine" } });
  });

  it("drops auto-saves older than 90 days after a snapshot was inserted", async () => {
    mocks.raw.mockResolvedValue(1);
    const before = Date.now();
    await snapshotBeforeSave(tx, input);
    const call = mocks.deleteMany.mock.calls.map(([arg]) => arg).find((arg) => arg.where.createdAt);
    expect(call.where).toMatchObject({ noteId: "n1", userId: "mine", reason: "AUTO" });
    expect(call.where.createdAt.lt.getTime()).toBeGreaterThanOrEqual(before - AUTO_REVISION_MAX_AGE_MS);
    expect(call.where.createdAt.lt.getTime()).toBeLessThanOrEqual(Date.now() - AUTO_REVISION_MAX_AGE_MS);
  });

  it("wraps the snapshot in a savepoint and releases it on success", async () => {
    mocks.raw.mockResolvedValue(0);
    await snapshotBeforeSave(tx, input);
    expect(mocks.unsafe.mock.calls.map(([sql]) => sql)).toEqual(["SAVEPOINT note_snapshot", "RELEASE SAVEPOINT note_snapshot"]);
  });

  it("never fails the save when the snapshot errors: it rolls back to the savepoint and reports false", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.raw.mockRejectedValue(new Error("boom"));
    expect(await snapshotBeforeSave(tx, input)).toBe(false);
    expect(mocks.unsafe.mock.calls.map(([sql]) => sql)).toEqual(["SAVEPOINT note_snapshot", "ROLLBACK TO SAVEPOINT note_snapshot"]);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("creates an explicit revision with the given reason and prunes", async () => {
    const blocks = [{ id: "b", type: "paragraph", props: {}, content: [], children: [] }];
    mocks.findMany.mockResolvedValueOnce([{ id: "old" }]).mockResolvedValueOnce([]);
    await createRevision(tx, { noteId: "n1", userId: "mine", reason: "AI_EDIT", title: "Before", icon: "📚", blocks, version: 4 });
    expect(mocks.create).toHaveBeenCalledWith({ data: { noteId: "n1", userId: "mine", reason: "AI_EDIT", title: "Before", icon: "📚", blocks, version: 4 } });
    expect(mocks.create.mock.invocationCallOrder[0]).toBeLessThan(mocks.findMany.mock.invocationCallOrder[0]);
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["old"] }, noteId: "n1", userId: "mine" } });
  });
});

describe("revision views for the browser", () => {
  const row = { id: "r1", reason: "RESTORE" as const, title: "T", icon: null, blocks: [], version: 3, createdAt: new Date("2026-10-15T01:02:03.000Z") };

  it("lists a revision without its blocks and with an ISO time", () => {
    expect(toRevisionSummary(row)).toEqual({ id: "r1", reason: "RESTORE", title: "T", version: 3, createdAt: "2026-10-15T01:02:03.000Z" });
    expect(toRevisionSummary(row)).not.toHaveProperty("blocks");
  });

  it("returns the full content for one revision", () => {
    expect(toRevisionDetail(row)).toEqual({ id: "r1", reason: "RESTORE", title: "T", icon: null, blocks: [], version: 3, createdAt: "2026-10-15T01:02:03.000Z" });
  });
});
