import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  transaction: vi.fn(),
  codes: vi.fn(),
  usage: vi.fn(),
  userDelete: vi.fn(),
  delImage: vi.fn(),
  delPrefix: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    attachment: { findMany: mocks.findMany },
    emailLoginCode: { deleteMany: mocks.codes },
    usageCounter: { deleteMany: mocks.usage },
    user: { delete: mocks.userDelete },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/storage", () => ({ deleteStoredImage: mocks.delImage, deleteStoredPrefix: mocks.delPrefix }));
import { deleteAccount, userStoragePrefixes } from "./account-deletion";

describe("deleteAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findMany.mockResolvedValue([{ imageStoragePath: "images/2026/11/15/a.png" }, { imageStoragePath: "images/2026/11/15/a.png" }]);
    mocks.transaction.mockResolvedValue([]);
    mocks.codes.mockReturnValue("codes");
    mocks.usage.mockReturnValue("usage");
    mocks.userDelete.mockReturnValue("user");
    mocks.delImage.mockResolvedValue(undefined);
    mocks.delPrefix.mockResolvedValue(undefined);
  });

  it("deletes the user row, then the user's chat images, photo and folders", async () => {
    const result = await deleteAccount({ id: "u1", verifiedEmail: "a@example.com", avatarImage: "avatars/u1/p.png" });
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ message: { session: { userId: "u1" } } }) }));
    expect(mocks.transaction).toHaveBeenCalledWith(["codes", "usage", "user"]);
    expect(mocks.codes).toHaveBeenCalledWith({ where: { email: "a@example.com" } });
    expect(mocks.usage).toHaveBeenCalledWith({ where: { key: "user:u1" } });
    expect(mocks.userDelete).toHaveBeenCalledWith({ where: { id: "u1" } });
    expect(mocks.delImage.mock.calls.map(([path]) => path).sort()).toEqual(["avatars/u1/p.png", "images/2026/11/15/a.png"]);
    expect(mocks.delPrefix.mock.calls.map(([path]) => path)).toEqual(userStoragePrefixes("u1"));
    expect(result.failed).toEqual([]);
  });

  it("keeps the deletion when file removal fails and reports the leftovers", async () => {
    mocks.delPrefix.mockRejectedValueOnce(new Error("blob down"));
    const result = await deleteAccount({ id: "u2", verifiedEmail: null, avatarImage: null });
    expect(mocks.transaction).toHaveBeenCalledWith(["usage", "user"]);
    expect(result.failed).toEqual(["note-files/u2/"]);
  });

  it("does not touch files when the row deletion fails", async () => {
    mocks.transaction.mockRejectedValueOnce(new Error("db down"));
    await expect(deleteAccount({ id: "u3", verifiedEmail: null, avatarImage: null })).rejects.toThrow("db down");
    expect(mocks.delImage).not.toHaveBeenCalled();
    expect(mocks.delPrefix).not.toHaveBeenCalled();
  });

  it("only uses per-user folders that end with a slash", () => {
    for (const prefix of userStoragePrefixes("u9")) expect(prefix).toMatch(/\/u9\/$/);
  });
});
