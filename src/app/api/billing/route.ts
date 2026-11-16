import { NextResponse } from "next/server";
import { signedInUser } from "@/app/api/billing/account";
import { isBillingConfigured, refreshCustomer } from "@/lib/billing";
import { msg } from "@/lib/i18n/translate";
import { prisma } from "@/lib/prisma";
import { usageSummary } from "@/lib/usage-limits";
import { PRO_PRICE_JPY } from "@/lib/usage-plans";

// 設定の「プラン」用。いまのプラン、購読の状態、この期間の使用量を返す。
// ?refresh=1 は決済から戻ったときに使い、Webhook を待たずに Stripe から購読を取り直す。
export async function GET(request: Request) {
  const user = await signedInUser();
  if (!user) return NextResponse.json({ error: msg("Sign in to see your plan.") }, { status: 401 });

  let row = user;
  const configured = isBillingConfigured();
  if (configured && new URL(request.url).searchParams.get("refresh") === "1" && user.stripeCustomerId) {
    try {
      await refreshCustomer(user);
      row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    } catch (error) {
      // 取り直せなくても、いま分かっている状態を返す（Webhook があとで追いつく）。
      console.warn("Failed to refresh subscription", error instanceof Error ? error.message : error);
    }
  }

  const summary = await usageSummary(row);
  return NextResponse.json({
    billing: configured,
    priceJpy: PRO_PRICE_JPY,
    plan: row.plan === "PRO" ? "pro" : "free",
    // 購読がある（解約済みも含む）ときだけ。Stripe の画面で管理できるのは顧客がいるとき。
    subscription: row.subscriptionStatus ? {
      status: row.subscriptionStatus,
      periodEnd: row.subscriptionPeriodEnd?.toISOString() ?? null,
      cancelAt: row.subscriptionCancelAt?.toISOString() ?? null,
    } : null,
    canManage: configured && Boolean(row.stripeCustomerId),
    usage: summary.usage,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
