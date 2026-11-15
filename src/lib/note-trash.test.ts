import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ deleteMany: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ databaseSchema: "notefable", prisma: { notePage: { deleteMany: mocks.deleteMany } } }));
import { purgeExpiredNotes, toTrashItem, TRASH_RETENTION_DAYS, TRASH_RETENTION_MS, trashCutoff, trashPurgeAt, tryPurgeExpiredNotes } from "./note-trash";

const DAY = 24 * 60 * 60 * 1000;

describe("note trash retention", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("keeps trashed notes for 30 days, with the same constant the UI imports", async () => {
    expect(TRASH_RETENTION_DAYS).toBe(30);
    expect(TRASH_RETENTION_MS).toBe(30 * DAY);
    expect((await import("@/types/notes")).TRASH_RETENTION_DAYS).toBe(TRASH_RETENTION_DAYS);
  });

  it("computes the purge time and the restore/purge cutoff from the same boundary", () => {
    const now = Date.UTC(2026, 9, 15, 12, 0, 0);
    expect(trashCutoff(now).getTime()).toBe(now - 30 * DAY);
    expect(trashPurgeAt(new Date(now - 30 * DAY)).getTime()).toBe(now);
  });

  it("describes a trashed note for the browser with ISO times and its purge time", () => {
    const deletedAt = new Date("2026-10-01T09:00:00.000Z");
    expect(toTrashItem({ id: "n1", title: "Plan", icon: "📚", deletedAt })).toEqual({
      id: "n1", title: "Plan", icon: "📚", deletedAt: "2026-10-01T09:00:00.000Z", purgeAt: "2026-10-31T09:00:00.000Z",
    });
  });

  it("purges only this user's notes trashed before the cutoff, and returns how many", async () => {
    mocks.deleteMany.mockResolvedValue({ count: 3 });
    const now = Date.UTC(2026, 9, 15);
    expect(await purgeExpiredNotes("mine", now)).toBe(3);
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: { userId: "mine", deletedAt: { lt: new Date(now - 30 * DAY) } } });
  });

  it("the quiet variant logs and swallows failures", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.deleteMany.mockRejectedValue(new Error("down"));
    expect(await tryPurgeExpiredNotes("mine")).toBe(0);
    expect(log).toHaveBeenCalled();
    mocks.deleteMany.mockResolvedValue({ count: 2 });
    expect(await tryPurgeExpiredNotes("mine")).toBe(2);
  });
});
