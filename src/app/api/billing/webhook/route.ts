import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { isWebhookConfigured, stripe, syncSubscription } from "@/lib/billing";
import { requireEnv } from "@/lib/env";

// Stripe の Webhook。署名を確かめ、購読に関わる知らせなら Stripe から購読を取り直して行に写す（syncSubscription）。
// 写せなかったら 500 を返し、Stripe に再送させる。Stripe のダッシュボードでこの URL と下の種類を登録する（docs/architecture/billing.md）。
const SUBSCRIPTION_EVENTS = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
]);

export async function POST(request: Request) {
  if (!isWebhookConfigured()) return NextResponse.json({ error: "Billing is not configured." }, { status: 404 });
  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing signature." }, { status: 400 });

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(await request.text(), signature, requireEnv("STRIPE_WEBHOOK_SECRET"));
  } catch {
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  const subscriptionId = subscriptionOf(event);
  if (!subscriptionId) return NextResponse.json({ received: true });
  try {
    await syncSubscription(subscriptionId);
  } catch (error) {
    console.error(`Failed to sync subscription for ${event.type}`, error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Sync failed." }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}

function subscriptionOf(event: Stripe.Event): string | null {
  if (SUBSCRIPTION_EVENTS.has(event.type)) return (event.data.object as Stripe.Subscription).id;
  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const session = event.data.object;
    if (session.mode !== "subscription" || !session.subscription) return null;
    return typeof session.subscription === "string" ? session.subscription : session.subscription.id;
  }
  return null;
}
