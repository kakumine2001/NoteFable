import { createSign } from "crypto";
import { optionalEnv } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { isProStatus, readOwner, subscriptionAction, withUserBillingLock, writeSubscription, type SubscriptionOwner, type SubscriptionUpdate } from "@/lib/subscription-state";

// Android アプリの Google Play 購読（Play Billing）。アプリが購入トークンを POST /api/billing/google に送り、
// サーバーが Google Play Developer API で確かめて、承認（acknowledge）し、行に写す。更新・解約などは
// Real-time developer notifications（Pub/Sub の push、POST /api/billing/google/notify）で知らされ、毎回 API から取り直す。
// 詳しくは docs/architecture/billing.md。

const API = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications";
const DEFAULT_PACKAGE = "com.kakumine.notefable";
const DEFAULT_PRODUCT = "notefable_pro";

export function googlePlayPackage() {
  return optionalEnv("GOOGLE_PLAY_PACKAGE_NAME") ?? DEFAULT_PACKAGE;
}

export function googlePlayProduct() {
  return optionalEnv("GOOGLE_PLAY_PRODUCT_ID") ?? DEFAULT_PRODUCT;
}

// サービスアカウントの鍵と RTDN の合言葉が揃っているときだけ、アプリで購入を受け付ける。
export function isGooglePlayConfigured() {
  return Boolean(optionalEnv("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON") && optionalEnv("GOOGLE_PLAY_RTDN_TOKEN"));
}

// Google Play のストアの購読管理画面（この商品）。
export function googlePlayManageUrl() {
  return `https://play.google.com/store/account/subscriptions?sku=${encodeURIComponent(googlePlayProduct())}&package=${encodeURIComponent(googlePlayPackage())}`;
}

export class GooglePlayError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "GooglePlayError";
  }
}

type ServiceAccount = { client_email: string; private_key: string };
let cachedToken: { value: string; expiresAt: number } | null = null;

function serviceAccount(): ServiceAccount {
  const raw = optionalEnv("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON");
  if (!raw) throw new Error("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is not configured.");
  const parsed = JSON.parse(raw) as Partial<ServiceAccount>;
  if (!parsed.client_email || !parsed.private_key) throw new Error("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is missing client_email or private_key.");
  return { client_email: parsed.client_email, private_key: parsed.private_key };
}

const base64url = (value: string | Buffer) => Buffer.from(value).toString("base64url");

// サービスアカウントの JWT で OAuth のアクセストークンを取る（androidpublisher の範囲だけ）。期限の 1 分前まで使い回す。
async function accessToken() {
  if (cachedToken && cachedToken.expiresAt - 60_000 > Date.now()) return cachedToken.value;
  const account = serviceAccount();
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(JSON.stringify({
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/androidpublisher",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }))}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(account.private_key);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${base64url(signature)}` }),
  });
  const data = await response.json().catch(() => null) as { access_token?: string; expires_in?: number } | null;
  if (!response.ok || !data?.access_token) throw new GooglePlayError(`Google OAuth failed (${response.status}).`, response.status);
  cachedToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return cachedToken.value;
}

async function call(path: string, init: RequestInit = {}) {
  const response = await fetch(`${API}/${encodeURIComponent(googlePlayPackage())}/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json", ...init.headers },
  });
  if (!response.ok) throw new GooglePlayError(`Google Play API ${response.status}: ${(await response.text().catch(() => "")).slice(0, 300)}`, response.status);
  const text = await response.text();
  return text ? JSON.parse(text) as unknown : null;
}

// purchases.subscriptionsv2.get の必要な部分。
export type PlaySubscription = {
  subscriptionState?: string;
  acknowledgementState?: string;
  linkedPurchaseToken?: string;
  externalAccountIdentifiers?: { obfuscatedExternalAccountId?: string };
  // Play ストアで、期限切れの購読を買い直したとき（アプリの外）。元の購入トークンと、元の購入に付けた利用者 ID。
  outOfAppPurchaseContext?: { expiredPurchaseToken?: string; expiredExternalAccountIdentifiers?: { obfuscatedExternalAccountId?: string } };
  lineItems?: { productId?: string; expiryTime?: string; autoRenewingPlan?: { autoRenewEnabled?: boolean } }[];
};

export async function fetchPlaySubscription(purchaseToken: string) {
  return await call(`purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`) as PlaySubscription;
}

async function acknowledge(purchaseToken: string, productId: string) {
  await call(`purchases/subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`, { method: "POST", body: "{}" });
}

// 返金して、すぐ終わらせる。
async function revoke(purchaseToken: string, productId: string) {
  await call(`purchases/subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}:revoke`, { method: "POST", body: "{}" });
}

async function cancel(purchaseToken: string, productId: string) {
  await call(`purchases/subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}:cancel`, { method: "POST", body: "{}" });
}

const MONTH_MS = 31 * 24 * 60 * 60 * 1000;

// Google Play の状態を、Stripe と同じ言葉（subscriptionStatus）に直す。解約済み（CANCELED）でも期限までは PRO。
export function playStatus(subscription: PlaySubscription, now = new Date()) {
  const item = subscription.lineItems?.find((line) => line.productId === googlePlayProduct()) ?? subscription.lineItems?.[0];
  const periodEnd = item?.expiryTime ? new Date(item.expiryTime) : null;
  const live = Boolean(periodEnd && periodEnd.getTime() > now.getTime());
  let status: string;
  switch (subscription.subscriptionState) {
    case "SUBSCRIPTION_STATE_ACTIVE": status = live ? "active" : "canceled"; break;
    case "SUBSCRIPTION_STATE_CANCELED": status = live ? "active" : "canceled"; break;
    case "SUBSCRIPTION_STATE_IN_GRACE_PERIOD": status = "past_due"; break;
    case "SUBSCRIPTION_STATE_ON_HOLD": status = "unpaid"; break;
    case "SUBSCRIPTION_STATE_PAUSED": status = "paused"; break;
    case "SUBSCRIPTION_STATE_PENDING": status = "incomplete"; break;
    case "SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED": status = "incomplete_expired"; break;
    default: status = "canceled";
  }
  const renewing = subscription.subscriptionState === "SUBSCRIPTION_STATE_ACTIVE" && item?.autoRenewingPlan?.autoRenewEnabled !== false;
  return {
    status,
    // 期間の初日は返されないので、月額の商品として期限の 1 か月前とみなす（PRO の月の上限を数える区切り）。
    periodStart: periodEnd ? new Date(Math.max(periodEnd.getTime() - MONTH_MS, 0)) : null,
    periodEnd,
    cancelAt: isProStatus(status) && !renewing && status !== "past_due" ? periodEnd : null,
    productId: item?.productId ?? googlePlayProduct(),
  };
}

// 自動更新が続く（この先も請求されうる）状態。保留（ON_HOLD）や一時停止（PAUSED）も、あとで請求が戻りうるので含める。
const RENEWABLE_STATES = new Set([
  "SUBSCRIPTION_STATE_ACTIVE", "SUBSCRIPTION_STATE_IN_GRACE_PERIOD", "SUBSCRIPTION_STATE_ON_HOLD", "SUBSCRIPTION_STATE_PAUSED",
]);

function renews(subscription: PlaySubscription) {
  const item = subscription.lineItems?.find((line) => line.productId === googlePlayProduct()) ?? subscription.lineItems?.[0];
  return RENEWABLE_STATES.has(subscription.subscriptionState ?? "") && item?.autoRenewingPlan?.autoRenewEnabled !== false;
}

// 前の購入トークン: プランの変更（linkedPurchaseToken）か、期限切れの購読を Play ストアで買い直した（outOfAppPurchaseContext）。
function previousToken(subscription: PlaySubscription) {
  return subscription.linkedPurchaseToken ?? subscription.outOfAppPurchaseContext?.expiredPurchaseToken;
}

// 購入に付けた利用者 ID（Play ストアでの買い直しなら、元の購入に付けた ID）。
function accountIdOf(subscription: PlaySubscription) {
  return subscription.externalAccountIdentifiers?.obfuscatedExternalAccountId
    ?? subscription.outOfAppPurchaseContext?.expiredExternalAccountIdentifiers?.obfuscatedExternalAccountId;
}

const DAY_MS = 24 * 60 * 60 * 1000;

// 行に写す内容。期間の初日は、同じ購読なら前の値を保つ（猶予期間中は Google が期限を毎日延ばすので、期限から逆算すると
// 月の上限の区切りが動いて枠が増える）。本当に更新された（期限が前の期限より先に進み、状態が有効）ときだけ、前の期限を新しい初日にする。
// owner は行のまま（前のトークンへの置き換え前）を渡す: 買い直し（新しいトークン）は新しい期間として数える。
// 前の期限から間が空いて更新された（期限切れのあとの再開）ときも、前の期限ではなく新しい期間にする。
function playUpdate(owner: SubscriptionOwner, purchaseToken: string, subscription: PlaySubscription): SubscriptionUpdate {
  const state = playStatus(subscription);
  let periodStart = state.periodStart;
  const same = owner.subscriptionProvider === "google" && owner.googlePurchaseToken === purchaseToken;
  const previousStart = owner.subscriptionPeriodStart ?? null;
  const previousEnd = owner.subscriptionPeriodEnd ?? null;
  if (same && previousStart && previousEnd && state.periodEnd && state.periodStart) {
    const renewed = subscription.subscriptionState === "SUBSCRIPTION_STATE_ACTIVE" && state.periodEnd.getTime() > previousEnd.getTime() + DAY_MS;
    const contiguous = state.periodStart.getTime() <= previousEnd.getTime() + DAY_MS;
    periodStart = !renewed ? previousStart : contiguous ? previousEnd : state.periodStart;
  }
  return {
    provider: "google",
    googlePurchaseToken: purchaseToken,
    status: state.status,
    periodStart,
    periodEnd: state.periodEnd,
    cancelAt: state.cancelAt,
  };
}

// 新しい購入トークンになった購読（previousToken）は、元のトークンの購読と同じものとして扱う。
function asCurrentOwner(owner: SubscriptionOwner, purchaseToken: string, subscription: PlaySubscription): SubscriptionOwner {
  const previous = previousToken(subscription);
  return previous && owner.subscriptionProvider === "google" && owner.googlePurchaseToken === previous ? { ...owner, googlePurchaseToken: purchaseToken } : owner;
}

const isPending = (subscription: PlaySubscription) => subscription.acknowledgementState === "ACKNOWLEDGEMENT_STATE_PENDING";

// 別の購読（ウェブの Stripe）が PRO の間に、Play でも課金の続く購読ができた（二重課金）。Play の方を止める:
// 未承認なら承認しない（Google が 3 日後に自動で返金する）、承認済み（保留から戻った等）なら返金して終わらせる。
async function stopDuplicate(purchaseToken: string, subscription: PlaySubscription) {
  if (!isPending(subscription) && isProStatus(playStatus(subscription).status)) await revoke(purchaseToken, playStatus(subscription).productId);
}

export type ClaimResult = "subscribed" | "pending" | "already-subscribed" | "not-yours" | "not-active";

// アプリからの報告: この利用者が買った購読を確かめて承認し、行に写す。利用者のロックの中で、行を読み直してから。
// 承認は行に書いたあとに行い、失敗してもトランザクションは巻き戻さない（書いた持ち主の記録を残し、
// 再送やアプリの再報告で持ち主を見つけて承認し直せるように）。失敗はコミットのあとで投げる。
export async function claimPlayPurchase(userId: string, purchaseToken: string): Promise<ClaimResult> {
  let ackError: unknown = null;
  const result = await withUserBillingLock(userId, async (tx): Promise<ClaimResult> => {
    const owner = await readOwner(tx, { id: userId });
    if (!owner) return "not-yours";
    const subscription = await fetchPlaySubscription(purchaseToken);
    // この利用者のものと確かめられる購入だけを受け付ける: 購入に付けた利用者 ID が一致するか、
    // このトークン（または前のトークン）がすでにこの利用者に記録されている。ID が無い購入を、ほかの利用者が名乗れないように。
    const accountId = accountIdOf(subscription);
    const previous = previousToken(subscription);
    const recorded = owner.googlePurchaseToken === purchaseToken || Boolean(previous && owner.googlePurchaseToken === previous);
    if (accountId ? accountId !== userId : !recorded) return "not-yours";
    const other = await tx.user.findUnique({ where: { googlePurchaseToken: purchaseToken }, select: { id: true } });
    if (other && other.id !== userId) return "not-yours";
    const current = asCurrentOwner(owner, purchaseToken, subscription);
    const update = playUpdate(owner, purchaseToken, subscription);
    if (update.status === "incomplete") return "pending";
    const action = subscriptionAction(current, update);
    if (action === "duplicate") {
      await stopDuplicate(purchaseToken, subscription);
      return "already-subscribed";
    }
    if (!isProStatus(update.status)) {
      if (action === "write" && owner.googlePurchaseToken === purchaseToken) await writeSubscription(tx, owner, update);
      return "not-active";
    }
    await writeSubscription(tx, owner, update);
    if (isPending(subscription)) ackError = await acknowledge(purchaseToken, playStatus(subscription).productId).then(() => null, (error: unknown) => error);
    return "subscribed";
  });
  if (ackError) throw ackError;
  return result;
}

// RTDN: 通知の購入トークンを Google から読み、持ち主の行に写す。
// 持ち主は購入トークン、前の購入トークン（previousToken）、購入に付けた利用者 ID の順で探す。
// 持ち主の行が無い（アカウントを削除した）のに続いている購読は、更新を止める。
export async function syncPlayPurchase(purchaseToken: string) {
  const first = await fetchPlaySubscription(purchaseToken);
  const previous = previousToken(first);
  const accountId = accountIdOf(first);
  const owner = await prisma.user.findUnique({ where: { googlePurchaseToken: purchaseToken }, select: { id: true } })
    ?? (previous ? await prisma.user.findUnique({ where: { googlePurchaseToken: previous }, select: { id: true } }) : null)
    ?? (accountId ? await prisma.user.findUnique({ where: { id: accountId }, select: { id: true } }) : null);
  if (!owner) {
    if (renews(first)) await cancel(purchaseToken, playStatus(first).productId);
    return null;
  }
  let ackError: unknown = null;
  const id = await withUserBillingLock(owner.id, async (tx) => {
    const current = await readOwner(tx, { id: owner.id });
    if (!current) return null;
    // ロックを取ってから読み直す（待っている間に状態が変わっていても、最新の状態を書く）。
    const subscription = await fetchPlaySubscription(purchaseToken);
    const view = asCurrentOwner(current, purchaseToken, subscription);
    const update = playUpdate(current, purchaseToken, subscription);
    const action = subscriptionAction(view, update);
    if (action === "duplicate") await stopDuplicate(purchaseToken, subscription);
    if (action !== "write") return current.id;
    // 持ち主の記録を先にコミットしてから承認する（Play ストアでの買い直しは、承認すると持ち主の手がかりが消える）。
    await writeSubscription(tx, current, update);
    // 承認されないまま 3 日経つと返金される。アプリからの報告が届かなかった購入も、ここで承認する。
    if (isProStatus(update.status) && isPending(subscription)) {
      ackError = await acknowledge(purchaseToken, playStatus(subscription).productId).then(() => null, (error: unknown) => error);
    }
    return current.id;
  });
  // 承認に失敗したら、記録はコミットしたうえで 500 にして通知を再送させる。
  if (ackError) throw ackError;
  return id;
}

// アカウントを削除する前に、Google Play の購読の自動更新を止める（すでに払った期限までは Google 側で有効なまま）。
// PRO でない保留中・一時停止中の購読も、あとで請求が戻りうるので止める。
// 呼び出し側は、この利用者の withUserBillingLock の中で、止めてから行を消すまでを行う。
export async function cancelPlayRenewal(purchaseToken: string | null) {
  if (!purchaseToken) return;
  const subscription = await fetchPlaySubscription(purchaseToken).catch((error: unknown) => {
    if (error instanceof GooglePlayError && (error.status === 404 || error.status === 410)) return null;
    throw error;
  });
  if (subscription && renews(subscription)) await cancel(purchaseToken, playStatus(subscription).productId);
}
