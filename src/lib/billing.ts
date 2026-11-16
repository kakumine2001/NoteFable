import Stripe from "stripe";
import { optionalEnv } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { isProStatus, SUBSCRIPTION_OWNER_SELECT, withBillingLock, writeSubscription } from "@/lib/subscription-state";

export { isProStatus };

// 月額の有料プラン（PRO）の購読。Stripe Checkout で申し込み、Customer Portal で解約・支払い方法の変更をする。
// 購読の状態は Webhook（/api/billing/webhook）と決済後の確認で Stripe から写す。Webhook の中身は使わず、毎回 Stripe から取り直す
// （順番が入れ替わって届いても、最新の状態だけを書く）。詳しくは docs/architecture/billing.md。

// PRO として扱う状態は subscription-state.ts。past_due は Stripe が支払いを再試行している間
// （再試行が尽きたら購読を取り消す設定にしておく。docs/architecture/billing.md の「配置」）。
// もう課金されない状態。これ以外（incomplete、unpaid、paused も含む）は、アカウント削除のときに止める。
const ENDED_STATUSES = new Set(["canceled", "incomplete_expired"]);

// 申し込み・管理の画面を出すか。価格まで揃っているときだけ。
export function isBillingConfigured() {
  return Boolean(optionalEnv("STRIPE_SECRET_KEY") && optionalEnv("STRIPE_PRICE_ID") && optionalEnv("STRIPE_WEBHOOK_SECRET"));
}

// Webhook を受けるか。新規の申し込みを止める（価格を外す）間も、続いている購読の知らせは受け続ける。
export function isWebhookConfigured() {
  return Boolean(optionalEnv("STRIPE_SECRET_KEY") && optionalEnv("STRIPE_WEBHOOK_SECRET"));
}

let client: Stripe | null = null;
export function stripe() {
  const key = optionalEnv("STRIPE_SECRET_KEY");
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured.");
  client ??= new Stripe(key, { maxNetworkRetries: 2, timeout: 20_000 });
  return client;
}

// 申し込みの前に、まだ課金の続く購読が Stripe にあったときに投げる（画面には「すでに Pro」と返す）。
export class AlreadySubscribedError extends Error {}

type BillingUser = {
  id: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  subscriptionStatus: string | null;
};

// 利用者の Stripe の顧客。なければ作る。同時に 2 回呼ばれても同じ顧客になるよう、作成に冪等キーを付け、
// 行には顧客がまだ無いときだけ書く（負けた側は勝った側の顧客を読み直す）。
export async function ensureCustomer(user: BillingUser & { verifiedEmail?: string | null; email?: string | null }) {
  if (user.stripeCustomerId) return user.stripeCustomerId;
  const customer = await stripe().customers.create(
    { email: user.verifiedEmail ?? user.email ?? undefined, metadata: { userId: user.id } },
    { idempotencyKey: `notefable-customer-${user.id}` },
  );
  const written = await prisma.user.updateMany({ where: { id: user.id, stripeCustomerId: null }, data: { stripeCustomerId: customer.id } });
  if (written.count) return customer.id;
  const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { stripeCustomerId: true } });
  if (!row.stripeCustomerId) throw new Error("Stripe customer was not saved.");
  return row.stripeCustomerId;
}

// 購読の請求期間。新しい API では期間は購読の品目（items）に付く。
function subscriptionPeriod(subscription: Stripe.Subscription) {
  const item = subscription.items.data[0];
  return {
    start: item ? new Date(item.current_period_start * 1000) : null,
    end: item ? new Date(item.current_period_end * 1000) : null,
  };
}

// 解約が予約されていれば、その日時（cancel_at、または期間の終わりで解約するなら期間の終わり）。
function scheduledEnd(subscription: Stripe.Subscription, periodEnd: Date | null) {
  if (subscription.cancel_at) return new Date(subscription.cancel_at * 1000);
  return subscription.cancel_at_period_end ? periodEnd : null;
}

function customerIdOf(subscription: Stripe.Subscription) {
  return typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
}

// 購読を持ち主の行に写す（writeSubscription）。持ち主は顧客 ID で探す（顧客は ensureCustomer が行に書いてから作る）。
// 持ち主の行が無い（アカウントを削除した）のに課金が続く NoteFable の購読は、その場で止める。
async function applySubscription(subscription: Stripe.Subscription) {
  const user = await prisma.user.findUnique({ where: { stripeCustomerId: customerIdOf(subscription) }, select: SUBSCRIPTION_OWNER_SELECT });
  if (!user) {
    if (subscription.metadata?.userId && !ENDED_STATUSES.has(subscription.status)) await cancelSubscription(subscription.id);
    return null;
  }
  const period = subscriptionPeriod(subscription);
  await writeSubscription(user, {
    provider: "stripe",
    stripeSubscriptionId: subscription.id,
    status: subscription.status,
    periodStart: period.start,
    periodEnd: period.end,
    cancelAt: scheduledEnd(subscription, period.end),
  });
  return user.id;
}

// Webhook から: Stripe の購読を取り直して写す。同じ購読の取り直しと書き込みは 1 つずつ（古い状態で上書きしない）。
export async function syncSubscription(subscriptionId: string) {
  return withBillingLock(`stripe-subscription:${subscriptionId}`, async () => applySubscription(await stripe().subscriptions.retrieve(subscriptionId)));
}

async function customerSubscriptions(customer: string) {
  return (await stripe().subscriptions.list({ customer, status: "all", limit: 20 })).data;
}

function preferred(subscriptions: Stripe.Subscription[]) {
  return subscriptions.find((subscription) => isProStatus(subscription.status)) ?? subscriptions[0];
}

// 決済から戻ったときなど、Webhook を待たずに顧客の購読を取り直す。有効な購読があればそれを、なければいちばん新しいものを写す。
export async function refreshCustomer(user: BillingUser) {
  if (!user.stripeCustomerId) return;
  const best = preferred(await customerSubscriptions(user.stripeCustomerId));
  // 一覧の内容は古いかもしれないので、ロックの中で取り直して写す。
  if (best) await syncSubscription(best.id);
}

// 開いたままの決済画面を閉じる（あとから支払われて、2 つ目の購読ができないように）。
// 閉じられなかったら、その画面がもう開いていない（支払われた・期限切れ）ことを確かめ、まだ開いていれば失敗にする。
async function expireOpenCheckouts(customer: string) {
  const sessions = await stripe().checkout.sessions.list({ customer, status: "open", limit: 20 });
  for (const session of sessions.data) {
    try {
      await stripe().checkout.sessions.expire(session.id);
    } catch (error) {
      const current = await stripe().checkout.sessions.retrieve(session.id).catch(() => null);
      if (!current || current.status === "open") throw error;
    }
  }
}

export async function createCheckoutUrl(user: BillingUser & { verifiedEmail?: string | null; email?: string | null }, origin: string) {
  const customer = await ensureCustomer(user);
  // 同じ顧客の申し込みは 1 つずつ（2 つのタブから同時に押しても、支払える画面は 1 つだけ）。
  return withBillingLock(`stripe-checkout:${customer}`, () => openCheckout(user, customer, origin));
}

async function openCheckout(user: BillingUser, customer: string, origin: string) {
  // 行の状態はまだ写っていないことがあるので、Stripe 側で課金の続く購読がないかを確かめる（二重に購読させない）。
  const live = (await customerSubscriptions(customer)).filter((subscription) => !ENDED_STATUSES.has(subscription.status));
  if (live.length) {
    await syncSubscription(preferred(live).id);
    throw new AlreadySubscribedError();
  }
  // 前に開いた決済画面は閉じ、いま作る 1 つだけを支払えるようにする。
  await expireOpenCheckouts(customer);
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer,
    client_reference_id: user.id,
    line_items: [{ price: optionalEnv("STRIPE_PRICE_ID"), quantity: 1 }],
    subscription_data: { metadata: { userId: user.id } },
    allow_promotion_codes: true,
    locale: "auto",
    success_url: `${origin}/app?billing=success`,
    cancel_url: `${origin}/app?billing=cancel`,
  });
  if (!session.url) throw new Error("Stripe did not return a checkout URL.");
  return session.url;
}

export async function createPortalUrl(customer: string, origin: string) {
  const session = await stripe().billingPortal.sessions.create({ customer, return_url: `${origin}/app?billing=portal` });
  return session.url;
}

async function cancelSubscription(id: string) {
  try {
    await stripe().subscriptions.cancel(id);
  } catch (error) {
    // すでに無い・終わっている購読は止めなくてよい。
    if (error instanceof Stripe.errors.StripeInvalidRequestError && error.code === "resource_missing") return;
    const current = await stripe().subscriptions.retrieve(id).catch(() => null);
    if (current && ENDED_STATUSES.has(current.status)) return;
    throw error;
  }
}

// アカウントを削除する前に、顧客の課金をすべて止める: 課金の続く購読（行にまだ写っていないもの・重複も含む）を取り消し、
// 開いたままの決済画面を閉じる。行が消えたあとは Webhook で持ち主を探せないため。
export async function cancelCustomerBilling(user: Pick<BillingUser, "stripeCustomerId">) {
  const customer = user.stripeCustomerId;
  if (!customer) return;
  // 申し込みと同じロック: 削除の途中で新しい決済画面が開かれないように。
  await withBillingLock(`stripe-checkout:${customer}`, async () => {
    await expireOpenCheckouts(customer);
    for (const subscription of await customerSubscriptions(customer)) {
      if (!ENDED_STATUSES.has(subscription.status)) await cancelSubscription(subscription.id);
    }
  });
}
