import { NextRequest, NextResponse } from "next/server";
import { createEmailSessionCookie, parseCode, parseEmail, verifyLoginCode } from "@/lib/email-login";
import { isEmailLoginConfigured } from "@/lib/google-auth";
import { msg } from "@/lib/i18n/translate";
import { isSameOrigin, sessionCookieName } from "@/lib/native-google-login";

function fail(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

// 確認コードが合えば、Google ログインと同じ形式のログイン Cookie を発行する。
// 利用者の行との紐付け（同じアドレスの人がいればその人、いなければこの端末の匿名データを引き継ぐ）は
// 次のリクエストで getOrCreateAnonymousUser が行う（Google ログインと同じ）。
export async function POST(request: NextRequest) {
  if (!isEmailLoginConfigured()) return fail(404, msg("Email sign-in is not enabled."));
  if (!isSameOrigin(request.headers.get("origin"), request.headers.get("host"))) return fail(403, "Forbidden.");

  const body = (await request.json().catch(() => null)) as { email?: unknown; code?: unknown } | null;
  const email = parseEmail(body?.email);
  const code = parseCode(body?.code);
  if (!email) return fail(400, msg("Enter a valid email address."));
  if (!code) return fail(400, msg("Enter the 6-digit code."));

  const result = await verifyLoginCode(email, code);
  if (result === "expired") return fail(400, msg("The code has expired. Request a new one."));
  if (result === "locked") return fail(400, msg("Too many wrong attempts. Request a new code."));
  if (result === "wrong") return fail(400, msg("That code is incorrect."));

  const secure = request.nextUrl.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
  const cookie = await createEmailSessionCookie(email, secure);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(cookie.name, cookie.value, { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: cookie.maxAge });
  // 以前の分割保存（authjs.session-token.0 など）が残っていると、新しい Cookie と連結されて読めなくなる。
  const base = sessionCookieName(secure);
  for (const { name } of request.cookies.getAll()) {
    if (name.startsWith(`${base}.`)) response.cookies.set(name, "", { httpOnly: true, secure, path: "/", maxAge: 0 });
  }
  return response;
}
