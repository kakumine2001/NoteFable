import { NextRequest, NextResponse } from "next/server";
import { isGoogleLoginConfigured } from "@/lib/google-auth";
import { createNonce, isSameOrigin, NONCE_COOKIE, NONCE_MAX_AGE } from "@/lib/native-google-login";

// Android アプリの Google ログインを始める前に呼ぶ。使い捨ての nonce を返し、署名付きで Cookie にも持たせる。
export async function POST(request: NextRequest) {
  if (!isGoogleLoginConfigured()) return NextResponse.json({ error: "Google login is not configured." }, { status: 503 });
  if (!isSameOrigin(request.headers.get("origin"), request.headers.get("host"))) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const { nonce, cookieValue } = createNonce();
  const response = NextResponse.json({ nonce });
  response.cookies.set(NONCE_COOKIE, cookieValue, {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https",
    path: "/api/native-auth",
    maxAge: NONCE_MAX_AGE,
  });
  return response;
}
