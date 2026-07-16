import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteMany: vi.fn(),
  queryRaw: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  ensureAnonymousDeviceId: vi.fn().mockResolvedValue("test-device"),
}));

vi.mock("@/lib/prisma", () => ({
  databaseSchema: undefined,
  prisma: {
    apiRateLimit: {
      deleteMany: mocks.deleteMany,
    },
    $queryRaw: mocks.queryRaw,
  },
}));

describe("rate limit cleanup", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-16T00:00:00.000Z"));
    mocks.deleteMany.mockReset().mockResolvedValue({ count: 0 });
    mocks.queryRaw.mockReset().mockResolvedValue([
      {
        count: 1,
        resetAt: new Date("2026-07-16T01:00:00.000Z"),
      },
    ]);
  });

  it("cleans buckets expired for more than 24 hours at most once per hour", async () => {
    const { checkRateLimit } = await import("./rate-limit");
    const request = new Request("https://studymate.example/api/chat", {
      method: "POST",
    });
    const options = {
      namespace: "chat",
      limit: 30,
      windowMs: 60 * 60 * 1000,
    };

    await checkRateLimit(request, options);
    await checkRateLimit(request, options);

    expect(mocks.deleteMany).toHaveBeenCalledTimes(1);
    expect(mocks.deleteMany).toHaveBeenCalledWith({
      where: {
        resetAt: {
          lt: new Date("2026-07-15T00:00:00.000Z"),
        },
      },
    });

    vi.advanceTimersByTime(60 * 60 * 1000);
    await checkRateLimit(request, options);

    expect(mocks.deleteMany).toHaveBeenCalledTimes(2);
  });

  it("continues rate limiting when cleanup fails", async () => {
    const cleanupError = new Error("cleanup failed");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.deleteMany.mockRejectedValueOnce(cleanupError);
    const { checkRateLimit } = await import("./rate-limit");

    const result = await checkRateLimit(
      new Request("https://studymate.example/api/images", { method: "POST" }),
      {
        namespace: "images",
        limit: 10,
        windowMs: 60 * 60 * 1000,
      },
    );

    expect(result).toEqual({
      limited: false,
      remaining: 9,
      resetAt: new Date("2026-07-16T01:00:00.000Z").getTime(),
    });
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      "Failed to clean expired rate limit buckets",
      cleanupError,
    );
    warn.mockRestore();
  });
});
