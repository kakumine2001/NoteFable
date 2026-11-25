import { Environment, Status } from "@apple/app-store-server-library";
import { describe, expect, it, vi } from "vitest";
import { applePlanStatus, appleStoreEnvironment, prepareApplePurchase, releaseApplePurchase } from "@/lib/apple-app-store";
import { subscriptionAction } from "@/lib/subscription-state";
import { usageTier } from "@/lib/usage-limits";

vi.mock("@/lib/prisma", () => ({ prisma: {}, databaseSchema: "public" }));

const user = vi.hoisted(() => ({ findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() }));
vi.mock("@/lib/subscription-state", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/subscription-state")>(),
  withUserBillingLock: async (_id: string, run: (tx: { user: typeof user }) => Promise<unknown>) => run({ user }),
}));

const end = new Date("2026-12-01T00:00:00Z");

describe("App Store entitlement", () => {
  it("keeps sandbox receipts scoped to an explicitly configured review account", () => {
    vi.stubEnv("APP_STORE_SANDBOX_REVIEW_USER_IDS", "review-a, review-b");
    try {
      expect(appleStoreEnvironment("review-b")).toBe(Environment.SANDBOX);
      expect(appleStoreEnvironment("ordinary-user")).toBe(Environment.PRODUCTION);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("reserves one Apple checkout and only releases the matching reservation", async () => {
    const accountToken = "be5a8eb3-eed9-43bf-b63a-f719539a6c09";
    user.findUnique.mockResolvedValueOnce({ plan: "FREE", appleAppAccountToken: accountToken });
    const prepared = await prepareApplePurchase("owner");
    expect(prepared).toEqual({ token: accountToken, reservation: expect.any(String) });
    if (!prepared || !("reservation" in prepared) || !prepared.reservation) throw new Error("Missing reservation");
    const reservation = new Date(prepared.reservation);
    expect(reservation.getTime()).toBeGreaterThan(Date.now() + 24 * 60 * 60 * 1000);
    user.findUnique.mockResolvedValueOnce({ plan: "FREE", appleAppAccountToken: accountToken, applePurchaseHoldUntil: reservation });
    expect(await prepareApplePurchase("owner")).toEqual({ pending: true });
    await releaseApplePurchase("owner", reservation);
    expect(user.updateMany).toHaveBeenCalledWith({
      where: { id: "owner", applePurchaseHoldUntil: reservation },
      data: { applePurchaseHoldUntil: null },
    });
  });

  it("gives access during a paid or grace period, but not after expiry", () => {
    expect(applePlanStatus(Status.ACTIVE, end, end.getTime() - 1)).toBe("active");
    expect(applePlanStatus(Status.BILLING_GRACE_PERIOD, end, end.getTime() - 1)).toBe("past_due");
    expect(applePlanStatus(Status.BILLING_RETRY, end, end.getTime() - 1)).toBe("canceled");
    expect(applePlanStatus(Status.REVOKED, end, end.getTime() - 1)).toBe("canceled");
    expect(applePlanStatus(Status.ACTIVE, end, end.getTime())).toBe("canceled");
  });

  it("limits Apple-backed Pro to the verified period if notifications are delayed", () => {
    const user = { plan: "PRO", googleSub: null, appleSub: "sub", subscriptionProvider: "apple", subscriptionPeriodEnd: end };
    expect(usageTier(user, end.getTime() - 1)).toBe("pro");
    expect(usageTier(user, end.getTime())).toBe("member");
    expect(usageTier({ ...user, subscriptionProvider: "stripe" }, end.getTime())).toBe("pro");
  });

  it("ignores an Apple expiration while another provider owns the active subscription", () => {
    const owner = { id: "owner", subscriptionProvider: "stripe", subscriptionStatus: "active", stripeSubscriptionId: "stripe", googlePurchaseToken: null };
    const update = { provider: "apple" as const, appleOriginalTransactionId: "apple", status: "canceled", periodStart: null, periodEnd: end, cancelAt: null };
    expect(subscriptionAction(owner, update)).toBe("stale");
    expect(subscriptionAction(owner, { ...update, status: "active" })).toBe("duplicate");
  });
});
