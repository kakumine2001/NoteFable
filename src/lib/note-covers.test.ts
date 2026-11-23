import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ databaseSchema: "notefable", prisma: {} }));
vi.mock("@/lib/storage", () => ({}));
import { assertCoverOwner, claimCover, sniffCoverImage } from "./note-covers";

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

describe("claiming an uploaded cover", () => {
  it("refuses to attach a cover that is gone or being deleted", async () => {
    const tx = { storedFile: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) } };
    const cover = `upload:page-covers/mine/${uuid(1)}.jpg`;
    await expect(claimCover(tx as never, cover, "mine")).rejects.toThrow("no longer available");
    expect(tx.storedFile.updateMany).toHaveBeenCalledWith({ where: { path: cover.slice(7), userId: "mine", deletingAt: null }, data: { releasedAt: null } });
    await expect(claimCover(tx as never, `upload:page-covers/mine/${uuid(2)}.png`, "mine", "icon")).rejects.toThrow("icon image");
    await expect(claimCover(tx as never, "gradient-ocean", "mine")).resolves.toBeUndefined();
  });

  it("marks the cover in use when it is still there", async () => {
    const tx = { storedFile: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) } };
    await expect(claimCover(tx as never, `upload:page-covers/mine/${uuid(3)}.png`, "mine")).resolves.toBeUndefined();
  });
});
