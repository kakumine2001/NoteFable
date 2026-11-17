import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), portal: vi.fn() }));
vi.mock("@/app/api/billing/account", () => ({ signedInUser: mocks.user, requestOrigin: () => "https://notefable.com" }));
vi.mock("@/lib/billing", async (load) => {
  const actual = await load<typeof import("@/lib/billing")>();
  return { ...actual, createPortalUrl: mocks.portal };
});
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { POST } from "./route";

const request = () => new NextRequest("https://notefable.com/api/billing/portal", {
  method: "POST", headers: { origin: "https://notefable.com", host: "notefable.com" },
});

describe("POST /api/billing/portal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x");
    vi.stubEnv("STRIPE_PRICE_ID", "price_x");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_x");
    mocks.user.mockResolvedValue({ id: "u1", stripeCustomerId: "cus_1" });
    mocks.portal.mockResolvedValue("https://billing.stripe.com/p/session");
  });

  // 利用規約で解約方法を約束しているので、新規の申し込みを止めても（価格を外しても）管理画面は開ける。
  it("still opens the portal while new sign-ups are paused", async () => {
    vi.stubEnv("STRIPE_PRICE_ID", "");
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url: "https://billing.stripe.com/p/session" });
    expect(mocks.portal).toHaveBeenCalledWith("cus_1", "https://notefable.com");
  });

  it("is unavailable when Stripe is not set up", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    const response = await POST(request());
    expect(response.status).toBe(404);
    expect(mocks.portal).not.toHaveBeenCalled();
  });
});
