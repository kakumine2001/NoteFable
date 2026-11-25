import { randomUUID } from "node:crypto";
import {
  AppStoreServerAPIClient, AutoRenewStatus, Environment, SignedDataVerifier, Status,
  VerificationException, VerificationStatus, type JWSTransactionDecodedPayload,
} from "@apple/app-store-server-library";
import { IOS_BUNDLE_ID } from "@/lib/apple-identity-config";
import { blockApplePurchaseForStripe } from "@/lib/billing";
import { optionalEnv } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { isProStatus, readOwner, subscriptionAction, withUserBillingLock, writeSubscription } from "@/lib/subscription-state";

export const APPLE_MANAGE_URL = "https://apps.apple.com/account/subscriptions";

function config() {
  const product = optionalEnv("APP_STORE_PRODUCT_ID");
  const appleId = Number(optionalEnv("APP_STORE_APP_ID"));
  const issuerId = optionalEnv("APP_STORE_IAP_ISSUER_ID");
  const keyId = optionalEnv("APP_STORE_IAP_KEY_ID");
  const key = optionalEnv("APP_STORE_IAP_KEY_P8_B64");
  const root = optionalEnv("APP_STORE_ROOT_CA_G3_B64");
  if (!product || !Number.isSafeInteger(appleId) || appleId <= 0 || !issuerId || !keyId || !key || !root) return null;
  const sandbox = optionalEnv("APP_STORE_IAP_SANDBOX") === "1";
  if (sandbox && process.env.VERCEL_ENV === "production") return null;
  return { product, appleId, issuerId, keyId, key, root, environment: sandbox ? Environment.SANDBOX : Environment.PRODUCTION };
}

export function appleStoreProduct() {
  return config()?.product ?? null;
}

let cached: { configKey: string; client: AppStoreServerAPIClient; verifier: SignedDataVerifier } | undefined;

function store() {
  const settings = config();
  if (!settings) throw new Error("App Store billing is not configured.");
  const configKey = JSON.stringify(settings);
  if (!cached || cached.configKey !== configKey) {
    cached = {
      configKey,
      client: new AppStoreServerAPIClient(
        Buffer.from(settings.key, "base64").toString("utf8"),
        settings.keyId, settings.issuerId, IOS_BUNDLE_ID, settings.environment,
      ),
      verifier: new SignedDataVerifier([Buffer.from(settings.root, "base64")], true, settings.environment, IOS_BUNDLE_ID, settings.appleId),
    };
  }
  return { ...cached, product: settings.product };
}

export function isInvalidAppleSignature(error: unknown) {
  return error instanceof VerificationException && error.status !== VerificationStatus.RETRYABLE_VERIFICATION_FAILURE;
}

export function applePlanStatus(status: number | undefined, periodEnd: Date, now = Date.now()) {
  if (status === Status.REVOKED) return "canceled";
  if (!Number.isFinite(periodEnd.getTime()) || periodEnd.getTime() <= now) return "canceled";
  if (status === Status.ACTIVE) return "active";
  if (status === Status.BILLING_GRACE_PERIOD) return "past_due";
  return "canceled";
}

export async function prepareApplePurchase(userId: string) {
  return withUserBillingLock(userId, async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { plan: true, appleAppAccountToken: true, stripeCustomerId: true } });
    if (!user || user.plan === "PRO") return null;
    if (user.stripeCustomerId && await blockApplePurchaseForStripe(tx, userId, user.stripeCustomerId)) return null;
    if (user.appleAppAccountToken) return user.appleAppAccountToken;
    const token = randomUUID();
    await tx.user.update({ where: { id: userId }, data: { appleAppAccountToken: token } });
    return token;
  });
}

async function currentSubscription(originalId: string, token: string) {
  const { client, verifier, product } = store();
  const result = await client.getAllSubscriptionStatuses(originalId);
  const item = result.data?.flatMap((group) => group.lastTransactions ?? [])
    .find((row) => row.originalTransactionId === originalId);
  if (!item?.signedTransactionInfo || !item.signedRenewalInfo) throw new Error("App Store subscription status is not available yet.");
  const [transaction, renewal] = await Promise.all([
    verifier.verifyAndDecodeTransaction(item.signedTransactionInfo),
    verifier.verifyAndDecodeRenewalInfo(item.signedRenewalInfo),
  ]);
  if (transaction.productId !== product || transaction.originalTransactionId !== originalId ||
      transaction.appAccountToken?.toLowerCase() !== token || renewal.originalTransactionId !== originalId ||
      !transaction.purchaseDate || !transaction.expiresDate) return null;
  const graceEnd = item.status === Status.BILLING_GRACE_PERIOD ? renewal.gracePeriodExpiresDate : undefined;
  const periodEnd = new Date(graceEnd ?? transaction.expiresDate);
  const status = transaction.revocationDate ? "canceled" : applePlanStatus(item.status, periodEnd);
  return {
    provider: "apple" as const,
    appleOriginalTransactionId: originalId,
    status: status === "active" && transaction.offerDiscountType === "FREE_TRIAL" ? "trialing" : status,
    periodStart: new Date(transaction.purchaseDate),
    periodEnd,
    cancelAt: renewal.autoRenewStatus === AutoRenewStatus.OFF ? periodEnd : null,
  };
}

type ApplePurchaseResult = "subscribed" | "inactive" | "conflict" | "not-yours";

async function sync(userId: string, token: string, originalId: string): Promise<ApplePurchaseResult> {
  return withUserBillingLock(userId, async (tx) => {
    const row = await tx.user.findUnique({ where: { id: userId }, select: { appleAppAccountToken: true } });
    if (token !== row?.appleAppAccountToken) return "not-yours";
    const owner = await readOwner(tx, { id: userId });
    if (!owner) return "not-yours";
    const update = await currentSubscription(originalId, token);
    if (!update) return "not-yours";
    const action = subscriptionAction(owner, update);
    if (action === "duplicate") {
      // Apple charges cannot be cancelled from the server. Keep the verified purchase visible so users can manage it.
      if (owner.subscriptionProvider !== "apple" && !owner.appleOriginalTransactionId) {
        await tx.user.update({ where: { id: userId }, data: { appleOriginalTransactionId: originalId } });
      }
      return "conflict";
    }
    if (action === "write") await writeSubscription(tx, owner, update);
    return isProStatus(update.status) ? "subscribed" : "inactive";
  });
}

async function syncTransaction(transaction: JWSTransactionDecodedPayload, userId?: string) {
  const token = transaction.appAccountToken?.toLowerCase();
  const originalId = transaction.originalTransactionId;
  if (!token || !originalId || transaction.productId !== appleStoreProduct()) return "not-yours";
  const owner = await prisma.user.findUnique({ where: { appleAppAccountToken: token }, select: { id: true } });
  if (!owner || (userId && userId !== owner.id)) return "not-yours";
  return sync(owner.id, token, originalId);
}

export async function claimApplePurchase(userId: string, jws: string) {
  return syncTransaction(await store().verifier.verifyAndDecodeTransaction(jws), userId);
}

export async function syncAppleNotification(signedPayload: string) {
  const { verifier } = store();
  const notification = await verifier.verifyAndDecodeNotification(signedPayload);
  if (!notification.data?.signedTransactionInfo) return;
  await syncTransaction(await verifier.verifyAndDecodeTransaction(notification.data.signedTransactionInfo));
}

export async function syncApplePurchase(user: { id: string; appleAppAccountToken: string | null; appleOriginalTransactionId: string | null }) {
  if (user.appleAppAccountToken && user.appleOriginalTransactionId) {
    await sync(user.id, user.appleAppAccountToken, user.appleOriginalTransactionId);
  }
}
