import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const stored = { findMany: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn(), create: vi.fn(), createMany: vi.fn() };
  const prisma = {
    storedFile: stored,
    notePage: { findMany: vi.fn() },
    noteRevision: { findMany: vi.fn() },
    attachment: { findMany: vi.fn() },
    user: { findMany: vi.fn(), findUnique: vi.fn() },
    maintenanceJob: { createMany: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  return { prisma, remove: vi.fn(), write: vi.fn(), list: vi.fn(), foreign: vi.fn(), after: vi.fn() };
});
vi.mock("@/lib/prisma", () => ({ databaseSchema: "notefable", prisma: mocks.prisma }));
vi.mock("@/lib/storage", () => ({ deleteStoredImage: mocks.remove, writeStoredImageAt: mocks.write, listStoredFiles: mocks.list, sharesForeignStorage: mocks.foreign }));
vi.mock("next/server", () => ({ after: mocks.after }));
import {
  FILE_GRACE_MS, NOTE_FILE_OWNERS_PER_BATCH, NOTE_FILE_REFERENCE, assertStorageRoom, collectUnusedFiles, inventoryStoredFiles, limitNoteFileOwners,
  referencedPaths, reserveStoredFile, runStorageMaintenance, storeFile, storageLimitResponse,
} from "./stored-files";
import { STORAGE_LIMITS, StorageLimitError } from "./usage-plans";

const member = { id: "m1", googleSub: "g1", verifiedEmail: null, plan: "FREE" };
const guest = { id: "g1", googleSub: null, verifiedEmail: null, plan: "FREE" };
const uuid = (n: number) => `0e111e3a-9e25-4944-ade7-b460580fa92${n}`;
const used = (bytes: number) => mocks.prisma.$queryRaw.mockResolvedValue([{ used: BigInt(bytes) }]);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.prisma.$transaction.mockImplementation(async (run: (tx: typeof mocks.prisma) => unknown) => run(mocks.prisma));
  mocks.prisma.storedFile.updateMany.mockResolvedValue({ count: 0 });
  mocks.prisma.notePage.findMany.mockResolvedValue([]);
  mocks.prisma.noteRevision.findMany.mockResolvedValue([]);
  mocks.prisma.attachment.findMany.mockResolvedValue([]);
  mocks.prisma.user.findMany.mockResolvedValue([]);
});

describe("storage quota", () => {
  it("refuses a file that does not fit, with the tier and numbers the screens need", async () => {
    used(STORAGE_LIMITS.member - 100);
    const error = await reserveStoredFile(member, { path: "note-files/m1/a.png", kind: "NOTE_FILE", size: 101 }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(StorageLimitError);
    expect(error).toMatchObject({ tier: "member", used: STORAGE_LIMITS.member - 100, limit: STORAGE_LIMITS.member });
    expect(mocks.prisma.storedFile.create).not.toHaveBeenCalled();
    // 同じ利用者の同時のアップロードは 1 つずつ数える。
    expect(mocks.prisma.$executeRaw).toHaveBeenCalled();
    const response = storageLimitResponse(error as StorageLimitError);
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ code: "storage_limit", tier: "member", used: STORAGE_LIMITS.member - 100, limit: STORAGE_LIMITS.member });
  });

  it("records a fitting file as not yet referenced, and skips the check when not enforced", async () => {
    used(STORAGE_LIMITS.guest - 100);
    await reserveStoredFile(guest, { path: "note-files/g1/a.png", kind: "NOTE_FILE", size: 100 });
    expect(mocks.prisma.storedFile.create).toHaveBeenCalledWith({ data: { path: "note-files/g1/a.png", userId: "g1", kind: "NOTE_FILE", size: 100, releasedAt: expect.any(Date) } });
    used(STORAGE_LIMITS.guest);
    mocks.prisma.$queryRaw.mockClear();
    await reserveStoredFile(guest, { path: "images/2026/11/23/b.png", kind: "CHAT_IMAGE", size: 5000 }, { enforce: false, held: true });
    expect(mocks.prisma.$queryRaw).not.toHaveBeenCalled();
    // 同じリクエストで参照を付けるファイルは、最初から使用中として記録する。
    expect(mocks.prisma.storedFile.create).toHaveBeenLastCalledWith({ data: { path: "images/2026/11/23/b.png", userId: "g1", kind: "CHAT_IMAGE", size: 5000, releasedAt: null } });
    expect(mocks.prisma.storedFile.create).toHaveBeenCalledTimes(2);
  });

  it("uses the Pro limit for Pro users and looks the owner up by id", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({ ...member, plan: "PRO" });
    used(STORAGE_LIMITS.member * 3);
    await expect(reserveStoredFile("m1", { path: "note-files/m1/a.png", kind: "NOTE_FILE", size: 1000 })).resolves.toBeUndefined();
  });

  it("refuses new generated content once storage is full, even before its size is known", async () => {
    used(STORAGE_LIMITS.guest);
    await expect(assertStorageRoom(guest, 0)).rejects.toMatchObject({ tier: "guest", message: expect.stringContaining("Sign in") });
    used(STORAGE_LIMITS.guest - 10);
    await expect(assertStorageRoom(guest, 0)).resolves.toBeUndefined();
    await expect(assertStorageRoom(guest, 11)).rejects.toBeInstanceOf(StorageLimitError);
  });

  it("marks the row for deletion when the file cannot be written", async () => {
    used(0);
    mocks.write.mockRejectedValue(new Error("blob down"));
    mocks.prisma.storedFile.updateMany.mockResolvedValue({ count: 1 });
    await expect(storeFile(member, { path: "note-files/m1/a.png", kind: "NOTE_FILE", buffer: Buffer.alloc(3), mimeType: "image/png" })).rejects.toThrow("blob down");
    expect(mocks.prisma.storedFile.updateMany).toHaveBeenCalledWith({ where: { path: "note-files/m1/a.png" }, data: { releasedAt: expect.any(Date), deletingAt: expect.any(Date) } });
  });
});

describe("references", () => {
  it("matches note file URLs with or without encoding, in any case", () => {
    const pattern = new RegExp(NOTE_FILE_REFERENCE, "gi");
    const body = JSON.stringify([
      { type: "image", props: { url: `/api/pages/files?key=note-files%2Fm1%2F${uuid(1)}.png&name=a.png` } },
      { type: "file", props: { url: `/api/pages/files?key=note-files/m1/${uuid(2).toUpperCase()}.pdf&name=b` } },
    ]);
    expect([...body.matchAll(pattern)].map((match) => match[1].toLowerCase())).toEqual([uuid(1), uuid(2)]);
  });

  it("checks each kind of file in its own place", async () => {
    mocks.prisma.$queryRaw.mockResolvedValue([{ id: uuid(1) }]);
    mocks.prisma.notePage.findMany.mockResolvedValue([{ cover: "upload:page-covers/m1/c.png", icon: null }]);
    mocks.prisma.noteRevision.findMany.mockResolvedValue([{ icon: "upload:page-covers/m1/i.png" }]);
    mocks.prisma.attachment.findMany.mockResolvedValue([{ imageStoragePath: "images/2026/11/23/x.png" }]);
    mocks.prisma.user.findMany.mockResolvedValue([{ avatarImage: "avatars/m1/p.png", appIconImage: null }]);
    const found = await referencedPaths([
      { path: `note-files/m1/${uuid(1)}.png`, userId: "m1", kind: "NOTE_FILE" },
      { path: `note-files/m1/${uuid(2)}.png`, userId: "m1", kind: "NOTE_FILE" },
      { path: "page-covers/m1/c.png", userId: "m1", kind: "NOTE_COVER" },
      { path: "page-covers/m1/i.png", userId: "m1", kind: "NOTE_COVER" },
      { path: "page-covers/m1/free.png", userId: "m1", kind: "NOTE_COVER" },
      { path: "images/2026/11/23/x.png", userId: "m1", kind: "CHAT_IMAGE" },
      { path: "images/2026/11/23/y.png", userId: "m1", kind: "CHAT_IMAGE" },
      { path: "avatars/m1/p.png", userId: "m1", kind: "AVATAR" },
      { path: "avatars/m1/old.png", userId: "m1", kind: "AVATAR" },
      // 持ち主のいないファイルは、どこからも参照されていない。
      { path: `note-files/gone/${uuid(1)}.png`, userId: null, kind: "NOTE_FILE" },
    ]);
    expect([...found].sort()).toEqual(["avatars/m1/p.png", "images/2026/11/23/x.png", `note-files/m1/${uuid(1)}.png`, "page-covers/m1/c.png", "page-covers/m1/i.png"]);
    // ノートのファイルは持ち主ごとに 1 回だけ調べる（ノート・履歴・待っている提案）。
    expect(mocks.prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });
});

describe("unused file collection", () => {
  const now = Date.UTC(2026, 10, 23);
  const cutoff = new Date(now - FILE_GRACE_MS);
  const file = (path: string, kind = "NOTE_COVER", userId: string | null = "m1") => ({ path, kind, userId });
  // findMany は 1. 使用中の巡回 2. 猶予切れ 3. 削除中 の順に呼ばれる。
  const queries = (held: ReturnType<typeof file>[], expired: ReturnType<typeof file>[], deleting: string[]) => mocks.prisma.storedFile.findMany
    .mockResolvedValueOnce(held)
    .mockResolvedValueOnce(expired)
    .mockResolvedValueOnce(deleting.map((path) => ({ path })));

  it("starts the grace period when a file stops being referenced and re-checks after marking", async () => {
    queries([file("page-covers/m1/a.png"), file("page-covers/m1/b.png"), file("page-covers/m1/c.png")], [], []);
    let calls = 0;
    // 1 回目の確認では b だけ使用中。記録した直後の確認で c にも参照が付いていた。
    mocks.prisma.notePage.findMany.mockImplementation(async () => (++calls === 1 ? [{ cover: "upload:page-covers/m1/b.png", icon: null }] : [{ cover: "upload:page-covers/m1/c.png", icon: null }]));
    mocks.prisma.storedFile.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 3 }).mockResolvedValueOnce({ count: 2 }).mockResolvedValueOnce({ count: 1 });
    expect(await collectUnusedFiles(now)).toEqual({ released: 1, started: 0, deleted: 0 });
    // 持ち主のいないファイルは猶予なしで削除へ。
    expect(mocks.prisma.storedFile.updateMany).toHaveBeenNthCalledWith(1, { where: { userId: null, deletingAt: null }, data: { releasedAt: new Date(now), deletingAt: new Date(now) } });
    expect(mocks.prisma.storedFile.updateMany).toHaveBeenNthCalledWith(2, { where: { path: { in: ["page-covers/m1/a.png", "page-covers/m1/b.png", "page-covers/m1/c.png"] } }, data: { checkedAt: new Date(now) } });
    expect(mocks.prisma.storedFile.updateMany).toHaveBeenNthCalledWith(3, { where: { path: { in: ["page-covers/m1/a.png", "page-covers/m1/c.png"] }, releasedAt: null, deletingAt: null }, data: { releasedAt: new Date(now) } });
    expect(mocks.prisma.storedFile.updateMany).toHaveBeenNthCalledWith(4, { where: { path: { in: ["page-covers/m1/c.png"] }, deletingAt: null }, data: { releasedAt: null } });
    expect(mocks.prisma.storedFile.findMany.mock.calls[0][0]).toMatchObject({ orderBy: [{ checkedAt: { sort: "asc", nulls: "first" } }, { path: "asc" }] });
  });

  it("marks expired unused files as deleting, keeps re-referenced ones, and removes rows only after the file is gone", async () => {
    queries([], [file("images/2026/11/01/gone.png", "CHAT_IMAGE"), file("images/2026/11/01/reused.png", "CHAT_IMAGE")], ["images/2026/11/01/gone.png", "stuck.png"]);
    mocks.prisma.attachment.findMany.mockResolvedValue([{ imageStoragePath: "images/2026/11/01/reused.png" }]);
    mocks.prisma.storedFile.updateMany.mockResolvedValue({ count: 1 });
    mocks.prisma.storedFile.deleteMany.mockResolvedValue({ count: 1 });
    mocks.remove.mockImplementation(async (path: string) => { if (path === "stuck.png") throw new Error("blob down"); });
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await collectUnusedFiles(now)).toEqual({ released: 0, started: 1, deleted: 1 });
    expect(mocks.prisma.storedFile.updateMany).toHaveBeenCalledWith({ where: { path: "images/2026/11/01/reused.png", deletingAt: null }, data: { releasedAt: null } });
    expect(mocks.prisma.storedFile.updateMany).toHaveBeenCalledWith({ where: { path: "images/2026/11/01/gone.png", releasedAt: { lt: cutoff }, deletingAt: null }, data: { deletingAt: new Date(now) } });
    expect(mocks.prisma.storedFile.deleteMany.mock.calls).toEqual([[{ where: { path: "images/2026/11/01/gone.png", deletingAt: { not: null } } }]]);
  });

  it("checks note files of a limited number of owners per batch and leaves the rest unchecked for the next round", () => {
    const rows = Array.from({ length: NOTE_FILE_OWNERS_PER_BATCH + 5 }, (_, i) => [
      file(`note-files/u${i}/a`, "NOTE_FILE", `u${i}`), file(`note-files/u${i}/b`, "NOTE_FILE", `u${i}`), file(`images/x${i}.png`, "CHAT_IMAGE", `u${i}`),
    ]).flat();
    const kept = limitNoteFileOwners(rows as Parameters<typeof limitNoteFileOwners>[0]);
    expect(new Set(kept.filter((row) => row.kind === "NOTE_FILE").map((row) => row.userId)).size).toBe(NOTE_FILE_OWNERS_PER_BATCH);
    // 同じ持ち主のファイルはまとめて残り、ほかの種類は全部残る。
    expect(kept.filter((row) => row.userId === "u0" && row.kind === "NOTE_FILE")).toHaveLength(2);
    expect(kept.filter((row) => row.kind === "CHAT_IMAGE")).toHaveLength(NOTE_FILE_OWNERS_PER_BATCH + 5);
  });

  it("stops at the deadline and leaves the rest for the next run", async () => {
    mocks.prisma.storedFile.findMany.mockResolvedValue([]);
    expect(await collectUnusedFiles(now, Date.now() - 1)).toEqual({ released: 0, started: 0, deleted: 0 });
    expect(mocks.prisma.storedFile.findMany).not.toHaveBeenCalled();
  });
});

describe("inventory of files from before the records", () => {
  it("adopts files whose owner is known here, fills in missing sizes, and leaves the rest alone", async () => {
    mocks.list.mockImplementation(async (prefix: string) => prefix === "note-files/"
      ? { files: [
        { path: `note-files/m1/${uuid(1)}.png`, size: 10, uploadedAt: new Date(1) },
        { path: `note-files/other/${uuid(2)}.png`, size: 20, uploadedAt: new Date(2) },
        { path: `note-files/m1/${uuid(3)}.png`, size: 30, uploadedAt: new Date(3) },
      ] }
      : prefix === "images/"
        ? { files: [{ path: "images/2026/01/01/a.png", size: 40, uploadedAt: new Date(4) }, { path: "images/2026/01/01/stray.png", size: 50, uploadedAt: new Date(5) }] }
        : { files: [] });
    mocks.prisma.storedFile.findMany.mockImplementation(async ({ where }: { where: { path: { in: string[] } } }) =>
      where.path.in.includes(`note-files/m1/${uuid(3)}.png`) ? [{ path: `note-files/m1/${uuid(3)}.png`, size: null }] : []);
    mocks.prisma.user.findMany.mockResolvedValue([{ id: "m1" }]);
    mocks.prisma.attachment.findMany.mockResolvedValue([{ imageStoragePath: "images/2026/01/01/a.png", message: { session: { userId: "m1" } } }]);
    const now = new Date(Date.UTC(2026, 10, 23));

    const state = await inventoryStoredFiles(null, Date.now() + 60_000, now);
    expect(state).toEqual({ index: 0, finishedAt: now.toISOString() });
    expect(mocks.prisma.storedFile.updateMany).toHaveBeenCalledWith({ where: { path: `note-files/m1/${uuid(3)}.png`, size: null }, data: { size: 30 } });
    expect(mocks.prisma.storedFile.createMany.mock.calls.map(([args]) => args.data)).toEqual([
      [{ path: `note-files/m1/${uuid(1)}.png`, userId: "m1", kind: "NOTE_FILE", size: 10, releasedAt: null, checkedAt: null, createdAt: new Date(1) }],
      [{ path: "images/2026/01/01/a.png", userId: "m1", kind: "CHAT_IMAGE", size: 40, releasedAt: null, checkedAt: null, createdAt: new Date(4) }],
    ]);
  });

  it("continues from the saved position when time runs out", async () => {
    mocks.list.mockResolvedValue({ files: [], cursor: "next" });
    const deadline = Date.now() + 10_000;
    let calls = 0;
    mocks.list.mockImplementation(async () => { calls += 1; if (calls >= 2) vi.setSystemTime(deadline + 1); return { files: [], cursor: `c${calls}` }; });
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      expect(await inventoryStoredFiles({ index: 2, cursor: "c0" }, deadline)).toEqual({ index: 2, cursor: "c2" });
      expect(mocks.list).toHaveBeenNthCalledWith(1, "images/", "c0");
    } finally { vi.useRealTimers(); }
  });
});

describe("storage maintenance", () => {
  it("never runs when this environment shares the file store with another database", async () => {
    mocks.foreign.mockReturnValue(true);
    expect(await runStorageMaintenance()).toBeNull();
    expect(mocks.prisma.maintenanceJob.updateMany).not.toHaveBeenCalled();
  });

  it("does nothing until it is time, or while another run holds the job", async () => {
    mocks.foreign.mockReturnValue(false);
    mocks.prisma.maintenanceJob.updateMany.mockResolvedValue({ count: 0 });
    expect(await runStorageMaintenance(Date.UTC(2026, 10, 23))).toBeNull();
    expect(mocks.prisma.maintenanceJob.updateMany).toHaveBeenCalledWith({
      where: { name: "storage", runAfter: { lte: new Date(Date.UTC(2026, 10, 23)) }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date(Date.UTC(2026, 10, 23)) } }] },
      data: { lockedUntil: expect.any(Date) },
    });
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("still collects when listing the file store fails, and saves inventory progress page by page", async () => {
    const now = Date.UTC(2026, 10, 23, 12);
    mocks.foreign.mockReturnValue(false);
    mocks.prisma.maintenanceJob.updateMany.mockResolvedValue({ count: 1 });
    mocks.prisma.maintenanceJob.findUnique.mockResolvedValue({ state: null });
    mocks.prisma.maintenanceJob.update.mockResolvedValue({});
    mocks.prisma.storedFile.findMany.mockResolvedValue([]);
    mocks.prisma.storedFile.deleteMany.mockResolvedValue({ count: 1 });
    mocks.remove.mockResolvedValue(undefined);
    vi.spyOn(console, "error").mockImplementation(() => {});
    // 一時ファイルの一覧は失敗し、棚卸しは 1 ページ目のあとで失敗する。
    mocks.list.mockImplementation(async (prefix: string, cursor?: string) => {
      if (prefix === "chat-uploads/") throw new Error("list quota exceeded");
      if (prefix === "note-files/" && !cursor) return { files: [], cursor: "page-2" };
      throw new Error("list quota exceeded");
    });
    mocks.prisma.storedFile.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ path: "gone.png" }]);

    expect(await runStorageMaintenance(now)).toEqual({ reaped: 0, released: 0, started: 0, deleted: 1 });
    expect(mocks.prisma.maintenanceJob.update).toHaveBeenCalledWith({ where: { name: "storage" }, data: { state: { inventory: { index: 0, cursor: "page-2" } } } });
    expect(mocks.prisma.maintenanceJob.update).toHaveBeenLastCalledWith({
      where: { name: "storage" },
      data: { lockedUntil: null, runAfter: new Date(now + 6 * 60 * 60 * 1000), state: { inventory: { index: 0, cursor: "page-2" } } },
    });
  });

  it("reaps stale chat uploads, continues the inventory, collects, and schedules the next run", async () => {
    const now = Date.UTC(2026, 10, 23, 12);
    mocks.foreign.mockReturnValue(false);
    mocks.prisma.maintenanceJob.updateMany.mockResolvedValue({ count: 1 });
    mocks.prisma.maintenanceJob.findUnique.mockResolvedValue({ state: { inventory: { index: 0, finishedAt: new Date(now - 60_000).toISOString() } } });
    mocks.prisma.maintenanceJob.update.mockResolvedValue({});
    mocks.prisma.storedFile.findMany.mockResolvedValue([]);
    mocks.list.mockImplementation(async (prefix: string) => prefix === "chat-uploads/"
      ? { files: [{ path: "chat-uploads/m1/old", size: 1, uploadedAt: new Date(now - 3 * 60 * 60 * 1000) }, { path: "chat-uploads/m1/new", size: 1, uploadedAt: new Date(now - 60_000) }] }
      : { files: [] });
    mocks.remove.mockResolvedValue(undefined);

    expect(await runStorageMaintenance(now)).toEqual({ reaped: 1, released: 0, started: 0, deleted: 0 });
    expect(mocks.remove).toHaveBeenCalledWith("chat-uploads/m1/old");
    expect(mocks.remove).not.toHaveBeenCalledWith("chat-uploads/m1/new");
    // 棚卸しは 1 週間に 1 巡。終わったばかりなので、今回は置き場を見ない。
    expect(mocks.list.mock.calls.map(([prefix]) => prefix)).toEqual(["chat-uploads/"]);
    expect(mocks.prisma.maintenanceJob.update).toHaveBeenCalledWith({
      where: { name: "storage" },
      data: { lockedUntil: null, runAfter: new Date(now + 6 * 60 * 60 * 1000), state: { inventory: { index: 0, finishedAt: new Date(now - 60_000).toISOString() } } },
    });
  });
});
