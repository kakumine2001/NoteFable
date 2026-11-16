import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

// Stripe（ウェブ）と Google Play（Android）の購読を、同じ User の列に写す共通の処理。
// 行が持つのは「いまの購読」1 つ: subscriptionProvider と、その購読の状態・期間・解約予約。

// この状態の購読は PRO として扱う。past_due は支払いの再試行中（Google Play の猶予期間も past_due に写す）。
const PRO_STATUSES = new Set(["active", "trialing", "past_due"]);

export function isProStatus(status: string | null | undefined) {
  return Boolean(status && PRO_STATUSES.has(status));
}

// 同じ購読（または同じ顧客の申し込み）についての「外部から読む → 行に書く」を 1 つずつ順に行う。
// 並んで届いた知らせが、古い状態を読んだあとで新しい状態を上書きしないように。Postgres の advisory lock（トランザクションの間だけ）。
export async function withBillingLock<T>(key: string, work: () => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`notefable-billing:${key}`}))`);
    return work();
  }, { maxWait: 15_000, timeout: 60_000 });
}

export type SubscriptionOwner = {
  id: string;
  subscriptionProvider: string | null;
  subscriptionStatus: string | null;
  stripeSubscriptionId: string | null;
  googlePurchaseToken: string | null;
};

export const SUBSCRIPTION_OWNER_SELECT = {
  id: true, subscriptionProvider: true, subscriptionStatus: true, stripeSubscriptionId: true, googlePurchaseToken: true,
} as const;

export type SubscriptionUpdate = {
  status: string;
  periodStart: Date | null;
  periodEnd: Date | null;
  cancelAt: Date | null;
} & ({ provider: "stripe"; stripeSubscriptionId: string } | { provider: "google"; googlePurchaseToken: string });

function isCurrent(owner: SubscriptionOwner, update: SubscriptionUpdate) {
  if (!owner.subscriptionProvider) return true;
  if (owner.subscriptionProvider !== update.provider) return false;
  return update.provider === "stripe"
    ? owner.stripeSubscriptionId === update.stripeSubscriptionId
    : owner.googlePurchaseToken === update.googlePurchaseToken;
}

// 購読の状態を行に写す。別の購読（別の購入元も含む）が PRO の間は、終わった購読の知らせでその行を FREE に戻さない。
// 写したら true。
export async function writeSubscription(owner: SubscriptionOwner, update: SubscriptionUpdate) {
  const active = isProStatus(update.status);
  if (!active && !isCurrent(owner, update) && isProStatus(owner.subscriptionStatus)) return false;
  await prisma.user.update({
    where: { id: owner.id },
    data: {
      subscriptionProvider: update.provider,
      ...(update.provider === "stripe" ? { stripeSubscriptionId: update.stripeSubscriptionId } : { googlePurchaseToken: update.googlePurchaseToken }),
      subscriptionStatus: update.status,
      subscriptionPeriodStart: update.periodStart,
      subscriptionPeriodEnd: update.periodEnd,
      subscriptionCancelAt: update.cancelAt,
      plan: active ? "PRO" : "FREE",
    },
  });
  return true;
}
