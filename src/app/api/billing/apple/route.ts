import { NextResponse } from "next/server";
import { signedInUser } from "@/app/api/billing/account";
import { appleStatusNeedsRefresh, appleStoreProduct, claimApplePurchase, isInvalidAppleSignature, prepareApplePurchase, releaseApplePurchase, syncApplePurchase } from "@/lib/apple-app-store";
import { blockApplePurchaseForStripe } from "@/lib/billing";
import { optionalEnv } from "@/lib/env";
import { blockApplePurchaseForPlay, isGooglePlayConfigured } from "@/lib/google-play-billing";
import { msg } from "@/lib/i18n/translate";
import { isSameOrigin } from "@/lib/native-google-login";

const result = (status: number, error: string) => NextResponse.json({ error }, { status });

export async function POST(request: Request) {
  if (!appleStoreProduct()) return result(404, msg("Subscriptions are not available yet."));
  if (!isSameOrigin(request.headers.get("origin"), request.headers.get("host"))) return result(403, msg("Forbidden."));
  const user = await signedInUser();
  if (!user) return result(401, msg("Sign in to upgrade."));
  const body = await request.json().catch(() => null) as { prepare?: unknown; transaction?: unknown; release?: unknown } | null;
  try {
    if (body?.prepare === true) {
      if (appleStatusNeedsRefresh(user)) await syncApplePurchase(user);
      const prepared = await prepareApplePurchase(user.id, async (tx, row) => {
        if (row.stripeCustomerId) {
          if (optionalEnv("STRIPE_SECRET_KEY")) {
            if (await blockApplePurchaseForStripe(tx, row.id, row.stripeCustomerId)) return true;
          } else if (row.subscriptionProvider === "stripe" && row.subscriptionStatus !== "canceled") {
            return true;
          }
        }
        if (row.googlePurchaseToken) {
          if (isGooglePlayConfigured()) return blockApplePurchaseForPlay(tx, row.id, row.googlePurchaseToken);
          return row.subscriptionProvider === "google" && row.subscriptionStatus !== "canceled";
        }
        return false;
      });
      return prepared ? NextResponse.json(prepared) : result(409, msg("You're already subscribed to Pro."));
    }
    if (typeof body?.release === "string") {
      const reservation = new Date(body.release);
      if (!Number.isFinite(reservation.getTime())) return result(400, msg("Invalid purchase."));
      await releaseApplePurchase(user.id, reservation);
      return NextResponse.json({ ok: true });
    }
    if (typeof body?.transaction !== "string" || !body.transaction || body.transaction.length > 24_000) {
      return result(400, msg("Invalid purchase."));
    }
    const status = await claimApplePurchase(user.id, body.transaction);
    if (status === "not-yours") return result(403, msg("This purchase belongs to another account."));
    return NextResponse.json({ status });
  } catch (error) {
    if (isInvalidAppleSignature(error)) return result(400, msg("Invalid purchase."));
    return result(502, msg("Could not confirm your purchase. Please try again."));
  }
}
