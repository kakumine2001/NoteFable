import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ sync: vi.fn(), verify: vi.fn() }));
vi.mock("@/lib/google-play-billing", async (load) => ({ ...await load<object>(), syncPlayPurchase: mocks.sync, verifyPushToken: mocks.verify }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { POST } from "./route";

const URL_ = "https://notefable.com/api/billing/google/notify";
function push(notification: unknown, token: string | null = "good") {
  const data = Buffer.from(JSON.stringify(notification)).toString("base64");
  return new Request(URL_, { method: "POST", body: JSON.stringify({ message: { data } }), headers: token ? { authorization: `Bearer ${token}` } : {} });
}

describe("POST /api/billing/google/notify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON", "{}");
    vi.stubEnv("GOOGLE_PLAY_PUSH_SERVICE_ACCOUNT", "pubsub-push@example.iam.gserviceaccount.com");
    vi.stubEnv("GOOGLE_PLAY_PUSH_AUDIENCE", "");
    mocks.sync.mockResolvedValue("u1");
    mocks.verify.mockImplementation(async (token: string) => token === "good");
  });

  it("rejects pushes without a valid Pub/Sub token, checking it against this URL", async () => {
    expect((await POST(push({}, "bad"))).status).toBe(403);
    expect((await POST(push({}, null))).status).toBe(403);
    expect(mocks.verify).toHaveBeenCalledWith("bad", URL_);
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it("syncs the purchase named by a subscription notification", async () => {
    const response = await POST(push({ packageName: "com.kakumine.notefable", subscriptionNotification: { notificationType: 2, purchaseToken: "tok" } }));
    expect(response.status).toBe(200);
    expect(mocks.sync).toHaveBeenCalledWith("tok");
  });

  it("acknowledges test and unreadable notifications without syncing", async () => {
    expect((await POST(push({ testNotification: { version: "1.0" } }))).status).toBe(200);
    const garbage = new Request(URL_, { method: "POST", body: JSON.stringify({ message: { data: "!!!" } }), headers: { authorization: "Bearer good" } });
    expect((await POST(garbage)).status).toBe(200);
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it("asks Pub/Sub to retry when the sync fails, and is off without configuration", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.sync.mockRejectedValueOnce(new Error("google down"));
    expect((await POST(push({ subscriptionNotification: { purchaseToken: "tok" } }))).status).toBe(500);
    vi.stubEnv("GOOGLE_PLAY_PUSH_SERVICE_ACCOUNT", "");
    expect((await POST(push({ subscriptionNotification: { purchaseToken: "tok" } }))).status).toBe(404);
  });
});
