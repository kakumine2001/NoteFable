import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { isGooglePlayConfigured, syncPlayPurchase } from "@/lib/google-play-billing";
import { requireEnv } from "@/lib/env";

// Google Play の Real-time developer notifications（Pub/Sub の push 購読の送り先）。
// 送り先の URL に ?token=<GOOGLE_PLAY_RTDN_TOKEN> を付けて登録し、合言葉が合うものだけ受ける。
// 通知の中身は購入トークンを知るためだけに使い、状態は毎回 Google から取り直す。写せなかったら 500 を返し、Pub/Sub に再送させる。
function tokenMatches(given: string | null) {
  if (!given) return false;
  const expected = Buffer.from(requireEnv("GOOGLE_PLAY_RTDN_TOKEN"));
  const actual = Buffer.from(given);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

type PushBody = { message?: { data?: string } };
type DeveloperNotification = { packageName?: string; subscriptionNotification?: { purchaseToken?: string } };

export async function POST(request: Request) {
  if (!isGooglePlayConfigured()) return NextResponse.json({ error: "Google Play billing is not configured." }, { status: 404 });
  if (!tokenMatches(new URL(request.url).searchParams.get("token"))) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

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
