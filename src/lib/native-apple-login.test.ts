import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveAppleAccount } from "@/lib/native-apple-login";

const mocks = vi.hoisted(() => ({
  device: vi.fn(),
  tx: {
    $executeRaw: vi.fn(),
    deletedAccount: { findUnique: vi.fn() },
    user: { findUnique: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
  },
}));
vi.mock("@/lib/auth", () => ({ currentDeviceUser: mocks.device }));
vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: (work: (tx: typeof mocks.tx) => Promise<unknown>) => work(mocks.tx) },
}));

const identity = {
  appleSub: "apple-user",
  appleRefreshToken: "encrypted-test-token",
  appleAuthorizedAt: new Date(100_000),
  name: null,
  email: null,
};

describe("Apple sign-in and deletion", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.tx.deletedAccount.findUnique.mockResolvedValue({ deletedAt: new Date(100_500) });
    mocks.device.mockResolvedValue({ id: "anonymous" });
    mocks.tx.user.updateMany.mockResolvedValue({ count: 1 });
  });

  it("does not claim anonymous data if the account was deleted after this challenge began", async () => {
    expect(await saveAppleAccount(identity, 100_400)).toBe(false);
    expect(mocks.tx.$executeRaw).toHaveBeenCalledOnce();
    expect(mocks.device).not.toHaveBeenCalled();
    expect(mocks.tx.user.updateMany).not.toHaveBeenCalled();
  });

  it("allows a new challenge after deletion within the same second", async () => {
    expect(await saveAppleAccount(identity, 100_600)).toBe(true);
    expect(mocks.tx.user.updateMany).toHaveBeenCalledWith({
      where: { id: "anonymous", appleSub: null, googleSub: null, verifiedEmail: null },
      data: identity,
    });
  });
});
