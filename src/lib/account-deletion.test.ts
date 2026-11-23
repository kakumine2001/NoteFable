import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  transaction: vi.fn(),
  codes: vi.fn(),
  usage: vi.fn(),
  upsert: vi.fn(),
  purge: vi.fn(),
  userDelete: vi.fn(),
  delImage: vi.fn(),
  delPrefix: vi.fn(),
  storedFind: vi.fn(),
  storedMark: vi.fn(),
  storedDelete: vi.fn(),
}));
vi.mock("@/lib/env", () => ({ getCookieSecret: () => "secret" }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    attachment: { findMany: mocks.findMany },
    storedFile: { findMany: mocks.storedFind, updateMany: mocks.storedMark, deleteMany: mocks.storedDelete },
    emailLoginCode: { deleteMany: mocks.codes },
    usageCounter: { deleteMany: mocks.usage },
    deletedAccount: { upsert: mocks.upsert, deleteMany: mocks.purge },
    user: { delete: mocks.userDelete },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/storage", () => ({ deleteStoredImage: mocks.delImage, deleteStoredPrefix: mocks.delPrefix }));
import { deleteAccount, userStoragePrefixes } from "./account-deletion";
import { deletedAccountKey } from "./deleted-accounts";

describe("deleteAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findMany.mockResolvedValue([{ imageStoragePath: "images/2026/11/15/a.png" }, { imageStoragePath: "images/2026/11/15/a.png" }]);
    mocks.transaction.mockResolvedValue([]);
    mocks.codes.mockReturnValue("codes");
    mocks.usage.mockReturnValue("usage");
    mocks.upsert.mockImplementation(({ where }: { where: { key: string } }) => `mark:${where.key}`);
    mocks.purge.mockReturnValue("purge");
    mocks.userDelete.mockReturnValue("user");
    mocks.delImage.mockResolvedValue(undefined);
    mocks.delPrefix.mockResolvedValue(undefined);
    mocks.storedFind.mockResolvedValue([{ path: "note-files/u1/f.png" }, { path: "images/2026/11/15/a.png" }]);
    mocks.storedMark.mockReturnValue("stored");
    mocks.storedDelete.mockResolvedValue({ count: 2 });
  });

  it("deletes the row with deletion marks for each login, and leaves the files to cleanup", async () => {
    const { cleanup } = await deleteAccount({ id: "u1", googleSub: "g1", verifiedEmail: "a@example.com" });
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ message: { session: { userId: "u1" } } }) }));
    const google = deletedAccountKey({ kind: "google", sub: "g1" });
    const email = deletedAccountKey({ kind: "email", email: "a@example.com" });
    expect(mocks.transaction).toHaveBeenCalledWith(["stored", "codes", "usage", `mark:${google}`, `mark:${email}`, "purge", "user"]);
    // Tracked files are marked for deletion and kept, so the cleanup can retry what fails.
    expect(mocks.storedMark).toHaveBeenCalledWith({ where: { userId: "u1", deletingAt: null }, data: { releasedAt: expect.any(Date), deletingAt: expect.any(Date) } });
    expect(mocks.usage).toHaveBeenCalledWith({ where: { key: "user:u1" } });
    expect(mocks.userDelete).toHaveBeenCalledWith({ where: { id: "u1" } });
    expect(mocks.delImage).not.toHaveBeenCalled();

    expect(await cleanup()).toEqual([]);
    expect(mocks.delImage.mock.calls.map(([path]) => path).sort()).toEqual(["images/2026/11/15/a.png", "note-files/u1/f.png"]);
    expect(mocks.delPrefix.mock.calls.map(([path]) => path)).toEqual(userStoragePrefixes("u1"));
    // Only the rows of files that are gone are removed.
    expect(mocks.storedDelete).toHaveBeenCalledWith({ where: { path: { in: expect.arrayContaining(["images/2026/11/15/a.png", "note-files/u1/f.png"]) }, deletingAt: { not: null } } });
  });

  it("keeps the rows of files it could not delete for the cleanup to retry", async () => {
    mocks.delImage.mockImplementation(async (path: string) => { if (path === "note-files/u1/f.png") throw new Error("blob down"); });
    const { cleanup } = await deleteAccount({ id: "u1", googleSub: "g1", verifiedEmail: null });
    expect(await cleanup()).toEqual(["note-files/u1/f.png"]);
    expect(mocks.storedDelete).toHaveBeenCalledWith({ where: { path: { in: ["images/2026/11/15/a.png"] }, deletingAt: { not: null } } });
  });

  it("reports leftovers when file removal fails", async () => {
    mocks.delPrefix.mockRejectedValueOnce(new Error("blob down"));
    const { cleanup } = await deleteAccount({ id: "u2", googleSub: null, verifiedEmail: null });
    expect(mocks.transaction).toHaveBeenCalledWith(["stored", "usage", "purge", "user"]);
    expect(await cleanup()).toEqual(["note-files/u2/"]);
  });

  it("deletes step by step on the given transaction instead of opening another", async () => {
    const tx = {
      attachment: { findMany: mocks.findMany },
      storedFile: { findMany: mocks.storedFind, updateMany: mocks.storedMark },
      emailLoginCode: { deleteMany: mocks.codes },
      usageCounter: { deleteMany: mocks.usage },
      deletedAccount: { upsert: mocks.upsert, deleteMany: mocks.purge },
      user: { delete: mocks.userDelete },
    };
    await deleteAccount({ id: "u4", googleSub: null, verifiedEmail: "b@example.com" }, tx as never);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.codes).toHaveBeenCalledWith({ where: { email: "b@example.com" } });
    expect(mocks.userDelete).toHaveBeenCalledWith({ where: { id: "u4" } });
  });

  it("does not return a cleanup when the row deletion fails", async () => {
    mocks.transaction.mockRejectedValueOnce(new Error("db down"));
    await expect(deleteAccount({ id: "u3", googleSub: "g3", verifiedEmail: null })).rejects.toThrow("db down");
    expect(mocks.delImage).not.toHaveBeenCalled();
    expect(mocks.delPrefix).not.toHaveBeenCalled();
  });

  it("only uses per-user folders that end with a slash, including chat uploads", () => {
    const prefixes = userStoragePrefixes("u9");
    for (const prefix of prefixes) expect(prefix).toMatch(/\/u9\/$/);
    expect(prefixes).toContain("chat-uploads/u9/");
    expect(prefixes).toContain("app-icons/u9/");
  });
});
