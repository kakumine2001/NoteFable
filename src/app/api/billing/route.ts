import { NextResponse } from "next/server";
import { signedInUser } from "@/app/api/billing/account";
import { isBillingConfigured, isTrialEligible, isWebhookConfigured, refreshCustomer } from "@/lib/billing";
import { googlePlayManageUrl, googlePlayProduct, isGooglePlayConfigured, syncPlayPurchase } from "@/lib/google-play-billing";
import { msg } from "@/lib/i18n/translate";
import { prisma } from "@/lib/prisma";
import { usageSummary } from "@/lib/usage-limits";
import { PRO_PRICE_JPY, PRO_TRIAL_DAYS } from "@/lib/usage-plans";

// 設定の「プラン」用。いまのプラン、購読の状態、この期間の使用量を返す。
// ?refresh=1 は決済から戻ったときに使い、Webhook を待たずに Stripe から購読を取り直す。
export async function GET(request: Request) {
  const user = await signedInUser();
  if (!user) return NextResponse.json({ error: msg("Sign in to see your plan.") }, { status: 401 });

  let row = user;
  const configured = isBillingConfigured();
  const googlePlay = isGooglePlayConfigured();
  const refresh = new URL(request.url).searchParams.get("refresh") === "1";
  const refreshStripe = refresh && configured && Boolean(user.stripeCustomerId);
  const refreshPlay = refresh && googlePlay && Boolean(user.googlePurchaseToken);
  if (refreshStripe || refreshPlay) {
    try {
      if (refreshStripe) await refreshCustomer(user);
      if (refreshPlay && user.googlePurchaseToken) await syncPlayPurchase(user.googlePurchaseToken);
      row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    } catch (error) {
      // 取り直せなくても、いま分かっている状態を返す（Webhook があとで追いつく）。
      console.warn("Failed to refresh subscription", error instanceof Error ? error.message : error);
    }
  }

  const summary = await usageSummary(row);
  const provider = row.subscriptionProvider === "google" ? "google" : row.subscriptionProvider === "stripe" ? "stripe" : null;
  return NextResponse.json({
    billing: configured,
    // Android アプリの Play Billing（GOOGLE_PLAY_*）。アプリは購入に accountId を付け、productId の商品を買う。
    googlePlay,
    productId: googlePlayProduct(),
    accountId: row.id,
    provider,
    priceJpy: PRO_PRICE_JPY,
    // 無料の試用を出せる日数（初めての申し込みだけ。出せなければ 0）。
    trialDays: isTrialEligible(row) ? PRO_TRIAL_DAYS : 0,
    plan: row.plan === "PRO" ? "pro" : "free",
    // 購読がある（解約済みも含む）ときだけ。Stripe の画面で管理できるのは顧客がいるとき。
    subscription: row.subscriptionStatus ? {
      status: row.subscriptionStatus,
      periodEnd: row.subscriptionPeriodEnd?.toISOString() ?? null,
      cancelAt: row.subscriptionCancelAt?.toISOString() ?? null,
    } : null,
    // Stripe の Customer Portal で管理できるか（ウェブで買った購読）。Google Play で買った購読は manageUrl（Play ストアの購読画面）で管理する。
    // 新規の申し込みを止めている（価格を外した）間も、続いている購読は解約できるようにする。
    canManage: isWebhookConfigured() && Boolean(row.stripeCustomerId) && provider !== "google",
    manageUrl: provider === "google" ? googlePlayManageUrl() : null,
    usage: summary.usage,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
