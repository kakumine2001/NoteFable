import { NextResponse } from "next/server";
import { isGooglePlayConfigured, pushAudience, syncPlayPurchase, verifyPushToken } from "@/lib/google-play-billing";

// Google Play の Real-time developer notifications（Pub/Sub の push 購読の送り先）。
// Pub/Sub が付けてくる Google の ID トークンを確かめ（verifyPushToken）、送信元が設定したサービスアカウントのものだけ受ける。
// 通知の中身は購入トークンを知るためだけに使い、状態は毎回 Google から取り直す。写せなかったら 500 を返し、Pub/Sub に再送させる。
type PushBody = { message?: { data?: string } };
type DeveloperNotification = { packageName?: string; subscriptionNotification?: { purchaseToken?: string } };

export async function POST(request: Request) {
  if (!isGooglePlayConfigured()) return NextResponse.json({ error: "Google Play billing is not configured." }, { status: 404 });
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token || !await verifyPushToken(token, pushAudience(request))) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  const body = await request.json().catch(() => null) as PushBody | null;
  let notification: DeveloperNotification | null = null;
  try {
    notification = body?.message?.data ? JSON.parse(Buffer.from(body.message.data, "base64").toString("utf8")) as DeveloperNotification : null;
  } catch {
    notification = null;
  }
  // 読めない通知・テスト通知・購読以外の通知は受け取ったことにする（再送させても読めない）。
  const purchaseToken = notification?.subscriptionNotification?.purchaseToken;
  if (!purchaseToken) return NextResponse.json({ received: true });

  try {
    await syncPlayPurchase(purchaseToken);
  } catch (error) {
    console.error("Failed to sync Google Play subscription", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Sync failed." }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}
