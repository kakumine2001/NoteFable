import { Status } from "@apple/app-store-server-library";
import { describe, expect, it, vi } from "vitest";
import { applePlanStatus } from "@/lib/apple-app-store";
import { subscriptionAction } from "@/lib/subscription-state";
import { usageTier } from "@/lib/usage-limits";

vi.mock("@/lib/prisma", () => ({ prisma: {}, databaseSchema: "public" }));

const end = new Date("2026-12-01T00:00:00Z");

describe("App Store entitlement", () => {
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
