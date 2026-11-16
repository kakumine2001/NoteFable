import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  retrieve: vi.fn(), list: vi.fn(), cancel: vi.fn(), customersCreate: vi.fn(),
  sessionsList: vi.fn(), sessionsExpire: vi.fn(), sessionsCreate: vi.fn(), sessionsRetrieve: vi.fn(), invoicePayments: vi.fn(), refund: vi.fn(),
  findUnique: vi.fn(), update: vi.fn(), locks: [] as string[],
}));
vi.mock("stripe", async (load) => {
  const actual = await load<typeof import("stripe")>();
  class FakeStripe {
    subscriptions = { retrieve: mocks.retrieve, list: mocks.list, cancel: mocks.cancel };
    customers = { create: mocks.customersCreate };
    invoicePayments = { list: mocks.invoicePayments };
    refunds = { create: mocks.refund };
    checkout = { sessions: { list: mocks.sessionsList, expire: mocks.sessionsExpire, create: mocks.sessionsCreate, retrieve: mocks.sessionsRetrieve } };
    static errors = actual.default.errors;
  }
  return { default: FakeStripe };
});
vi.mock("@/lib/prisma", () => {
  const user = { findUnique: mocks.findUnique, update: mocks.update };
  return {
    prisma: {
      user,
      // withUserBillingLock: ロックの鍵を記録して、同じ user を持つ tx で実行する。
      $transaction: async (work: (tx: unknown) => unknown) => work({ user, $executeRaw: (query: { values: unknown[] }) => { mocks.locks.push(String(query.values[0])); } }),
    },
  };
});
import { AccountGoneError, AlreadySubscribedError, cancelCustomerBilling, createCheckoutUrl, isBillingConfigured, isWebhookConfigured, refreshCustomer, syncSubscription } from "./billing";

function subscription(id: string, status: string, extra: Record<string, unknown> = {}) {
  return {
    id, status, customer: "cus_1", cancel_at_period_end: false, cancel_at: null, metadata: { userId: "u1" },
    items: { data: [{ current_period_start: 1_763_600_000, current_period_end: 1_766_200_000 }] },
    ...extra,
  };
}

const owner = (extra: Record<string, unknown> = {}) => ({
  id: "u1", subscriptionProvider: null, subscriptionStatus: null, stripeSubscriptionId: null, googlePurchaseToken: null, ...extra,
});
const LOCK = "notefable-billing:user:u1";

describe("billing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUnique.mockReset();
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x");
    vi.stubEnv("STRIPE_PRICE_ID", "price_x");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_x");
    mocks.update.mockResolvedValue({});
    mocks.sessionsList.mockResolvedValue({ data: [] });
    mocks.sessionsExpire.mockResolvedValue({});
    mocks.locks.length = 0;
  });

  it("offers sign-ups only with a price, but keeps the webhook on without one", () => {
    expect(isBillingConfigured()).toBe(true);
    vi.stubEnv("STRIPE_PRICE_ID", "");
    expect(isBillingConfigured()).toBe(false);
    expect(isWebhookConfigured()).toBe(true);
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    expect(isWebhookConfigured()).toBe(false);
  });

  it("turns Pro on for an active subscription under the user's lock, re-reading it after locking", async () => {
    mocks.retrieve.mockResolvedValue(subscription("sub_1", "active"));
    mocks.findUnique.mockResolvedValueOnce({ id: "u1" }).mockResolvedValueOnce(owner());
    await expect(syncSubscription("sub_1")).resolves.toBe("u1");
    expect(mocks.findUnique.mock.calls[0][0].where).toEqual({ stripeCustomerId: "cus_1" });
    expect(mocks.retrieve).toHaveBeenCalledTimes(2);
    expect(mocks.locks).toEqual([LOCK]);
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: {
        subscriptionProvider: "stripe", stripeSubscriptionId: "sub_1", subscriptionStatus: "active", plan: "PRO", subscriptionCancelAt: null,
        subscriptionPeriodStart: new Date(1_763_600_000_000), subscriptionPeriodEnd: new Date(1_766_200_000_000),
      },
    });
  });

  it("keeps Pro through payment retries and a scheduled cancellation, then turns it off", async () => {
    const current = owner({ subscriptionProvider: "stripe", stripeSubscriptionId: "sub_1", subscriptionStatus: "active" });
    mocks.findUnique.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => ("stripeCustomerId" in where ? { id: "u1" } : current));
    const run = async (sub: ReturnType<typeof subscription>) => {
      mocks.retrieve.mockResolvedValue(sub);
      await syncSubscription("sub_1");
      return mocks.update.mock.lastCall![0].data;
    };
    expect(await run(subscription("sub_1", "past_due"))).toMatchObject({ plan: "PRO", subscriptionStatus: "past_due" });
    expect(await run(subscription("sub_1", "active", { cancel_at_period_end: true }))).toMatchObject({ plan: "PRO", subscriptionCancelAt: new Date(1_766_200_000_000) });
    // cancel_at があればその日時（期間の終わりと違うことがある）。
    expect(await run(subscription("sub_1", "active", { cancel_at: 1_765_000_000 }))).toMatchObject({ subscriptionCancelAt: new Date(1_765_000_000_000) });
    expect(await run(subscription("sub_1", "canceled"))).toMatchObject({ plan: "FREE", subscriptionStatus: "canceled" });
  });

  it("ignores a late notice about an old subscription and stops a duplicate one while another is Pro", async () => {
    mocks.findUnique.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => ("stripeCustomerId" in where
      ? { id: "u1" } : owner({ subscriptionProvider: "google", googlePurchaseToken: "tok", subscriptionStatus: "active" })));
    mocks.retrieve.mockResolvedValue(subscription("sub_old", "canceled"));
    await syncSubscription("sub_old");
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.cancel).not.toHaveBeenCalled();
    // 2 つ目の購読は取り消して、支払われた請求を返金する（冪等キー付き）。
    mocks.retrieve.mockResolvedValue(subscription("sub_dup", "active", { latest_invoice: "in_1" }));
    mocks.cancel.mockResolvedValue({});
    mocks.invoicePayments.mockResolvedValue({ data: [
      { id: "inpay_1", status: "paid", payment: { type: "payment_intent", payment_intent: "pi_1" } },
      { id: "inpay_2", status: "open", payment: { type: "payment_intent", payment_intent: "pi_2" } },
    ] });
    mocks.refund.mockResolvedValue({});
    await syncSubscription("sub_dup");
    expect(mocks.cancel).toHaveBeenCalledWith("sub_dup");
    expect(mocks.invoicePayments).toHaveBeenCalledWith({ invoice: "in_1", limit: 10 });
    expect(mocks.refund).toHaveBeenCalledExactlyOnceWith(
      { payment_intent: "pi_1", reason: "duplicate", metadata: { subscription: "sub_dup" } }, { idempotencyKey: "notefable-duplicate-refund-inpay_1" });
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

  it("prefers a live subscription when refreshing after checkout", async () => {
    mocks.list.mockResolvedValue({ data: [subscription("sub_old", "canceled"), subscription("sub_new", "active")] });
    mocks.findUnique.mockResolvedValue(owner({ subscriptionProvider: "stripe", stripeSubscriptionId: "sub_old", subscriptionStatus: "canceled" }));
    await refreshCustomer({ id: "u1", stripeCustomerId: "cus_1" });
    expect(mocks.locks).toEqual([LOCK]);
    expect(mocks.update.mock.calls[0][0].data).toMatchObject({ stripeSubscriptionId: "sub_new", plan: "PRO" });
  });

  it("opens one checkout per user: closes old pages first, then refuses when Stripe already has a live subscription", async () => {
    mocks.findUnique.mockResolvedValue({ ...owner(), stripeCustomerId: "cus_1", verifiedEmail: "a@example.com", email: null });
    mocks.sessionsList.mockResolvedValue({ data: [{ id: "cs_old" }] });
    mocks.list.mockResolvedValueOnce({ data: [subscription("sub_1", "incomplete")] });
    await expect(createCheckoutUrl("u1", "https://notefable.com")).rejects.toBeInstanceOf(AlreadySubscribedError);
    // 見つけた購読は、断る前に（ロックのトランザクションが終わる前に投げずに）行へ写している。
    expect(mocks.update.mock.calls[0][0].data).toMatchObject({ stripeSubscriptionId: "sub_1", subscriptionStatus: "incomplete" });
    expect(mocks.sessionsExpire.mock.invocationCallOrder[0]).toBeLessThan(mocks.list.mock.invocationCallOrder[0]);
    expect(mocks.sessionsCreate).not.toHaveBeenCalled();

    mocks.list.mockResolvedValueOnce({ data: [subscription("sub_0", "canceled")] });
    mocks.sessionsCreate.mockResolvedValueOnce({ url: "https://checkout.stripe.com/x" });
    await expect(createCheckoutUrl("u1", "https://notefable.com")).resolves.toBe("https://checkout.stripe.com/x");
    expect(mocks.locks).toEqual([LOCK, LOCK]);
    expect(mocks.sessionsCreate.mock.calls[0][0]).toMatchObject({
      mode: "subscription", customer: "cus_1", line_items: [{ price: "price_x", quantity: 1 }],
      success_url: "https://notefable.com/app?billing=success", subscription_data: { metadata: { userId: "u1" } },
    });
  });

  it("refuses checkout when the row is already Pro or was deleted meanwhile, and creates the customer once", async () => {
    mocks.findUnique.mockResolvedValueOnce({ ...owner({ subscriptionStatus: "active" }), stripeCustomerId: "cus_1" });
    await expect(createCheckoutUrl("u1", "https://x")).rejects.toBeInstanceOf(AlreadySubscribedError);
    mocks.findUnique.mockResolvedValueOnce(null);
    await expect(createCheckoutUrl("u1", "https://x")).rejects.toBeInstanceOf(AccountGoneError);

    mocks.findUnique.mockResolvedValue({ ...owner(), stripeCustomerId: null, verifiedEmail: "a@example.com", email: null });
    mocks.customersCreate.mockResolvedValue({ id: "cus_new" });
    mocks.list.mockResolvedValue({ data: [] });
    mocks.sessionsCreate.mockResolvedValue({ url: "https://checkout.stripe.com/y" });
    await createCheckoutUrl("u1", "https://x");
    expect(mocks.customersCreate).toHaveBeenCalledWith({ email: "a@example.com", metadata: { userId: "u1" } }, { idempotencyKey: "notefable-customer-u1" });
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "u1" }, data: { stripeCustomerId: "cus_new" } });
  });

  it("stops every live subscription and open checkout before account deletion", async () => {
    mocks.sessionsList.mockResolvedValue({ data: [{ id: "cs_open" }] });
    mocks.list.mockResolvedValue({ data: [
      subscription("sub_live", "active"), subscription("sub_unpaid", "unpaid"), subscription("sub_done", "canceled"),
    ] });
    mocks.cancel.mockResolvedValue({});
    await cancelCustomerBilling("cus_1");
    expect(mocks.sessionsExpire).toHaveBeenCalledWith("cs_open");
    expect(mocks.cancel.mock.calls).toEqual([["sub_live"], ["sub_unpaid"]]);
  });

  it("treats a subscription that ended meanwhile as cancelled, and fails when one is still live", async () => {
    mocks.list.mockResolvedValue({ data: [subscription("sub_1", "active")] });
    mocks.cancel.mockRejectedValueOnce(new Error("network"));
    mocks.retrieve.mockResolvedValueOnce(subscription("sub_1", "canceled"));
    await expect(cancelCustomerBilling("cus_1")).resolves.toBeUndefined();

    mocks.cancel.mockRejectedValueOnce(new Error("network"));
    mocks.retrieve.mockResolvedValueOnce(subscription("sub_1", "active"));
    await expect(cancelCustomerBilling("cus_1")).rejects.toThrow("network");

    mocks.list.mockClear();
    await cancelCustomerBilling(null);
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("aborts when an open checkout page cannot be closed, but not when it was paid or expired meanwhile", async () => {
    mocks.list.mockResolvedValue({ data: [] });
    mocks.sessionsList.mockResolvedValue({ data: [{ id: "cs_1" }] });
    mocks.sessionsExpire.mockRejectedValue(new Error("stripe down"));
    mocks.sessionsRetrieve.mockResolvedValueOnce({ id: "cs_1", status: "open" });
    await expect(cancelCustomerBilling("cus_1")).rejects.toThrow("stripe down");
    mocks.sessionsRetrieve.mockResolvedValueOnce({ id: "cs_1", status: "complete" });
    await expect(cancelCustomerBilling("cus_1")).resolves.toBeUndefined();
  });
});
