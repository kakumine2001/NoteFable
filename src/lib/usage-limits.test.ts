import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn() }));
vi.mock("@/lib/env", () => ({ getCookieSecret: () => "secret" }));
vi.mock("@/lib/prisma", () => ({
  databaseSchema: "notefable",
  prisma: {
    $transaction: async (work: (tx: unknown) => unknown) => work({ $queryRaw: mocks.query }),
    $executeRaw: mocks.execute,
    usageCounter: { deleteMany: mocks.deleteMany, findMany: mocks.findMany },
  },
}));
import { clientNetworkKey, consumeUsage, GUEST_NETWORK_LIMITS, refundUsage, USAGE_LIMITS, usageDay, usagePeriodWindow, usageSummary, usageTier } from "./usage-limits";

const guest = { id: "g1", googleSub: null, plan: "FREE" };
const member = { id: "m1", googleSub: "sub", plan: "FREE" };
const pro = {
  id: "p1", googleSub: "sub", plan: "PRO",
  subscriptionPeriodStart: new Date("2026-11-20T03:00:00Z"), subscriptionPeriodEnd: new Date("2026-12-20T03:00:00Z"),
};
const valuesOf = (call: unknown[]) => (call[0] as { values: unknown[] }).values;

describe("usage limits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    mocks.query.mockResolvedValue([{ count: 1 }]);
  });

  it("ranks guests below signed-in users below paid users", () => {
    expect(usageTier(guest)).toBe("guest");
    expect(usageTier(member)).toBe("member");
    expect(usageTier({ googleSub: null, plan: "PRO" })).toBe("pro");
    for (const kind of ["chat", "image"] as const) {
      expect(USAGE_LIMITS.guest[kind]).toBeLessThan(USAGE_LIMITS.member[kind]);
      expect(USAGE_LIMITS.member[kind]).toBeLessThan(USAGE_LIMITS.pro[kind]);
    }
    // 無料で月に使える量が、有料の月の量を超えない（日ごとの上限は 31 日分で比べる）。
    expect(USAGE_LIMITS.member.chat * 31).toBeLessThan(USAGE_LIMITS.pro.chat);
  });

  it("switches days at midnight Japan time", () => {
    expect(usageDay(new Date("2026-11-13T14:59:59Z"))).toBe("2026-11-13");
    expect(usageDay(new Date("2026-11-13T15:00:00Z"))).toBe("2026-11-14");
  });

  it("counts free months by the Japanese calendar and Pro months by the billing period", () => {
    const now = new Date("2026-11-30T15:30:00Z"); // 日本時間 12 月 1 日
    expect(usagePeriodWindow("month", "member", {}, now)).toEqual({ start: "2026-12-01", resetsAt: new Date("2026-12-31T15:00:00Z") });
    expect(usagePeriodWindow("day", "member", {}, now)).toEqual({ start: "2026-12-01", resetsAt: new Date("2026-12-01T15:00:00Z") });
    expect(usagePeriodWindow("month", "pro", pro, now)).toEqual({ start: "2026-11-20", resetsAt: pro.subscriptionPeriodEnd });
    // 期間が過ぎても更新が届いていなければ、暦月で数える（古い期間の満杯の行に縛られない）。
    expect(usagePeriodWindow("month", "pro", pro, new Date("2026-12-21T00:00:00Z")).start).toBe("2026-12-01");
    // 無料に戻ったら、期間の途中でも古い請求期間は使わない。
    expect(usagePeriodWindow("month", "member", pro, now).start).toBe("2026-12-01");
  });

  it("hashes the first forwarded address and skips requests without one", () => {
    const key = clientNetworkKey(new Request("http://x", { headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" } }));
    expect(key).toMatch(/^ip:/);
    expect(key).not.toContain("1.2.3.4");
    expect(clientNetworkKey(new Request("http://x", { headers: { "x-real-ip": "1.2.3.4" } }))).toBe(key);
    expect(clientNetworkKey(new Request("http://x"))).toBeNull();
  });

  it("counts guests per user and per network", async () => {
    const result = await consumeUsage(guest, "chat", "ip:abc");
    expect(result).toMatchObject({ ok: true, ticket: { buckets: [{ key: "user:g1", kind: "chat" }, { key: "ip:abc", kind: "chat" }] } });
    expect(valuesOf(mocks.query.mock.calls[0])).toContain(USAGE_LIMITS.guest.chat);
    expect(valuesOf(mocks.query.mock.calls[1])).toContain(GUEST_NETWORK_LIMITS.chat);
  });

  it("refuses guest images without writing a row", async () => {
    const result = await consumeUsage(guest, "image", "ip:abc");
    expect(result).toMatchObject({ ok: false, tier: "guest" });
    expect(!result.ok && result.message).toBe("Sign in to generate images.");
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("counts free images per month and does not apply the network cap to signed-in users", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-18T01:00:00Z"), toFake: ["Date"] });
    const result = await consumeUsage(member, "image", "ip:abc");
    expect(result).toMatchObject({ ok: true, ticket: { buckets: [{ key: "user:m1", kind: "image:month", day: "2026-11-01" }] } });
    expect(valuesOf(mocks.query.mock.calls[0])).toContain(USAGE_LIMITS.member.image);
  });

  it("counts Pro use in the current billing period", async () => {
    vi.useFakeTimers({ now: new Date("2026-12-05T00:00:00Z"), toFake: ["Date"] });
    const result = await consumeUsage(pro, "chat", null);
    expect(result).toMatchObject({ ok: true, ticket: { buckets: [{ key: "user:p1", kind: "chat:pro", day: "2026-11-20" }] } });
    expect(valuesOf(mocks.query.mock.calls[0])).toContain(USAGE_LIMITS.pro.chat);
  });

  it("refuses free members without naming a purchase (the web shows the upgrade offer itself)", async () => {
    mocks.query.mockResolvedValueOnce([]);
    const result = await consumeUsage(member, "chat", null);
    expect(result).toMatchObject({ ok: false, tier: "member" });
    expect(!result.ok && result.message).toBe("You've used today's free messages. Try again tomorrow.");
  });

  it("refunds every counted bucket and swallows refund errors", async () => {
    const ticket = { buckets: [{ key: "user:g1", kind: "chat", day: "2026-11-13" }, { key: "ip:abc", kind: "chat", day: "2026-11-13" }] };
    await refundUsage(ticket);
    // 数えたときと同じ順に 1 行ずつ戻す。
    expect(mocks.execute.mock.calls.map((call) => valuesOf(call)[0])).toEqual(["user:g1", "ip:abc"]);
    expect(valuesOf(mocks.execute.mock.calls[0])).toEqual(["user:g1", "chat", "2026-11-13"]);
    mocks.execute.mockClear();
    mocks.execute.mockRejectedValueOnce(new Error("down"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(refundUsage(ticket)).resolves.toBeUndefined();
    expect(mocks.execute).toHaveBeenCalledTimes(2);
    await refundUsage(null);
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });

  it("keeps monthly rows of the current period when purging old rows", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    mocks.deleteMany.mockResolvedValue({ count: 0 });
    await consumeUsage(member, "chat", null);
    await vi.waitFor(() => expect(mocks.deleteMany).toHaveBeenCalled());
    const where = mocks.deleteMany.mock.calls[0][0].where;
    expect(where.OR[0].kind).toEqual({ in: ["chat", "image", "report"] });
    expect(where.OR[1].day.lt.getTime()).toBeLessThan(Date.now() - 40 * 24 * 60 * 60 * 1000);
  });

  it("summarizes this period's use per kind", async () => {
    mocks.findMany.mockResolvedValue([{ kind: "chat", count: 7 }, { kind: "image:month", count: 9 }]);
    const summary = await usageSummary(member, new Date("2026-11-18T01:00:00Z"));
    expect(summary.tier).toBe("member");
    expect(summary.usage.chat).toEqual({ used: 7, limit: USAGE_LIMITS.member.chat, period: "day", resetsAt: "2026-11-18T15:00:00.000Z" });
    // 上限を超えた古い数（上限を下げたときなど）は上限で止めて見せる。
    expect(summary.usage.image).toMatchObject({ used: USAGE_LIMITS.member.image, period: "month", resetsAt: "2026-11-30T15:00:00.000Z" });
  });
});
