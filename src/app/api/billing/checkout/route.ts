import { NextResponse, type NextRequest } from "next/server";
import { requestOrigin, signedInUser } from "@/app/api/billing/account";
import { AccountGoneError, AlreadySubscribedError, createCheckoutUrl, isBillingConfigured, isProStatus } from "@/lib/billing";
import { msg } from "@/lib/i18n/translate";
import { isSameOrigin } from "@/lib/native-google-login";

// PRO の申し込み。Stripe Checkout の URL を返し、画面はそこへ移る。
export async function POST(request: NextRequest) {
  if (!isBillingConfigured()) return NextResponse.json({ error: msg("Subscriptions are not available yet.") }, { status: 404 });
  if (!isSameOrigin(request.headers.get("origin"), request.headers.get("host"))) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }
  const user = await signedInUser();
  if (!user) return NextResponse.json({ error: msg("Sign in to upgrade.") }, { status: 401 });
  // 二重に購読させない（Android の Google Play で買った PRO も含む）。続いている購読の変更や解約は「購読を管理」で行う。
  if (isProStatus(user.subscriptionStatus)) {
    return NextResponse.json({ error: msg("You're already subscribed to Pro.") }, { status: 409 });
  }

  try {
    return NextResponse.json({ url: await createCheckoutUrl(user.id, requestOrigin(request)) });
  } catch (error) {
    if (error instanceof AccountGoneError) return NextResponse.json({ error: msg("Sign in to upgrade.") }, { status: 401 });
    if (error instanceof AlreadySubscribedError) {
      return NextResponse.json({ error: msg("You're already subscribed to Pro.") }, { status: 409 });
    }
    console.error("Failed to start checkout", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: msg("Could not open the payment page. Please try again.") }, { status: 502 });
  }
}
