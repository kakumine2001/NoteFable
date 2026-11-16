import { NextResponse } from "next/server";
import { signedInUser } from "@/app/api/billing/account";
import { claimPlayPurchase, isGooglePlayConfigured } from "@/lib/google-play-billing";
import { msg } from "@/lib/i18n/translate";

// Android アプリの Play Billing で買った購読を報告する。{ purchaseToken }。
// サーバーが Google に確かめて承認し、PRO にする。アプリは購入直後と、起動時に承認待ちの購入が残っていたときに送る。
export async function POST(request: Request) {
  if (!isGooglePlayConfigured()) return NextResponse.json({ error: msg("Subscriptions are not available yet.") }, { status: 404 });
  const user = await signedInUser();
  if (!user) return NextResponse.json({ error: msg("Sign in to upgrade.") }, { status: 401 });
  const body = await request.json().catch(() => null) as { purchaseToken?: unknown } | null;
  const purchaseToken = typeof body?.purchaseToken === "string" ? body.purchaseToken.trim() : "";
  if (!purchaseToken || purchaseToken.length > 4096) return NextResponse.json({ error: "Invalid purchase." }, { status: 400 });

  try {
    const result = await claimPlayPurchase(user, purchaseToken);
    switch (result) {
      case "subscribed": return NextResponse.json({ plan: "pro" });
      case "pending": return NextResponse.json({ plan: "free", pending: true }, { status: 202 });
      case "already-subscribed": return NextResponse.json({ error: msg("You're already subscribed to Pro on the web. This purchase will be refunded.") }, { status: 409 });
      case "not-yours": return NextResponse.json({ error: msg("This purchase belongs to another account.") }, { status: 403 });
      case "not-active": return NextResponse.json({ error: msg("This purchase is no longer active.") }, { status: 409 });
    }
  } catch (error) {
    console.error("Failed to verify Google Play purchase", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: msg("Could not confirm your purchase. Please try again.") }, { status: 502 });
  }
}
