import { NextRequest, NextResponse } from "next/server";
import { isAppleLoginConfigured } from "@/lib/apple-identity-config";
import { loginTimestamp } from "@/lib/login-time";
import { exchangeAppleCode, saveAppleAccount } from "@/lib/native-apple-login";
import { attachSessionCookie, createNonce, encodeSessionCookie, isSameOrigin, isSecureRequest, NONCE_MAX_AGE, readNonce } from "@/lib/native-google-login";

const nonceCookie = "notefable_native_apple_nonce";
const error = (status: number) => NextResponse.json({ ok: false }, { status });

export async function POST(request: NextRequest) {
  if (!isAppleLoginConfigured()) return error(503);
  if (!isSameOrigin(request.headers.get("origin"), request.headers.get("host"))) return error(403);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return error(415);
  const secure = isSecureRequest(request);
  const options = { httpOnly: true, sameSite: "lax" as const, secure, path: "/api/native-auth/apple" };
  const body = await request.json().catch(() => null) as { start?: unknown; code?: unknown; name?: unknown } | null;
  if (body?.start === true) {
    const { nonce, cookieValue } = createNonce();
    const response = NextResponse.json({ nonce }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(nonceCookie, cookieValue, { ...options, maxAge: NONCE_MAX_AGE });
    return response;
  }
  const clear = (response: NextResponse) => {
    response.cookies.set(nonceCookie, "", { ...options, maxAge: 0 });
    return response;
  };
  const nonce = readNonce(request.cookies.get(nonceCookie)?.value);
  if (!nonce || typeof body?.code !== "string" || !body.code || body.code.length > 4096) return clear(error(400));
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 100) || null : null;
  try {
    const signedInAt = loginTimestamp();
    const identity = await exchangeAppleCode(body.code, nonce, name);
    if (!identity) return clear(error(401));
    const cookie = await encodeSessionCookie({ appleSub: identity.appleSub, signedInAt }, secure);
    if (!(await saveAppleAccount(identity))) return clear(error(409));
    return attachSessionCookie(request, clear(NextResponse.json({ ok: true })), cookie, secure);
  } catch {
    return clear(error(502));
  }
}
