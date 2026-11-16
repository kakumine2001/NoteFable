import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ sync: vi.fn() }));
vi.mock("@/lib/google-play-billing", async (load) => ({ ...await load<object>(), syncPlayPurchase: mocks.sync }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { POST } from "./route";

function push(notification: unknown, token = "rtdn") {
  const data = Buffer.from(JSON.stringify(notification)).toString("base64");
  return new Request(`https://notefable.com/api/billing/google/notify?token=${token}`, { method: "POST", body: JSON.stringify({ message: { data } }) });
}

describe("POST /api/billing/google/notify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON", "{}");
    vi.stubEnv("GOOGLE_PLAY_RTDN_TOKEN", "rtdn");
    mocks.sync.mockResolvedValue("u1");
  });

  it("rejects pushes without the shared token", async () => {
    expect((await POST(push({}, "wrong"))).status).toBe(403);
    expect((await POST(new Request("https://notefable.com/api/billing/google/notify", { method: "POST", body: "{}" }))).status).toBe(403);
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it("syncs the purchase named by a subscription notification", async () => {
    const response = await POST(push({ packageName: "com.kakumine.notefable", subscriptionNotification: { notificationType: 2, purchaseToken: "tok" } }));
    expect(response.status).toBe(200);
    expect(mocks.sync).toHaveBeenCalledWith("tok");
  });

  it("acknowledges test and unreadable notifications without syncing", async () => {
    expect((await POST(push({ testNotification: { version: "1.0" } }))).status).toBe(200);
    const garbage = new Request("https://notefable.com/api/billing/google/notify?token=rtdn", { method: "POST", body: JSON.stringify({ message: { data: "!!!" } }) });
    expect((await POST(garbage)).status).toBe(200);
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it("asks Pub/Sub to retry when the sync fails, and is off without configuration", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.sync.mockRejectedValueOnce(new Error("google down"));
    expect((await POST(push({ subscriptionNotification: { purchaseToken: "tok" } }))).status).toBe(500);
    vi.stubEnv("GOOGLE_PLAY_RTDN_TOKEN", "");
    expect((await POST(push({ subscriptionNotification: { purchaseToken: "tok" } }))).status).toBe(404);
  });
});
