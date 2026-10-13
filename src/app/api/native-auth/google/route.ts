import { NextRequest, NextResponse } from "next/server";
import { isGoogleLoginConfigured } from "@/lib/google-auth";
import {
  createSessionCookie,
  GoogleVerificationUnavailableError,
  isSameOrigin,
  NONCE_COOKIE,
  readNonce,
  sessionCookieName,
  verifyGoogleIdToken,
} from "@/lib/native-google-login";

const MAX_TOKEN_LENGTH = 8192;

function fail(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

// Android アプリが端末側の Google ログインで得た ID トークンを受け取り、ログイン Cookie を発行する。
export async function POST(request: NextRequest) {
  if (!isGoogleLoginConfigured()) return fail(503, "Google login is not configured.");

  if (!isSameOrigin(request.headers.get("origin"), request.headers.get("host"))) return fail(403, "Forbidden.");
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return fail(415, "Send JSON.");
  }

  const body = (await request.json().catch(() => null)) as { idToken?: unknown } | null;
  const idToken = typeof body?.idToken === "string" ? body.idToken : "";
  if (!idToken || idToken.length > MAX_TOKEN_LENGTH) return fail(400, "idToken is required.");

  // nonce はログイン開始時にこの端末へ発行したもの。使い捨てなので、成否にかかわらずここで消す。
  const nonce = readNonce(request.cookies.get(NONCE_COOKIE)?.value);
  const secure = request.nextUrl.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
  const clearNonce = (response: NextResponse) => {
    response.cookies.set(NONCE_COOKIE, "", { httpOnly: true, sameSite: "lax", secure, path: "/api/native-auth", maxAge: 0 });
    return response;
  };
  if (!nonce) return clearNonce(fail(400, "Start the sign-in again."));

  let identity;
  try {
    identity = await verifyGoogleIdToken(idToken, nonce);
  } catch (error) {
    if (error instanceof GoogleVerificationUnavailableError) {
      return clearNonce(fail(503, "Google sign-in could not be checked right now. Try again."));
    }
    throw error;
  }
  if (!identity) return clearNonce(fail(401, "Google sign-in could not be verified."));

  let cookie;
  try {
    cookie = await createSessionCookie(identity, secure);
  } catch {
    return clearNonce(fail(500, "Could not start the session."));
  }
  const response = clearNonce(NextResponse.json({ ok: true }));
  response.cookies.set(cookie.name, cookie.value, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: cookie.maxAge,
  });

  // 以前の分割保存（authjs.session-token.0 など）が残っていると、新しい Cookie と連結されて読めなくなる。
  const base = sessionCookieName(secure);
  for (const { name } of request.cookies.getAll()) {
    if (name.startsWith(`${base}.`)) response.cookies.set(name, "", { httpOnly: true, secure, path: "/", maxAge: 0 });
  }
  return response;
}
