import { NextResponse } from "next/server";
import { APPLE_MANAGE_URL, appleStatusNeedsRefresh, appleStoreProduct, syncApplePurchase } from "@/lib/apple-app-store";
import { signedInUser } from "@/app/api/billing/account";
import { isBillingConfigured, isTrialEligible, isWebhookConfigured, refreshCustomer } from "@/lib/billing";
import { googlePlayManageUrl, googlePlayProduct, isGooglePlayConfigured, syncPlayPurchase } from "@/lib/google-play-billing";
import { msg } from "@/lib/i18n/translate";
import { applePurchasePending } from "@/lib/subscription-state";
import { prisma } from "@/lib/prisma";
import { scheduleStorageMaintenance, storageSummary } from "@/lib/stored-files";
import { usageSummary, usageTier } from "@/lib/usage-limits";
import { PRO_PRICE_JPY, PRO_TRIAL_DAYS } from "@/lib/usage-plans";

// 設定の「プラン」用。いまのプラン、購読の状態、この期間の使用量、ファイル置き場の使用量を返す。
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
  const appStoreProduct = appleStoreProduct();
  const refreshApple = Boolean(appStoreProduct && user.appleOriginalTransactionId && (refresh || appleStatusNeedsRefresh(user)));
  if (refreshStripe || refreshPlay || refreshApple) {
    try {
      if (refreshStripe) await refreshCustomer(user);
      if (refreshPlay && user.googlePurchaseToken) await syncPlayPurchase(user.googlePurchaseToken);
      if (refreshApple) await syncApplePurchase(user);
      row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    } catch (error) {
      // 取り直せなくても、いま分かっている状態を返す（Webhook があとで追いつく）。
      console.warn("Failed to refresh subscription", error instanceof Error ? error.message : error);
    }
  }

  const [summary, storage] = await Promise.all([usageSummary(row), storageSummary(row)]);
  // 設定を開いたついでに、ファイルの後片付けの時間が来ていれば進める（応答の後）。
  scheduleStorageMaintenance();
  const provider = row.subscriptionProvider === "google" ? "google" : row.subscriptionProvider === "stripe" ? "stripe" : row.subscriptionProvider === "apple" ? "apple" : null;
  return NextResponse.json({
    billing: configured && !applePurchasePending(row),
    // Android アプリの Play Billing（GOOGLE_PLAY_*）。アプリは購入に accountId を付け、productId の商品を買う。
    googlePlay: googlePlay && !applePurchasePending(row),
    productId: googlePlayProduct(),
    accountId: row.id,
    appStoreProduct,
    appStorePending: applePurchasePending(row),
    appStorePurchase: Boolean(row.appleOriginalTransactionId),
    provider,
    priceJpy: PRO_PRICE_JPY,
    // 無料の試用を出せる日数（初めての申し込みだけ。出せなければ 0）。
    trialDays: isTrialEligible(row) ? PRO_TRIAL_DAYS : 0,
    plan: usageTier(row) === "pro" ? "pro" : "free",
    // 購読がある（解約済みも含む）ときだけ。Stripe の画面で管理できるのは顧客がいるとき。
    subscription: row.subscriptionStatus ? {
      status: provider === "apple" && row.subscriptionStatus === "trialing" ? "active" : row.subscriptionStatus,
      periodEnd: row.subscriptionPeriodEnd?.toISOString() ?? null,
      cancelAt: row.subscriptionCancelAt?.toISOString() ?? null,
    } : null,
    // Stripe の Customer Portal で管理できるか（ウェブで買った購読）。Google Play で買った購読は manageUrl（Play ストアの購読画面）で管理する。
    // 新規の申し込みを止めている（価格を外した）間も、続いている購読は解約できるようにする。
    canManage: isWebhookConfigured() && Boolean(row.stripeCustomerId) && provider !== "google" && provider !== "apple",
    manageUrl: provider === "google" ? googlePlayManageUrl() : null,
    appStoreManageUrl: row.appleOriginalTransactionId ? APPLE_MANAGE_URL : null,
    usage: summary.usage,
    // ファイル置き場の使用量と上限（バイト）。
    storage,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
