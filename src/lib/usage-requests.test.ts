import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), lock: vi.fn(), execute: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  databaseSchema: "notefable",
  prisma: { $transaction: async (work: (tx: unknown) => unknown) => work({ $queryRaw: mocks.query, $executeRaw: mocks.lock }), $executeRaw: mocks.execute },
}));
vi.mock("@/lib/usage-limits", () => ({ usageDay: () => "2026-11-26" }));
import { abandonUsageRequest, claimUsageRequest, completeUsageRequest, releaseUsageRequest, usageRequestKind } from "./usage-requests";

type Sql = { sql: string; values: unknown[] };
const queries = () => mocks.query.mock.calls.map((call) => call[0] as Sql);
const claim = () => claimUsageRequest("mine", "slides-outline", "req-0123456789", { topic: "x" });
const row = [{ count: 0 }];

describe("usage request markers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockReset().mockResolvedValue([]);
  });

  it("names the marker after the request and its input, whatever the key order", () => {
    const kind = usageRequestKind("slides-outline", "req-0123456789", { a: 1, b: { c: 2, d: [3] } });
    expect(kind).toMatch(/^req:slides-outline:req-0123456789:[0-9a-f]{16}$/);
    expect(usageRequestKind("slides-outline", "req-0123456789", { b: { d: [3], c: 2 }, a: 1 })).toBe(kind);
    expect(usageRequestKind("slides-outline", "req-0123456789", { a: 2, b: { c: 2, d: [3] } })).not.toBe(kind);
  });

  it("claims a new request under the user's key, after locking the marker", async () => {
    mocks.query.mockResolvedValueOnce(row);
    const result = await claim();
    expect(result).toEqual({ state: "new", key: "user:mine", kind: usageRequestKind("slides-outline", "req-0123456789", { topic: "x" }) });
    expect((mocks.lock.mock.calls[0][0] as Sql).sql).toContain("pg_advisory_xact_lock");
    const [insert] = queries();
    expect(insert.sql).toContain('"notefable"."UsageCounter"');
    // ほかの日の行があっても入れない（日付をまたいだ送り直しを数え直さない）。
    expect(insert.sql).toContain("WHERE NOT EXISTS");
    expect(insert.sql).toContain("ON CONFLICT DO NOTHING");
    expect(insert.values).toContain("2026-11-26");
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a delivered request runs again for free", [[], row], "replay", 2],
    ["a request whose owner disappeared resumes for free", [[], [], row], "resume", 3],
    ["a request past its free replays is counted again", [[], [], [], row], "new", 4],
  ] as const)("%s", async (_name, results, state, count) => {
    for (const result of results) mocks.query.mockResolvedValueOnce(result);
    expect(await claim()).toMatchObject({ state });
    expect(mocks.query).toHaveBeenCalledTimes(count);
  });

  it("reports a request that is still running", async () => {
    expect(await claim()).toEqual({ state: "busy" });
    const [, replay, resume, reopen] = queries();
    expect(replay.sql).toContain('"count" BETWEEN 1 AND');
    expect(replay.values).toContain(3);
    expect(resume.sql).toContain("make_interval");
    expect(resume.values).toContain(300);
    expect(reopen.sql).toContain('"count" >');
  });

  it("completes, releases and abandons the marker without failing the response", async () => {
    const marker = { state: "new" as const, key: "user:mine", kind: "req:k" };
    await completeUsageRequest(marker);
    await releaseUsageRequest(marker);
    await abandonUsageRequest(marker);
    const [complete, release, abandon] = mocks.execute.mock.calls.map((call) => call[0] as Sql);
    expect(complete.sql).toContain('"count" = 1');
    expect(release.sql).toContain("DELETE FROM");
    expect(abandon.sql).toContain("'epoch'");
    for (const query of [complete, release, abandon]) expect(query.values).toEqual(["user:mine", "req:k"]);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.execute.mockRejectedValueOnce(new Error("down"));
    await expect(completeUsageRequest(marker)).resolves.toBeUndefined();
  });
});
