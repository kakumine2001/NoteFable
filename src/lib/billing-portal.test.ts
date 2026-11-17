import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Customer Portal の既定の構成を「請求期間の終わりに解約」に保つ。確かめた時刻をモジュールに覚えるので、テストごとに読み直す。
const mocks = vi.hoisted(() => ({ list: vi.fn(), update: vi.fn(), session: vi.fn() }));
vi.mock("stripe", async (load) => {
  const actual = await load<typeof import("stripe")>();
  class FakeStripe {
    billingPortal = {
      configurations: { list: mocks.list, update: mocks.update },
      sessions: { create: mocks.session },
    };
    static errors = actual.default.errors;
  }
  return { default: FakeStripe };
});
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const defaultConfig = (mode: string, enabled = true) => ({ data: [{ id: "bpc_default", features: { subscription_cancel: { enabled, mode } } }] });

async function load() {
  vi.resetModules();
  return import("./billing");
}

describe("createPortalUrl", () => {
  // 最初の読み込み（依存の変換）は時間がかかるので、先に一度済ませる。
  beforeAll(async () => { await import("./billing"); }, 60_000);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x");
    mocks.session.mockResolvedValue({ url: "https://billing.stripe.com/p/s" });
    mocks.update.mockResolvedValue({});
  });

  it("switches the default configuration to cancel at period end and opens the portal with it", async () => {
    const { createPortalUrl, PORTAL_CANCEL } = await load();
    mocks.list.mockResolvedValue(defaultConfig("immediately"));

    await expect(createPortalUrl("cus_1", "https://notefable.com")).resolves.toBe("https://billing.stripe.com/p/s");

    expect(mocks.list).toHaveBeenCalledWith({ is_default: true, limit: 1 });
    expect(mocks.update).toHaveBeenCalledWith("bpc_default", { features: { subscription_cancel: PORTAL_CANCEL } });
    expect(PORTAL_CANCEL).toEqual({ enabled: true, mode: "at_period_end" });
    expect(mocks.session).toHaveBeenCalledWith({ customer: "cus_1", return_url: "https://notefable.com/app?billing=portal" });
  });

  it("turns cancelling back on, leaves a correct configuration alone, and checks again after 10 minutes", async () => {
    vi.useFakeTimers();
    const { createPortalUrl } = await load();
    mocks.list.mockResolvedValueOnce(defaultConfig("at_period_end", false));
    await createPortalUrl("cus_1", "https://notefable.com");
    expect(mocks.update).toHaveBeenCalledTimes(1);

    await createPortalUrl("cus_1", "https://notefable.com");
    expect(mocks.list).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(10 * 60_000);
    mocks.list.mockResolvedValueOnce(defaultConfig("at_period_end"));
    await createPortalUrl("cus_1", "https://notefable.com");
    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });

  it("still opens the portal when the check fails, and retries the check next time", async () => {
    const { createPortalUrl } = await load();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.list.mockRejectedValueOnce(new Error("permission denied")).mockResolvedValueOnce(defaultConfig("immediately"));

    await expect(createPortalUrl("cus_1", "https://notefable.com")).resolves.toBe("https://billing.stripe.com/p/s");
    expect(mocks.update).not.toHaveBeenCalled();

    await createPortalUrl("cus_1", "https://notefable.com");
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });
});
