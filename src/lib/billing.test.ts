import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  retrieve: vi.fn(), list: vi.fn(), cancel: vi.fn(), customersCreate: vi.fn(),
  sessionsList: vi.fn(), sessionsExpire: vi.fn(), sessionsCreate: vi.fn(),
  findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn(), updateMany: vi.fn(),
}));
vi.mock("stripe", async (load) => {
  const actual = await load<typeof import("stripe")>();
  class FakeStripe {
    subscriptions = { retrieve: mocks.retrieve, list: mocks.list, cancel: mocks.cancel };
    customers = { create: mocks.customersCreate };
    checkout = { sessions: { list: mocks.sessionsList, expire: mocks.sessionsExpire, create: mocks.sessionsCreate } };
    static errors = actual.default.errors;
  }
  return { default: FakeStripe };
});
vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique: mocks.findUnique, findUniqueOrThrow: mocks.findUniqueOrThrow, update: mocks.update, updateMany: mocks.updateMany } },
}));
import { AlreadySubscribedError, cancelCustomerBilling, createCheckoutUrl, ensureCustomer, isBillingConfigured, isWebhookConfigured, refreshCustomer, syncSubscription } from "./billing";

function subscription(id: string, status: string, extra: Record<string, unknown> = {}) {
  return {
    id, status, customer: "cus_1", cancel_at_period_end: false, cancel_at: null, metadata: { userId: "u1" },
    items: { data: [{ current_period_start: 1_763_600_000, current_period_end: 1_766_200_000 }] },
    ...extra,
  };
}

const owner = { id: "u1", stripeCustomerId: "cus_1", stripeSubscriptionId: null, subscriptionStatus: null };

describe("billing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x");
    vi.stubEnv("STRIPE_PRICE_ID", "price_x");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_x");
    mocks.update.mockResolvedValue({});
    mocks.sessionsList.mockResolvedValue({ data: [] });
    mocks.sessionsExpire.mockResolvedValue({});
  });

  it("offers sign-ups only with a price, but keeps the webhook on without one", () => {
    expect(isBillingConfigured()).toBe(true);
    vi.stubEnv("STRIPE_PRICE_ID", "");
    expect(isBillingConfigured()).toBe(false);
    expect(isWebhookConfigured()).toBe(true);
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    expect(isWebhookConfigured()).toBe(false);
  });

  it("turns Pro on for an active subscription and copies its period", async () => {
    mocks.retrieve.mockResolvedValue(subscription("sub_1", "active"));
    mocks.findUnique.mockResolvedValue({ id: "u1", stripeSubscriptionId: null, subscriptionStatus: null });
    await expect(syncSubscription("sub_1")).resolves.toBe("u1");
    expect(mocks.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { stripeCustomerId: "cus_1" } }));
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: {
        stripeSubscriptionId: "sub_1", subscriptionStatus: "active", plan: "PRO", subscriptionCancelAt: null,
        subscriptionPeriodStart: new Date(1_763_600_000_000), subscriptionPeriodEnd: new Date(1_766_200_000_000),
      },
    });
  });

  it("keeps Pro through payment retries and a scheduled cancellation, then turns it off", async () => {
    mocks.findUnique.mockResolvedValue({ id: "u1", stripeSubscriptionId: "sub_1", subscriptionStatus: "active" });
    mocks.retrieve.mockResolvedValueOnce(subscription("sub_1", "past_due"));
    await syncSubscription("sub_1");
    expect(mocks.update.mock.calls[0][0].data).toMatchObject({ plan: "PRO", subscriptionStatus: "past_due" });
    mocks.retrieve.mockResolvedValueOnce(subscription("sub_1", "active", { cancel_at_period_end: true }));
    await syncSubscription("sub_1");
    expect(mocks.update.mock.calls[1][0].data).toMatchObject({ plan: "PRO", subscriptionCancelAt: new Date(1_766_200_000_000) });
    // cancel_at があればその日時（期間の終わりと違うことがある）。
    mocks.retrieve.mockResolvedValueOnce(subscription("sub_1", "active", { cancel_at: 1_765_000_000 }));
    await syncSubscription("sub_1");
    expect(mocks.update.mock.calls[2][0].data).toMatchObject({ subscriptionCancelAt: new Date(1_765_000_000_000) });
    mocks.retrieve.mockResolvedValueOnce(subscription("sub_1", "canceled"));
    await syncSubscription("sub_1");
    expect(mocks.update.mock.calls[3][0].data).toMatchObject({ plan: "FREE", subscriptionStatus: "canceled" });
  });

  it("does not let a late notice about an old subscription end a newer one", async () => {
    mocks.findUnique.mockResolvedValue({ id: "u1", stripeSubscriptionId: "sub_new", subscriptionStatus: "active" });
    mocks.retrieve.mockResolvedValue(subscription("sub_old", "canceled"));
    await syncSubscription("sub_old");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("cancels a live NoteFable subscription whose account is gone, and leaves other customers alone", async () => {
    mocks.findUnique.mockResolvedValue(null);
    mocks.retrieve.mockResolvedValueOnce(subscription("sub_1", "active"));
    await expect(syncSubscription("sub_1")).resolves.toBeNull();
    expect(mocks.cancel).toHaveBeenCalledWith("sub_1");
    mocks.cancel.mockClear();
    mocks.retrieve.mockResolvedValueOnce(subscription("sub_2", "active", { metadata: {} }));
    await syncSubscription("sub_2");
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("prefers a live subscription when refreshing after checkout, without fetching it again", async () => {
    mocks.list.mockResolvedValue({ data: [subscription("sub_old", "canceled"), subscription("sub_new", "active")] });
    mocks.findUnique.mockResolvedValue({ id: "u1", stripeSubscriptionId: "sub_old", subscriptionStatus: "canceled" });
    await refreshCustomer({ ...owner, stripeSubscriptionId: "sub_old", subscriptionStatus: "canceled" });
    expect(mocks.retrieve).not.toHaveBeenCalled();
    expect(mocks.update.mock.calls[0][0].data).toMatchObject({ stripeSubscriptionId: "sub_new", plan: "PRO" });
  });

  it("refuses a second subscription found on Stripe and closes old checkout pages before opening a new one", async () => {
    mocks.list.mockResolvedValueOnce({ data: [subscription("sub_1", "incomplete")] });
    mocks.findUnique.mockResolvedValue({ id: "u1", stripeSubscriptionId: null, subscriptionStatus: null });
    await expect(createCheckoutUrl(owner, "https://notefable.com")).rejects.toBeInstanceOf(AlreadySubscribedError);
    expect(mocks.sessionsCreate).not.toHaveBeenCalled();

    mocks.list.mockResolvedValueOnce({ data: [subscription("sub_0", "canceled")] });
    mocks.sessionsList.mockResolvedValueOnce({ data: [{ id: "cs_old" }] });
    mocks.sessionsCreate.mockResolvedValueOnce({ url: "https://checkout.stripe.com/x" });
    await expect(createCheckoutUrl(owner, "https://notefable.com")).resolves.toBe("https://checkout.stripe.com/x");
    expect(mocks.sessionsExpire).toHaveBeenCalledWith("cs_old");
    expect(mocks.sessionsExpire.mock.invocationCallOrder[0]).toBeLessThan(mocks.sessionsCreate.mock.invocationCallOrder[0]);
    expect(mocks.sessionsCreate.mock.calls[0][0]).toMatchObject({
      mode: "subscription", customer: "cus_1", line_items: [{ price: "price_x", quantity: 1 }],
      success_url: "https://notefable.com/app?billing=success", subscription_data: { metadata: { userId: "u1" } },
    });
  });

  it("creates one customer even when two requests race", async () => {
    mocks.customersCreate.mockResolvedValue({ id: "cus_new" });
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });
    mocks.findUniqueOrThrow.mockResolvedValue({ stripeCustomerId: "cus_winner" });
    const user = { ...owner, stripeCustomerId: null, verifiedEmail: "a@example.com" };
    await expect(ensureCustomer(user)).resolves.toBe("cus_winner");
    expect(mocks.customersCreate).toHaveBeenCalledWith(
      { email: "a@example.com", metadata: { userId: "u1" } }, { idempotencyKey: "notefable-customer-u1" });
    expect(mocks.updateMany).toHaveBeenCalledWith({ where: { id: "u1", stripeCustomerId: null }, data: { stripeCustomerId: "cus_new" } });
  });

  it("stops every live subscription and open checkout before account deletion", async () => {
    mocks.sessionsList.mockResolvedValue({ data: [{ id: "cs_open" }] });
    mocks.list.mockResolvedValue({ data: [
      subscription("sub_live", "active"), subscription("sub_unpaid", "unpaid"), subscription("sub_done", "canceled"),
    ] });
    mocks.cancel.mockResolvedValue({});
    await cancelCustomerBilling(owner);
    expect(mocks.sessionsExpire).toHaveBeenCalledWith("cs_open");
    expect(mocks.cancel.mock.calls).toEqual([["sub_live"], ["sub_unpaid"]]);
  });

  it("treats a subscription that ended meanwhile as cancelled, and fails when one is still live", async () => {
    mocks.list.mockResolvedValue({ data: [subscription("sub_1", "active")] });
    mocks.cancel.mockRejectedValueOnce(new Error("network"));
    mocks.retrieve.mockResolvedValueOnce(subscription("sub_1", "canceled"));
    await expect(cancelCustomerBilling(owner)).resolves.toBeUndefined();

    mocks.cancel.mockRejectedValueOnce(new Error("network"));
    mocks.retrieve.mockResolvedValueOnce(subscription("sub_1", "active"));
    await expect(cancelCustomerBilling(owner)).rejects.toThrow("network");

    mocks.list.mockClear();
    await cancelCustomerBilling({ stripeCustomerId: null });
    expect(mocks.list).not.toHaveBeenCalled();
  });
});
