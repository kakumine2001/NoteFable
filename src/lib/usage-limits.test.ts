import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn(), deleteMany: vi.fn() }));
vi.mock("@/lib/env", () => ({ getCookieSecret: () => "secret" }));
vi.mock("@/lib/prisma", () => ({
  databaseSchema: "studymate",
  prisma: {
    $transaction: async (work: (tx: unknown) => unknown) => work({ $queryRaw: mocks.query }),
    $executeRaw: mocks.execute,
    usageCounter: { deleteMany: mocks.deleteMany },
  },
}));
import { clientNetworkKey, consumeUsage, GUEST_NETWORK_LIMITS, refundUsage, USAGE_LIMITS, usageDay, usageTier } from "./usage-limits";

const guest = { id: "g1", googleSub: null, plan: "FREE" };
const member = { id: "m1", googleSub: "sub", plan: "FREE" };
const limitOf = (call: unknown[]) => (call[0] as { values: unknown[] }).values;

describe("usage limits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
  });

  it("switches days at midnight Japan time", () => {
    expect(usageDay(new Date("2026-11-13T14:59:59Z"))).toBe("2026-11-13");
    expect(usageDay(new Date("2026-11-13T15:00:00Z"))).toBe("2026-11-14");
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
    expect(result).toMatchObject({ ok: true, ticket: { kind: "chat", keys: ["user:g1", "ip:abc"] } });
    expect(limitOf(mocks.query.mock.calls[0])).toContain(USAGE_LIMITS.guest.chat);
    expect(limitOf(mocks.query.mock.calls[1])).toContain(GUEST_NETWORK_LIMITS.chat);
  });

  it("does not apply the network cap to signed-in users", async () => {
    const result = await consumeUsage(member, "image", "ip:abc");
    expect(result).toMatchObject({ ok: true, ticket: { keys: ["user:m1"] } });
    expect(limitOf(mocks.query.mock.calls[0])).toContain(USAGE_LIMITS.member.image);
  });

  it("refuses with a sign-in hint when a guest bucket is full", async () => {
    mocks.query.mockResolvedValueOnce([{ count: 3 }]).mockResolvedValueOnce([]);
    const result = await consumeUsage(guest, "image", "ip:abc");
    expect(result).toMatchObject({ ok: false, tier: "guest" });
    expect(!result.ok && result.message).toContain("Sign in with Google");
  });

  it("refunds every counted bucket and swallows refund errors", async () => {
    await refundUsage({ kind: "chat", day: "2026-11-13", keys: ["user:g1", "ip:abc"] });
    // 数えたときと同じ順に 1 行ずつ戻す。
    expect(mocks.execute.mock.calls.map((call) => limitOf(call)[0])).toEqual(["user:g1", "ip:abc"]);
    expect(limitOf(mocks.execute.mock.calls[0])).toEqual(["user:g1", "chat", "2026-11-13"]);
    mocks.execute.mockClear();
    mocks.execute.mockRejectedValueOnce(new Error("down"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(refundUsage({ kind: "chat", day: "2026-11-13", keys: ["user:g1", "ip:abc"] })).resolves.toBeUndefined();
    expect(mocks.execute).toHaveBeenCalledTimes(2);
    await refundUsage(null);
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });
});
