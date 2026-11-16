import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ sync: vi.fn() }));
vi.mock("@/lib/billing", async (load) => {
  const actual = await load<typeof import("@/lib/billing")>();
  return { ...actual, syncSubscription: mocks.sync };
});
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { POST } from "./route";

const SECRET = "whsec_test_secret";
const signer = new Stripe("sk_test_x");

function signed(event: Record<string, unknown>, secret = SECRET) {
  const payload = JSON.stringify(event);
  const header = signer.webhooks.generateTestHeaderString({ payload, secret });
  return new Request("https://notefable.com/api/billing/webhook", { method: "POST", body: payload, headers: { "stripe-signature": header } });
}

describe("POST /api/billing/webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x");
    vi.stubEnv("STRIPE_PRICE_ID", "price_x");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", SECRET);
    mocks.sync.mockResolvedValue("u1");
  });

  it("rejects unsigned or wrongly signed requests", async () => {
    const unsigned = await POST(new Request("https://notefable.com/api/billing/webhook", { method: "POST", body: "{}" }));
    expect(unsigned.status).toBe(400);
    const forged = await POST(signed({ id: "evt", type: "customer.subscription.updated", data: { object: { id: "sub_1" } } }, "whsec_other"));
    expect(forged.status).toBe(400);
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it("syncs the subscription named by subscription and checkout events", async () => {
    expect((await POST(signed({ id: "evt1", type: "customer.subscription.deleted", data: { object: { id: "sub_1" } } }))).status).toBe(200);
    expect((await POST(signed({ id: "evt2", type: "checkout.session.completed", data: { object: { mode: "subscription", subscription: "sub_2" } } }))).status).toBe(200);
    expect(mocks.sync.mock.calls).toEqual([["sub_1"], ["sub_2"]]);
  });

  it("acknowledges unrelated events without syncing", async () => {
    const response = await POST(signed({ id: "evt", type: "checkout.session.completed", data: { object: { mode: "payment", subscription: null } } }));
    expect(response.status).toBe(200);
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it("asks Stripe to retry when the sync fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.sync.mockRejectedValue(new Error("db down"));
    const response = await POST(signed({ id: "evt", type: "customer.subscription.updated", data: { object: { id: "sub_1" } } }));
    expect(response.status).toBe(500);
  });

  it("is not served when billing is off", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    const response = await POST(signed({ id: "evt", type: "customer.subscription.updated", data: { object: { id: "sub_1" } } }));
    expect(response.status).toBe(404);
  });
});
