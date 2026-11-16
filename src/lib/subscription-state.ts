import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

// Stripe（ウェブ）と Google Play（Android）の購読を、同じ User の列に写す共通の処理。
// 行が持つのは「いまの購読」1 つ: subscriptionProvider と、その購読の状態・期間・解約予約。

// この状態の購読は PRO として扱う。past_due は支払いの再試行中（Google Play の猶予期間も past_due に写す）。
const PRO_STATUSES = new Set(["active", "trialing", "past_due"]);

export function isProStatus(status: string | null | undefined) {
  return Boolean(status && PRO_STATUSES.has(status));
}

export type BillingTx = Prisma.TransactionClient;

// 1 人の利用者の課金に関わる処理（申し込み、購読の取り直しと書き込み、購入の報告、アカウント削除）を 1 つずつ順に行う。
// 並んで届いた知らせが古い状態で新しい状態を上書きしないように、また 2 つの申し込みや削除と申し込みが重ならないように。
// Postgres の advisory lock（トランザクションの間だけ）。中の DB 操作は渡す tx で行う（接続を余分に取らない）。
// 中から同じ利用者の withUserBillingLock を呼ばないこと（自分を待って止まる）。
export async function withUserBillingLock<T>(userId: string, work: (tx: BillingTx) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`notefable-billing:user:${userId}`}))`);
    return work(tx);
  }, { maxWait: 15_000, timeout: 60_000 });
}

export type SubscriptionOwner = {
  id: string;
  subscriptionProvider: string | null;
  subscriptionStatus: string | null;
  stripeSubscriptionId: string | null;
  googlePurchaseToken: string | null;
  subscriptionPeriodStart?: Date | null;
  subscriptionPeriodEnd?: Date | null;
};

export const SUBSCRIPTION_OWNER_SELECT = {
  id: true, subscriptionProvider: true, subscriptionStatus: true, stripeSubscriptionId: true, googlePurchaseToken: true,
  subscriptionPeriodStart: true, subscriptionPeriodEnd: true,
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

// 行の購読とこの知らせの関係。
// - write: 行に写す（行の購読そのもの、または行に PRO の購読が無いときの、PRO の購読）。
// - stale: 行に記録した購読とは別の、PRO でない購読の知らせ（終わった古い購読など）。何もしない。
//   行の購読が保留中・一時停止中（PRO でない）でも置き換えない。置き換えると、削除のときに本当の購読を止められなくなる。
// - duplicate: 別の購読が PRO の間に、もう 1 つ PRO の購読ができた（二重課金）。呼び出し側が新しい方を止める。
export function subscriptionAction(owner: SubscriptionOwner, update: SubscriptionUpdate): "write" | "stale" | "duplicate" {
  if (isCurrent(owner, update)) return "write";
  if (!isProStatus(update.status)) return "stale";
  return isProStatus(owner.subscriptionStatus) ? "duplicate" : "write";
}

// 購読の状態を行に写す。必ず withUserBillingLock の中で、その tx と、ロックの中で読み直した owner を渡す。
export async function writeSubscription(tx: BillingTx, owner: SubscriptionOwner, update: SubscriptionUpdate) {
  await tx.user.update({
    where: { id: owner.id },
    data: {
      subscriptionProvider: update.provider,
      ...(update.provider === "stripe" ? { stripeSubscriptionId: update.stripeSubscriptionId } : { googlePurchaseToken: update.googlePurchaseToken }),
      subscriptionStatus: update.status,
      subscriptionPeriodStart: update.periodStart,
      subscriptionPeriodEnd: update.periodEnd,
      subscriptionCancelAt: update.cancelAt,
      plan: isProStatus(update.status) ? "PRO" : "FREE",
    },
  });
}

export async function readOwner(tx: BillingTx, where: { id: string } | { stripeCustomerId: string } | { googlePurchaseToken: string }) {
  return tx.user.findUnique({ where, select: SUBSCRIPTION_OWNER_SELECT });
}
