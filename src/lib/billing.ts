import Stripe from "stripe";
import { optionalEnv } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { isProStatus, readOwner, subscriptionAction, withUserBillingLock, writeSubscription, type BillingTx } from "@/lib/subscription-state";

export { isProStatus };

// 月額の有料プラン（PRO）のウェブでの購読。Stripe Checkout で申し込み、Customer Portal で解約・支払い方法の変更をする。
// 購読の状態は Webhook（/api/billing/webhook）と決済後の確認で Stripe から写す。Webhook の中身は使わず、毎回 Stripe から取り直す。
// 1 人の利用者についての処理は withUserBillingLock で 1 つずつ行う。詳しくは docs/architecture/billing.md。

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

// 申し込みの前に、まだ課金の続く購読（どちらの購入元でも）があったときに投げる（画面には「すでに Pro」と返す）。
export class AlreadySubscribedError extends Error {}
// 申し込みを待っている間にアカウントが削除された。
export class AccountGoneError extends Error {}

type CustomerUser = { id: string; stripeCustomerId: string | null; verifiedEmail?: string | null; email?: string | null };

// 利用者の Stripe の顧客。なければ作る（ロックの中で呼ぶので 1 人に 1 つ。作成には冪等キーも付ける）。
async function ensureCustomer(tx: BillingTx, user: CustomerUser) {
  if (user.stripeCustomerId) return user.stripeCustomerId;
  const customer = await stripe().customers.create(
    { email: user.verifiedEmail ?? user.email ?? undefined, metadata: { userId: user.id } },
    { idempotencyKey: `notefable-customer-${user.id}` },
  );
  await tx.user.update({ where: { id: user.id }, data: { stripeCustomerId: customer.id } });
  return customer.id;
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

// 購読を持ち主の行に写す。ロックの中で、持ち主を読み直してから。
// 別の購読（Google Play も含む）が PRO の間にもう 1 つ課金の続く Stripe の購読ができていたら、二重課金なのでその新しい方を止める。
async function applySubscription(tx: BillingTx, userId: string, subscription: Stripe.Subscription) {
  const owner = await readOwner(tx, { id: userId });
  if (!owner) return null;
  const period = subscriptionPeriod(subscription);
  const update = {
    provider: "stripe" as const,
    stripeSubscriptionId: subscription.id,
    status: subscription.status,
    periodStart: period.start,
    periodEnd: period.end,
    cancelAt: scheduledEnd(subscription, period.end),
  };
  const action = subscriptionAction(owner, update);
  if (action === "duplicate") await stopDuplicate(subscription);
  // 止めた 2 つ目の購読の返金が前回失敗していたら、ここでやり直す（取り消したあとは PRO でないので stale になる）。
  if (action === "stale" && subscription.metadata?.[DUPLICATE_MARK] === "1") await refundDuplicate(subscription);
  if (action === "write") await writeSubscription(tx, owner, update);
  return owner.id;
}

// Webhook から: Stripe の購読を取り直して写す。持ち主は顧客 ID で探す（顧客は申し込みのときに行へ書いてから作る）。
// 持ち主の行が無い（アカウントを削除した）のに課金が続く NoteFable の購読は、その場で止める。
export async function syncSubscription(subscriptionId: string) {
  const first = await stripe().subscriptions.retrieve(subscriptionId);
  const owner = await prisma.user.findUnique({ where: { stripeCustomerId: customerIdOf(first) }, select: { id: true } });
  if (!owner) {
    if (first.metadata?.userId && !ENDED_STATUSES.has(first.status)) await cancelSubscription(first.id);
    return null;
  }
  // ロックを取ってから取り直す（待っている間に状態が変わっていても、最新の状態を書く）。
  return withUserBillingLock(owner.id, async (tx) => applySubscription(tx, owner.id, await stripe().subscriptions.retrieve(subscriptionId)));
}

async function customerSubscriptions(customer: string) {
  return (await stripe().subscriptions.list({ customer, status: "all", limit: 20 })).data;
}

function preferred(subscriptions: Stripe.Subscription[]) {
  return subscriptions.find((subscription) => isProStatus(subscription.status)) ?? subscriptions[0];
}

// 決済から戻ったときなど、Webhook を待たずに顧客の購読を取り直す。有効な購読があればそれを、なければいちばん新しいものを写す。
export async function refreshCustomer(user: { id: string; stripeCustomerId: string | null }) {
  const customer = user.stripeCustomerId;
  if (!customer) return;
  await withUserBillingLock(user.id, async (tx) => {
    const best = preferred(await customerSubscriptions(customer));
    if (best) await applySubscription(tx, user.id, best);
  });
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

// 申し込み。ロックの中で行を読み直し、すでに PRO なら断る。前に開いた決済画面を先に閉じてから
// Stripe の購読を確かめる（閉じる間に支払われた画面の購読も見つかる）。課金の続く購読がなければ新しい決済画面を 1 つだけ作る。
export async function createCheckoutUrl(userId: string, origin: string) {
  // 断るときも、見つけた購読を写した書き込みはコミットしてから投げる（ロックの中で投げると巻き戻る）。
  const result = await withUserBillingLock(userId, async (tx): Promise<{ url: string } | { conflict: true }> => {
    const row = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, stripeCustomerId: true, verifiedEmail: true, email: true, subscriptionStatus: true },
    });
    if (!row) throw new AccountGoneError();
    if (isProStatus(row.subscriptionStatus)) return { conflict: true };
    const customer = await ensureCustomer(tx, row);
    await expireOpenCheckouts(customer);
    const live = (await customerSubscriptions(customer)).filter((subscription) => !ENDED_STATUSES.has(subscription.status));
    if (live.length) {
      await applySubscription(tx, userId, preferred(live));
      return { conflict: true };
    }
    const session = await stripe().checkout.sessions.create({
      mode: "subscription",
      customer,
      client_reference_id: userId,
      line_items: [{ price: optionalEnv("STRIPE_PRICE_ID"), quantity: 1 }],
      subscription_data: { metadata: { userId } },
      allow_promotion_codes: true,
      locale: "auto",
      success_url: `${origin}/app?billing=success`,
      cancel_url: `${origin}/app?billing=cancel`,
    });
    if (!session.url) throw new Error("Stripe did not return a checkout URL.");
    return { url: session.url };
  });
  if ("conflict" in result) throw new AlreadySubscribedError();
  return result.url;
}

export async function createPortalUrl(customer: string, origin: string) {
  const session = await stripe().billingPortal.sessions.create({ customer, return_url: `${origin}/app?billing=portal` });
  return session.url;
}

const DUPLICATE_MARK = "notefable_duplicate";

// 別の購読が PRO の間にできた 2 つ目の Stripe の購読（例: 開いたままの決済画面が、Play で買ったあとに支払われた）。
// 印を付けてから取り消し、支払われた請求を返金する（二重に払わせない）。印があるので、返金に失敗しても Webhook の再送でやり直せる。
async function stopDuplicate(subscription: Stripe.Subscription) {
  await stripe().subscriptions.update(subscription.id, { metadata: { [DUPLICATE_MARK]: "1" } });
  await cancelSubscription(subscription.id);
  await refundDuplicate(subscription);
}

// 返金は請求の支払いごとに冪等キーを付ける（知らせが重なっても 1 回）。
async function refundDuplicate(subscription: Stripe.Subscription) {
  const invoice = typeof subscription.latest_invoice === "string" ? subscription.latest_invoice : subscription.latest_invoice?.id;
  if (!invoice) return;
  const payments = await stripe().invoicePayments.list({ invoice, limit: 10 });
  for (const payment of payments.data) {
    if (payment.status !== "paid") continue;
    const target = payment.payment.payment_intent
      ? { payment_intent: typeof payment.payment.payment_intent === "string" ? payment.payment.payment_intent : payment.payment.payment_intent.id }
      : payment.payment.charge
        ? { charge: typeof payment.payment.charge === "string" ? payment.payment.charge : payment.payment.charge.id }
        : null;
    if (!target) continue;
    await stripe().refunds.create({ ...target, reason: "duplicate", metadata: { subscription: subscription.id } }, { idempotencyKey: `notefable-duplicate-refund-${payment.id}` });
  }
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

// アカウントを削除する前に、顧客の課金をすべて止める: 開いたままの決済画面を閉じ、課金の続く購読
// （行にまだ写っていないもの・重複も含む）を取り消す。行が消えたあとは Webhook で持ち主を探せないため。
// 呼び出し側は、この利用者の withUserBillingLock の中で、止めてから行を消すまでを行う（申し込みと重ならないように）。
export async function cancelCustomerBilling(customer: string | null) {
  if (!customer) return;
  await expireOpenCheckouts(customer);
  for (const subscription of await customerSubscriptions(customer)) {
    if (!ENDED_STATUSES.has(subscription.status)) await cancelSubscription(subscription.id);
  }
}
