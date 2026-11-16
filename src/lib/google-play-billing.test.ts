import { generateKeyPairSync } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findUnique: vi.fn(), update: vi.fn() }));
// トランザクションの始まりと終わり、承認の呼び出しの順を記録する。
const events: string[] = [];
vi.mock("@/lib/prisma", () => {
  const user = { findUnique: mocks.findUnique, update: mocks.update };
  return {
    prisma: {
      user,
      $transaction: async (work: (tx: unknown) => unknown) => {
        events.push("lock:start");
        const value = await work({ user, $executeRaw: async () => 0 });
        events.push("lock:end");
        return value;
      },
    },
  };
});
import { exportJWK, generateKeyPair, SignJWT, createLocalJWKSet } from "jose";
import { cancelPlayRenewal, claimPlayPurchase, playStatus, syncPlayPurchase, verifyPushToken } from "./google-play-billing";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const future = "2099-01-01T00:00:00Z";
const past = "2020-01-01T00:00:00Z";

function play(state: string, extra: Record<string, unknown> = {}) {
  return {
    subscriptionState: `SUBSCRIPTION_STATE_${state}`,
    acknowledgementState: "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
    externalAccountIdentifiers: { obfuscatedExternalAccountId: "u1" },
    lineItems: [{ productId: "notefable_pro", expiryTime: future, autoRenewingPlan: { autoRenewEnabled: true } }],
    ...extra,
  };
}

// Google の OAuth と Play Developer API を偽の fetch で返す。呼ばれた API の道筋を記録する。
const calls: string[] = [];
function stubGoogle(subscription: unknown) {
  calls.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "at", expires_in: 3600 }), { status: 200 });
    }
    calls.push(`${init?.method ?? "GET"} ${url.replace("https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.kakumine.notefable/", "")}`);
    return url.includes("subscriptionsv2") ? new Response(JSON.stringify(subscription), { status: 200 }) : new Response("", { status: 200 });
  }));
}

const owner = { id: "u1", subscriptionProvider: null, subscriptionStatus: null, stripeSubscriptionId: null, googlePurchaseToken: null };
const webPro = { ...owner, subscriptionProvider: "stripe", stripeSubscriptionId: "sub_1", subscriptionStatus: "active" };

// 行の読み出し: id で読むと users[id]、購入トークンで読むと tokens[token]。
function rows(users: Record<string, unknown>, tokens: Record<string, unknown> = {}) {
  mocks.findUnique.mockImplementation(async ({ where }: { where: { id?: string; googlePurchaseToken?: string } }) =>
    (where.id ? users[where.id] : where.googlePurchaseToken ? tokens[where.googlePurchaseToken] : null) ?? null);
}

describe("google play billing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUnique.mockReset();
    vi.stubEnv("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON", JSON.stringify({ client_email: "sa@example.iam.gserviceaccount.com", private_key: privateKey }));
    vi.stubEnv("GOOGLE_PLAY_PUSH_SERVICE_ACCOUNT", "pubsub-push@example.iam.gserviceaccount.com");
    mocks.update.mockResolvedValue({});
    rows({ u1: owner });
  });

  it("accepts only Pub/Sub tokens signed by Google for this URL and the configured sender", async () => {
    const { publicKey, privateKey: signing } = await generateKeyPair("RS256");
    const jwk = { ...await exportJWK(publicKey), kid: "k1", alg: "RS256" };
    const keys = createLocalJWKSet({ keys: [jwk] });
    const audience = "https://notefable.com/api/billing/google/notify";
    const sign = (claims: Record<string, unknown>, aud = audience) => new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer("https://accounts.google.com").setAudience(aud).setIssuedAt().setExpirationTime("5m").sign(signing);
    const good = { email: "pubsub-push@example.iam.gserviceaccount.com", email_verified: true };
    await expect(verifyPushToken(await sign(good), audience, keys)).resolves.toBe(true);
    await expect(verifyPushToken(await sign(good, "https://evil.example/hook"), audience, keys)).resolves.toBe(false);
    await expect(verifyPushToken(await sign({ ...good, email: "someone@example.com" }), audience, keys)).resolves.toBe(false);
    await expect(verifyPushToken(await sign({ ...good, email_verified: false }), audience, keys)).resolves.toBe(false);
    await expect(verifyPushToken("not-a-jwt", audience, keys)).resolves.toBe(false);
  });

  it("maps Play states to subscription statuses and keeps Pro until a cancelled plan expires", () => {
    expect(playStatus(play("ACTIVE"))).toMatchObject({ status: "active", cancelAt: null, periodEnd: new Date(future) });
    expect(playStatus(play("CANCELED"))).toMatchObject({ status: "active", cancelAt: new Date(future) });
    expect(playStatus(play("CANCELED", { lineItems: [{ productId: "notefable_pro", expiryTime: past }] })).status).toBe("canceled");
    expect(playStatus(play("ACTIVE", { lineItems: [{ productId: "notefable_pro", expiryTime: future, autoRenewingPlan: { autoRenewEnabled: false } }] })).cancelAt).toEqual(new Date(future));
    expect(playStatus(play("IN_GRACE_PERIOD"))).toMatchObject({ status: "past_due", cancelAt: null });
    expect(playStatus(play("ON_HOLD")).status).toBe("unpaid");
    expect(playStatus(play("PENDING")).status).toBe("incomplete");
    expect(playStatus(play("EXPIRED")).status).toBe("canceled");
    expect(playStatus(play("ACTIVE")).periodStart!.getTime()).toBeLessThan(new Date(future).getTime());
  });

  it("verifies, acknowledges and records a new purchase", async () => {
    stubGoogle(play("ACTIVE", { acknowledgementState: "ACKNOWLEDGEMENT_STATE_PENDING" }));
    await expect(claimPlayPurchase("u1", "tok")).resolves.toBe("subscribed");
    expect(calls).toEqual(["GET purchases/subscriptionsv2/tokens/tok", "POST purchases/subscriptions/notefable_pro/tokens/tok:acknowledge"]);
    expect(mocks.update.mock.calls[0][0].data).toMatchObject({ plan: "PRO", subscriptionProvider: "google", googlePurchaseToken: "tok", subscriptionStatus: "active" });
  });

  it("refuses purchases made for another account or already linked to one", async () => {
    stubGoogle(play("ACTIVE", { externalAccountIdentifiers: { obfuscatedExternalAccountId: "someone" } }));
    await expect(claimPlayPurchase("u1", "tok")).resolves.toBe("not-yours");
    stubGoogle(play("ACTIVE"));
    rows({ u1: owner }, { tok: { id: "u2" } });
    await expect(claimPlayPurchase("u1", "tok")).resolves.toBe("not-yours");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("leaves a new duplicate unacknowledged (refund) and refunds an acknowledged one while the web plan is Pro", async () => {
    rows({ u1: webPro });
    stubGoogle(play("ACTIVE", { acknowledgementState: "ACKNOWLEDGEMENT_STATE_PENDING" }));
    await expect(claimPlayPurchase("u1", "tok")).resolves.toBe("already-subscribed");
    expect(calls).toEqual(["GET purchases/subscriptionsv2/tokens/tok"]);
    // 保留から戻った（承認済みの）Play の購読が RTDN で届いた: Stripe の状態は上書きせず、Play の方を返金して終わらせる。
    rows({ u1: webPro }, { tok: { id: "u1" } });
    stubGoogle(play("ACTIVE"));
    await syncPlayPurchase("tok");
    expect(calls).toContain("POST purchases/subscriptions/notefable_pro/tokens/tok:revoke");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("accepts a receipt without an account id only when the token is already this user's", async () => {
    stubGoogle(play("ACTIVE", { externalAccountIdentifiers: {} }));
    await expect(claimPlayPurchase("u1", "tok")).resolves.toBe("not-yours");
    rows({ u1: { ...owner, subscriptionProvider: "google", googlePurchaseToken: "tok", subscriptionStatus: "active" } });
    await expect(claimPlayPurchase("u1", "tok")).resolves.toBe("subscribed");
  });

  it("finds the owner of a subscription bought again in the Play Store after it expired", async () => {
    stubGoogle(play("ACTIVE", {
      externalAccountIdentifiers: {},
      acknowledgementState: "ACKNOWLEDGEMENT_STATE_PENDING",
      outOfAppPurchaseContext: { expiredPurchaseToken: "old", expiredExternalAccountIdentifiers: { obfuscatedExternalAccountId: "u1" } },
    }));
    rows({ u1: { ...owner, subscriptionProvider: "google", googlePurchaseToken: "old", subscriptionStatus: "canceled" } }, { old: { id: "u1" } });
    await expect(syncPlayPurchase("new")).resolves.toBe("u1");
    expect(calls).toContain("POST purchases/subscriptions/notefable_pro/tokens/new:acknowledge");
    expect(calls.some((call) => call.endsWith(":cancel"))).toBe(false);
    expect(mocks.update.mock.calls[0][0].data).toMatchObject({ googlePurchaseToken: "new", plan: "PRO" });
  });

  it("keeps the usage period start through a grace period and moves it only on a real renewal", async () => {
    const start = new Date("2026-11-01T00:00:00Z");
    const end = new Date("2026-12-01T00:00:00Z");
    rows({ u1: { ...owner, subscriptionProvider: "google", googlePurchaseToken: "tok", subscriptionStatus: "active", subscriptionPeriodStart: start, subscriptionPeriodEnd: end } }, { tok: { id: "u1" } });
    stubGoogle(play("IN_GRACE_PERIOD", { lineItems: [{ productId: "notefable_pro", expiryTime: "2026-12-05T00:00:00Z" }] }));
    await syncPlayPurchase("tok");
    expect(mocks.update.mock.lastCall![0].data.subscriptionPeriodStart).toEqual(start);
    stubGoogle(play("ACTIVE", { lineItems: [{ productId: "notefable_pro", expiryTime: "2027-01-01T00:00:00Z", autoRenewingPlan: { autoRenewEnabled: true } }] }));
    await syncPlayPurchase("tok");
    expect(mocks.update.mock.lastCall![0].data.subscriptionPeriodStart).toEqual(end);
  });

  it("does not let an old expired token replace a current subscription that is on hold", async () => {
    rows({ u1: { ...owner, subscriptionProvider: "google", googlePurchaseToken: "current", subscriptionStatus: "unpaid" } }, { old: { id: "u1" } });
    stubGoogle(play("EXPIRED"));
    await syncPlayPurchase("old");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("keeps the owner record when acknowledgement fails, and reports the failure afterwards", async () => {
    events.length = 0;
    const failing = vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://oauth2.googleapis.com/token")) return new Response(JSON.stringify({ access_token: "at" }), { status: 200 });
      if (url.endsWith(":acknowledge")) { events.push("acknowledge"); return new Response("down", { status: 503 }); }
      return new Response(JSON.stringify(play("ACTIVE", { acknowledgementState: "ACKNOWLEDGEMENT_STATE_PENDING" })), { status: init?.method === "POST" ? 200 : 200 });
    });
    vi.stubGlobal("fetch", failing);
    await expect(claimPlayPurchase("u1", "tok")).rejects.toThrow("503");
    expect(mocks.update.mock.calls[0][0].data).toMatchObject({ googlePurchaseToken: "tok", plan: "PRO" });
    // 承認は、記録を書いたトランザクションが終わってから（ロックの外で）行う。
    expect(events).toEqual(["lock:start", "lock:end", "acknowledge"]);
  });

  it("starts a fresh usage period for a purchase made long after the last one expired", async () => {
    rows({ u1: { ...owner, subscriptionProvider: "google", googlePurchaseToken: "tok", subscriptionStatus: "canceled",
      subscriptionPeriodStart: new Date("2026-02-01T00:00:00Z"), subscriptionPeriodEnd: new Date("2026-03-01T00:00:00Z") } }, { tok: { id: "u1" } });
    stubGoogle(play("ACTIVE", { lineItems: [{ productId: "notefable_pro", expiryTime: "2026-12-15T00:00:00Z", autoRenewingPlan: { autoRenewEnabled: true } }] }));
    await syncPlayPurchase("tok");
    expect(mocks.update.mock.lastCall![0].data.subscriptionPeriodStart.getTime()).toBeGreaterThan(new Date("2026-11-01T00:00:00Z").getTime());
  });

  it("reports a pending payment without granting Pro", async () => {
    stubGoogle(play("PENDING"));
    await expect(claimPlayPurchase("u1", "tok")).resolves.toBe("pending");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("syncs notifications by token, by the replaced token, then by account id", async () => {
    stubGoogle(play("CANCELED", { linkedPurchaseToken: "old" }));
    rows({ u1: { ...owner, subscriptionProvider: "google", subscriptionStatus: "active", googlePurchaseToken: "old" } }, { old: { id: "u1" } });
    await expect(syncPlayPurchase("new")).resolves.toBe("u1");
    expect(mocks.findUnique.mock.calls[1][0].where).toEqual({ googlePurchaseToken: "old" });
    expect(mocks.update.mock.calls[0][0].data).toMatchObject({ googlePurchaseToken: "new", plan: "PRO", subscriptionCancelAt: new Date(future) });
  });

  it("stops renewal of a subscription whose account is gone, including one on hold", async () => {
    rows({});
    stubGoogle(play("ON_HOLD", { externalAccountIdentifiers: {} }));
    await expect(syncPlayPurchase("tok")).resolves.toBeNull();
    expect(calls).toContain("POST purchases/subscriptions/notefable_pro/tokens/tok:cancel");
  });

  it("stops renewal before account deletion, also when paused or on hold, and skips ones already ending", async () => {
    for (const state of ["ACTIVE", "ON_HOLD", "PAUSED"]) {
      stubGoogle(play(state));
      await cancelPlayRenewal("tok");
      expect(calls).toContain("POST purchases/subscriptions/notefable_pro/tokens/tok:cancel");
    }
    stubGoogle(play("CANCELED"));
    await cancelPlayRenewal("tok");
    expect(calls).toEqual(["GET purchases/subscriptionsv2/tokens/tok"]);
  });
});
