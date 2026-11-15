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
}));
vi.mock("@/lib/env", () => ({ getCookieSecret: () => "secret" }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    attachment: { findMany: mocks.findMany },
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
  });

  it("deletes the row with deletion marks for each login, and leaves the files to cleanup", async () => {
    const { cleanup } = await deleteAccount({ id: "u1", googleSub: "g1", verifiedEmail: "a@example.com" });
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ message: { session: { userId: "u1" } } }) }));
    const google = deletedAccountKey({ kind: "google", sub: "g1" });
    const email = deletedAccountKey({ kind: "email", email: "a@example.com" });
    expect(mocks.transaction).toHaveBeenCalledWith(["codes", "usage", `mark:${google}`, `mark:${email}`, "purge", "user"]);
    expect(mocks.usage).toHaveBeenCalledWith({ where: { key: "user:u1" } });
    expect(mocks.userDelete).toHaveBeenCalledWith({ where: { id: "u1" } });
    expect(mocks.delImage).not.toHaveBeenCalled();

    expect(await cleanup()).toEqual([]);
    expect(mocks.delImage.mock.calls.map(([path]) => path)).toEqual(["images/2026/11/15/a.png"]);
    expect(mocks.delPrefix.mock.calls.map(([path]) => path)).toEqual(userStoragePrefixes("u1"));
  });

  it("reports leftovers when file removal fails", async () => {
    mocks.delPrefix.mockRejectedValueOnce(new Error("blob down"));
    const { cleanup } = await deleteAccount({ id: "u2", googleSub: null, verifiedEmail: null });
    expect(mocks.transaction).toHaveBeenCalledWith(["usage", "purge", "user"]);
    expect(await cleanup()).toEqual(["note-files/u2/"]);
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
  });
});
