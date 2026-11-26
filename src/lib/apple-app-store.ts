import { randomUUID } from "node:crypto";
import {
  AppStoreServerAPIClient, AutoRenewStatus, Environment, SignedDataVerifier, Status,
  VerificationException, VerificationStatus, type JWSTransactionDecodedPayload,
} from "@apple/app-store-server-library";
import { IOS_BUNDLE_ID } from "@/lib/apple-identity-config";
import { optionalEnv } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { applePurchasePending, isProStatus, readOwner, subscriptionAction, withAppleBillingLocks, withUserBillingLock, writeSubscription, type BillingTx, type SubscriptionOwner } from "@/lib/subscription-state";

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
  return { product, appleId, issuerId, keyId, key, root, sandbox };
}

export function appleStoreProduct() {
  return config()?.product ?? null;
}

type StoreEnvironment = Environment.PRODUCTION | Environment.SANDBOX;

export function appleStoreEnvironment(userId: string): StoreEnvironment {
  const reviewUsers = optionalEnv("APP_STORE_SANDBOX_REVIEW_USER_IDS")?.split(",").map((id) => id.trim()) ?? [];
  return config()?.sandbox || reviewUsers.includes(userId) ? Environment.SANDBOX : Environment.PRODUCTION;
}

const cache = new Map<StoreEnvironment, { configKey: string; client: AppStoreServerAPIClient; verifier: SignedDataVerifier }>();

function store(environment: StoreEnvironment) {
  const settings = config();
  if (!settings) throw new Error("App Store billing is not configured.");
  const configKey = JSON.stringify(settings);
  let cached = cache.get(environment);
  if (!cached || cached.configKey !== configKey) {
    cached = {
      configKey,
      client: new AppStoreServerAPIClient(
        Buffer.from(settings.key, "base64").toString("utf8"),
        settings.keyId, settings.issuerId, IOS_BUNDLE_ID, environment,
      ),
      verifier: new SignedDataVerifier([Buffer.from(settings.root, "base64")], true, environment, IOS_BUNDLE_ID, settings.appleId),
    };
    cache.set(environment, cached);
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

type OtherBilling = {
  id: string;
  stripeCustomerId: string | null;
  googlePurchaseToken: string | null;
  subscriptionProvider: string | null;
  subscriptionStatus: string | null;
};
type CheckOtherBilling = (tx: BillingTx, user: OtherBilling) => Promise<boolean>;

export async function prepareApplePurchase(userId: string, checkOtherBilling: CheckOtherBilling) {
  return withUserBillingLock(userId, async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, plan: true, appleAppAccountToken: true, stripeCustomerId: true, googlePurchaseToken: true, subscriptionProvider: true, subscriptionStatus: true, applePurchaseHoldUntil: true } });
    if (!user || user.plan === "PRO") return null;
    if (applePurchasePending(user)) return { pending: true } as const;
    if (await checkOtherBilling(tx, user)) return null;
    const token = user.appleAppAccountToken ?? randomUUID();
    // Ask to Buy may complete after the app closes. Reserve slightly longer than its 24-hour approval window.
    const holdUntil = new Date(Date.now() + 25 * 60 * 60 * 1000);
    await tx.user.update({ where: { id: userId }, data: { appleAppAccountToken: token, applePurchaseHoldUntil: holdUntil } });
    return { token, reservation: holdUntil.toISOString() };
  });
}

export async function releaseApplePurchase(userId: string, reservation: Date) {
  await withUserBillingLock(userId, async (tx) => {
    await tx.user.updateMany({
      where: { id: userId, applePurchaseHoldUntil: reservation },
      data: { applePurchaseHoldUntil: null },
    });
  });
}

async function currentSubscription(originalId: string, token: string, environment: StoreEnvironment, knownBinding: boolean) {
  const { client, verifier, product } = store(environment);
  const result = await client.getAllSubscriptionStatuses(originalId);
  const item = result.data?.flatMap((group) => group.lastTransactions ?? [])
    .find((row) => row.originalTransactionId === originalId);
  if (!item?.signedTransactionInfo || !item.signedRenewalInfo) throw new Error("App Store subscription status is not available yet.");
  const [transaction, renewal] = await Promise.all([
    verifier.verifyAndDecodeTransaction(item.signedTransactionInfo),
    verifier.verifyAndDecodeRenewalInfo(item.signedRenewalInfo),
  ]);
  const reportedToken = transaction.appAccountToken?.toLowerCase();
  if (transaction.productId !== product || transaction.originalTransactionId !== originalId ||
      renewal.originalTransactionId !== originalId || !transaction.purchaseDate || !transaction.expiresDate) return null;
  if (reportedToken ? reportedToken !== token : !knownBinding) return "different-account" as const;
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
  return withAppleBillingLocks(originalId, userId, async (tx, previousUserId) => {
    const row = await tx.user.findUnique({ where: { id: userId }, select: { appleAppAccountToken: true } });
    if (token !== row?.appleAppAccountToken) return "not-yours";
    const owner = await readOwner(tx, { id: userId });
    if (!owner) return "not-yours";
    const environment = appleStoreEnvironment(userId);
    const update = await currentSubscription(originalId, token, environment, owner.appleOriginalTransactionId === originalId);
    if (!update || update === "different-account") return "not-yours";
    const action = subscriptionAction(owner, update);
    const canRecordBinding = action === "write" || (action === "duplicate" && !owner.appleOriginalTransactionId && owner.subscriptionProvider !== "apple");
    if (previousUserId && canRecordBinding && isProStatus(update.status)) {
      if (appleStoreEnvironment(previousUserId) !== environment) return "not-yours";
      const previous = await readOwner(tx, { id: previousUserId });
      if (previous?.appleOriginalTransactionId === originalId) {
        await tx.user.update({
          where: { id: previousUserId },
          data: {
            appleOriginalTransactionId: null,
            ...(previous.subscriptionProvider === "apple" ? {
              plan: "FREE", subscriptionStatus: "canceled", subscriptionPeriodStart: null,
              subscriptionPeriodEnd: null, subscriptionCancelAt: null,
            } : {}),
          },
        });
      }
    }
    if (isProStatus(update.status) && owner.applePurchaseHoldUntil) {
      await tx.user.update({ where: { id: userId }, data: { applePurchaseHoldUntil: null } });
    }
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

async function syncTransaction(transaction: JWSTransactionDecodedPayload, environment: StoreEnvironment, userId?: string) {
  const token = transaction.appAccountToken?.toLowerCase();
  const originalId = transaction.originalTransactionId;
  if (!originalId || transaction.productId !== appleStoreProduct()) return "not-yours";
  const owner = await prisma.user.findUnique({
    where: token ? { appleAppAccountToken: token } : { appleOriginalTransactionId: originalId },
    select: { id: true, appleAppAccountToken: true },
  });
  if (!owner?.appleAppAccountToken || appleStoreEnvironment(owner.id) !== environment || (userId && userId !== owner.id)) return "not-yours";
  return sync(owner.id, owner.appleAppAccountToken, originalId);
}

export async function claimApplePurchase(userId: string, jws: string) {
  const environment = appleStoreEnvironment(userId);
  return syncTransaction(await store(environment).verifier.verifyAndDecodeTransaction(jws), environment, userId);
}

export async function syncAppleNotification(signedPayload: string, sandbox: boolean) {
  const environment = sandbox ? Environment.SANDBOX : Environment.PRODUCTION;
  const { verifier } = store(environment);
  const notification = await verifier.verifyAndDecodeNotification(signedPayload);
  if (!notification.data?.signedTransactionInfo) return;
  await syncTransaction(await verifier.verifyAndDecodeTransaction(notification.data.signedTransactionInfo), environment);
}

export type AppleBillingOwner = { id: string; appleAppAccountToken: string | null; appleOriginalTransactionId: string | null; subscriptionProvider?: string | null; subscriptionStatus?: string | null; subscriptionPeriodEnd?: Date | null };

export function appleStatusNeedsRefresh(user: Pick<AppleBillingOwner, "appleOriginalTransactionId" | "subscriptionProvider" | "subscriptionStatus" | "subscriptionPeriodEnd">) {
  return Boolean(user.appleOriginalTransactionId && user.subscriptionProvider === "apple" && isProStatus(user.subscriptionStatus) && (user.subscriptionPeriodEnd?.getTime() ?? 0) <= Date.now());
}

export async function refreshAppleBillingOwner(tx: BillingTx, owner: SubscriptionOwner) {
  if (!owner.appleOriginalTransactionId || !appleStatusNeedsRefresh({ ...owner, appleOriginalTransactionId: owner.appleOriginalTransactionId })) return owner;
  const row = await tx.user.findUnique({ where: { id: owner.id }, select: { appleAppAccountToken: true } });
  if (!row?.appleAppAccountToken) return owner;
  const update = await currentSubscription(owner.appleOriginalTransactionId, row.appleAppAccountToken, appleStoreEnvironment(owner.id), true);
  if (!update) throw new Error("Could not reconcile the App Store subscription.");
  const resolved = update === "different-account"
    ? { provider: "apple" as const, appleOriginalTransactionId: owner.appleOriginalTransactionId, status: "canceled", periodStart: null, periodEnd: null, cancelAt: null }
    : update;
  await writeSubscription(tx, owner, resolved);
  return { ...owner, subscriptionStatus: resolved.status, subscriptionPeriodStart: resolved.periodStart, subscriptionPeriodEnd: resolved.periodEnd };
}

export async function syncApplePurchase(user: AppleBillingOwner) {
  if (user.appleAppAccountToken && user.appleOriginalTransactionId) {
    if (appleStatusNeedsRefresh(user)) {
      await withUserBillingLock(user.id, async (tx) => {
        const owner = await readOwner(tx, { id: user.id });
        if (owner) await refreshAppleBillingOwner(tx, owner);
      });
    } else {
      await sync(user.id, user.appleAppAccountToken, user.appleOriginalTransactionId);
    }
  }
}
