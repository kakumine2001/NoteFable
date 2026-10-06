import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pages: { findMany: vi.fn(), count: vi.fn() },
  assets: { findMany: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
  remove: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { notePage: mocks.pages, noteCoverAsset: mocks.assets } }));
vi.mock("@/lib/storage", () => ({ deleteStoredImage: mocks.remove }));
import { COVER_GRACE_MS, assertCoverOwner, claimCover, collectUnusedCovers, sniffCoverImage } from "./note-covers";

const uuid = (n: number) => `0e111e3a-9e25-4944-ade7-b460580fa92${n}`;

describe("page cover uploads", () => {
  it("detects images by their leading bytes, not by name", () => {
    expect(sniffCoverImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("image/png");
    expect(sniffCoverImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffCoverImage(Buffer.from("GIF89a....", "latin1"))).toBe("image/gif");
    expect(sniffCoverImage(Buffer.from("RIFF\0\0\0\0WEBPVP8 ", "latin1"))).toBe("image/webp");
    expect(sniffCoverImage(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
  });

  it("only lets a user reference covers from their own folder", () => {
    const cover = `upload:page-covers/mine/${uuid(5)}.png`;
    expect(() => assertCoverOwner(cover, "mine")).not.toThrow();
    expect(() => assertCoverOwner(cover, "other")).toThrow("cover");
    expect(() => assertCoverOwner("gradient-ocean", "other")).not.toThrow();
    expect(() => assertCoverOwner(null, "other")).not.toThrow();
  });
});

describe("unused cover collection", () => {
  beforeEach(() => { vi.resetAllMocks(); });
  const now = Date.UTC(2026, 9, 20);
  const cutoff = new Date(now - COVER_GRACE_MS);
  // findMany は 1. 使用中の走査 2. 期限切れ 3. 削除中 の順に呼ばれる。
  const assetQueries = (held: string[], expired: string[], deleting: string[]) => mocks.assets.findMany
    .mockResolvedValueOnce(held.map((path) => ({ path })))
    .mockResolvedValueOnce(expired.map((path) => ({ path })))
    .mockResolvedValueOnce(deleting.map((path) => ({ path })));
  const referencing = (paths: string[]) => mocks.pages.findMany.mockImplementation(async ({ where }: { where: { cover: { in: string[] } } }) =>
    where.cover.in.filter((cover) => paths.some((path) => cover === `upload:${path}`)).map((cover) => ({ cover })));

  it("starts the grace period when a cover stops being referenced and re-checks after marking", async () => {
    assetQueries(["a", "b", "c"], [], []);
    let calls = 0;
    // 1 回目の確認では b だけ使用中。記録直後の確認で c にも参照が付いていた。
    mocks.pages.findMany.mockImplementation(async () => (++calls === 1 ? [{ cover: "upload:b" }] : [{ cover: "upload:c" }]));
    mocks.assets.updateMany.mockResolvedValueOnce({ count: 3 }).mockResolvedValueOnce({ count: 2 }).mockResolvedValueOnce({ count: 1 });
    expect(await collectUnusedCovers(now)).toEqual({ released: 1, started: 0, deleted: 0 });
    // 確認時刻を残して、次回は確認の古いものから巡回する。
    expect(mocks.assets.updateMany).toHaveBeenNthCalledWith(1, { where: { path: { in: ["a", "b", "c"] } }, data: { checkedAt: new Date(now) } });
    expect(mocks.assets.updateMany).toHaveBeenNthCalledWith(2, { where: { path: { in: ["a", "c"] }, releasedAt: null, deletingAt: null }, data: { releasedAt: new Date(now) } });
    expect(mocks.assets.updateMany).toHaveBeenNthCalledWith(3, { where: { path: { in: ["c"] }, deletingAt: null }, data: { releasedAt: null } });
    expect(mocks.assets.findMany.mock.calls[0][0]).toMatchObject({ orderBy: [{ checkedAt: { sort: "asc", nulls: "first" } }, { path: "asc" }] });
  });

  it("marks expired unused covers as deleting, keeps re-referenced ones, and removes rows only after the file is gone", async () => {
    assetQueries([], ["gone", "reused"], ["gone", "stuck"]);
    referencing(["reused"]);
    mocks.assets.updateMany.mockResolvedValue({ count: 1 });
    mocks.assets.deleteMany.mockResolvedValue({ count: 1 });
    mocks.remove.mockImplementation(async (path: string) => { if (path === "stuck") throw new Error("blob down"); });
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await collectUnusedCovers(now)).toEqual({ released: 0, started: 1, deleted: 1 });
    expect(mocks.assets.updateMany).toHaveBeenCalledWith({ where: { path: "reused", deletingAt: null }, data: { releasedAt: null } });
    expect(mocks.assets.updateMany).toHaveBeenCalledWith({ where: { path: "gone", releasedAt: { lt: cutoff }, deletingAt: null }, data: { deletingAt: new Date(now) } });
    expect(mocks.assets.deleteMany.mock.calls).toEqual([[{ where: { path: "gone", deletingAt: { not: null } } }]]);
  });

  it("refuses to attach a cover that is gone or being deleted", async () => {
    const tx = { noteCoverAsset: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) } };
    const cover = `upload:page-covers/mine/${uuid(1)}.jpg`;
    await expect(claimCover(tx as never, cover, "mine")).rejects.toThrow("no longer available");
    expect(tx.noteCoverAsset.updateMany).toHaveBeenCalledWith({ where: { path: cover.slice(7), userId: "mine", deletingAt: null }, data: { releasedAt: null } });
    await expect(claimCover(tx as never, "gradient-ocean", "mine")).resolves.toBeUndefined();
  });
});
