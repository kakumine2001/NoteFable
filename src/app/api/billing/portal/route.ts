import { NextResponse, type NextRequest } from "next/server";
import { requestOrigin, signedInUser } from "@/app/api/billing/account";
import { createPortalUrl, isWebhookConfigured } from "@/lib/billing";
import { msg } from "@/lib/i18n/translate";
import { isSameOrigin } from "@/lib/native-google-login";

// 購読の管理（解約、支払い方法、領収書）。Stripe の Customer Portal の URL を返す。
// 新規の申し込みを止めている（STRIPE_PRICE_ID を外した）間も開ける。
export async function POST(request: NextRequest) {
  if (!isWebhookConfigured()) return NextResponse.json({ error: msg("Subscriptions are not available yet.") }, { status: 404 });
  if (!isSameOrigin(request.headers.get("origin"), request.headers.get("host"))) {
    return NextResponse.json({ error: msg("Forbidden.") }, { status: 403 });
  }
  const user = await signedInUser();
  if (!user) return NextResponse.json({ error: msg("Sign in to manage your subscription.") }, { status: 401 });
  if (!user.stripeCustomerId) return NextResponse.json({ error: msg("You don't have a subscription.") }, { status: 404 });

  try {
    return NextResponse.json({ url: await createPortalUrl(user.stripeCustomerId, requestOrigin(request)) });
  } catch (error) {
    console.error("Failed to open billing portal", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: msg("Could not open the subscription page. Please try again.") }, { status: 502 });
  }
}
