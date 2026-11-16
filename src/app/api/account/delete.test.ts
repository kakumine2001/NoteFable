import { NextRequest } from "next/server";
import type * as NextServer from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ configured: vi.fn(), profile: vi.fn(), currentUser: vi.fn(), deleteAccount: vi.fn(), cleanup: vi.fn(), after: [] as (() => unknown)[], cancel: vi.fn(), cancelPlay: vi.fn(), billingRow: vi.fn() }));
vi.mock("next/server", async (load) => ({ ...(await load<typeof NextServer>()), after: (task: () => unknown) => { mocks.after.push(task); } }));
vi.mock("@/lib/google-auth", () => ({
  isGoogleLoginConfigured: mocks.configured,
  isAccountLoginConfigured: mocks.configured,
  isEmailLoginConfigured: () => true,
}));
vi.mock("@/lib/auth", () => ({
  getOrCreateUser: mocks.currentUser,
  isAccountUser: (user: { googleSub: string | null; verifiedEmail?: string | null }) => Boolean(user.googleSub || user.verifiedEmail),
  currentAccountProfile: mocks.profile,
}));
vi.mock("@/lib/account-deletion", () => ({ deleteAccount: mocks.deleteAccount }));
vi.mock("@/lib/billing", () => ({ cancelCustomerBilling: mocks.cancel, isBillingConfigured: () => true }));
vi.mock("@/lib/google-play-billing", () => ({ cancelPlayRenewal: mocks.cancelPlay }));
vi.mock("@/lib/subscription-state", () => ({ withUserBillingLock: (_id: string, work: (tx: unknown) => unknown) => work({ user: { findUnique: mocks.billingRow } }) }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/storage", () => ({ deleteStoredImage: vi.fn() }));
import { DELETE } from "./route";

const row = { id: "u1", googleSub: "sub-1", verifiedEmail: "a@example.com", avatarImage: null };
function request(headers: Record<string, string> = {}) {
  return new NextRequest("https://notefable.com/api/account", {
    method: "DELETE",
    headers: { host: "notefable.com", cookie: "__Secure-authjs.session-token=abc; __Secure-authjs.session-token.0=x; notefable_device=d.s; other=1", ...headers },
  });
}

describe("DELETE /api/account", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.configured.mockReturnValue(true);
    mocks.profile.mockResolvedValue({ name: "Mine", email: "a@example.com", image: null });
    mocks.currentUser.mockResolvedValue(row);
    mocks.cleanup.mockResolvedValue([]);
    mocks.deleteAccount.mockResolvedValue({ cleanup: mocks.cleanup });
    mocks.after.length = 0;
    mocks.billingRow.mockResolvedValue({ stripeCustomerId: null, googlePurchaseToken: null });
  });

  it("deletes the signed-in account, clears the sign-in cookies and removes files after responding", async () => {
    const response = await DELETE(request());
    // Stripe の顧客がいなければ Stripe には触れない。
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: true });
    expect(mocks.deleteAccount).toHaveBeenCalledWith(row, expect.anything());
    const cleared = response.cookies.getAll().filter((cookie) => cookie.maxAge === 0).map((cookie) => cookie.name).sort();
    // 端末の Cookie は残す（別の匿名の行を指していることがある）。
    expect(cleared).toEqual(["__Secure-authjs.session-token", "__Secure-authjs.session-token.0"]);
    expect(mocks.cleanup).not.toHaveBeenCalled();
    expect(mocks.after).toHaveLength(1);
    await mocks.after[0]();
    expect(mocks.cleanup).toHaveBeenCalledTimes(1);
  });

  it("accepts the native app, which sends no Origin, but rejects other sites", async () => {
    expect((await DELETE(request({ origin: "https://evil.example" }))).status).toBe(403);
    expect(mocks.deleteAccount).not.toHaveBeenCalled();
    expect((await DELETE(request({ origin: "https://notefable.com" }))).status).toBe(200);
  });

  it("refuses when nobody is signed in or the row is anonymous", async () => {
    mocks.profile.mockResolvedValueOnce(null);
    expect((await DELETE(request())).status).toBe(401);
    mocks.currentUser.mockResolvedValueOnce({ ...row, googleSub: null, verifiedEmail: null });
    expect((await DELETE(request())).status).toBe(401);
    expect(mocks.deleteAccount).not.toHaveBeenCalled();
  });

  it("stops Stripe billing first and keeps the account when that fails", async () => {
    const subscribed = { ...row, stripeCustomerId: "cus_1", stripeSubscriptionId: null, subscriptionStatus: null };
    mocks.currentUser.mockResolvedValue(subscribed);
    // 行はロックの中で読み直す。
    mocks.billingRow.mockResolvedValue({ stripeCustomerId: "cus_1", googlePurchaseToken: "tok" });
    mocks.cancel.mockRejectedValueOnce(new Error("stripe down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await DELETE(request())).status).toBe(502);
    expect(mocks.deleteAccount).not.toHaveBeenCalled();
    mocks.cancel.mockResolvedValueOnce(undefined);
    expect((await DELETE(request())).status).toBe(200);
    expect(mocks.cancel).toHaveBeenLastCalledWith("cus_1");
    expect(mocks.cancelPlay).toHaveBeenLastCalledWith("tok");
    expect(mocks.deleteAccount).toHaveBeenCalledWith(subscribed, expect.anything());
  });

  it("is unavailable when sign-in is off", async () => {
    mocks.configured.mockReturnValue(false);
    expect((await DELETE(request())).status).toBe(404);
  });
});
