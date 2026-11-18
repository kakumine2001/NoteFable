import { NextRequest, NextResponse } from "next/server";
import { createLoginCode, discardCode, EmailSendError, emailLocale, parseEmail, sendLoginEmail } from "@/lib/email-login";
import { isEmailLoginConfigured } from "@/lib/google-auth";
import { msg } from "@/lib/i18n/translate";
import { isSameOrigin } from "@/lib/native-google-login";
import { clientNetworkKey } from "@/lib/usage-limits";

function fail(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

// メールアドレスに 6 桁の確認コードを送る。アドレスが登録済みかどうかは返事から分からないようにする（同じ返事）。
export async function POST(request: NextRequest) {
  if (!isEmailLoginConfigured()) return fail(404, msg("Email sign-in is not enabled."));
  if (!isSameOrigin(request.headers.get("origin"), request.headers.get("host"))) return fail(403, msg("Forbidden."));

  const body = (await request.json().catch(() => null)) as { email?: unknown; locale?: unknown } | null;
  const email = parseEmail(body?.email);
  if (!email) return fail(400, msg("Enter a valid email address."));

  const created = await createLoginCode(email, clientNetworkKey(request));
  if (!created.ok) {
    return fail(429, created.reason === "too-soon"
      ? msg("Wait a minute before requesting another code.")
      : msg("Too many codes requested. Try again later."));
  }

  try {
    await sendLoginEmail(email, created.code, emailLocale(body?.locale));
  } catch (error) {
    await discardCode(created.id);
    if (error instanceof EmailSendError) return fail(502, msg("Could not send the email. Try again."));
    throw error;
  }
  return NextResponse.json({ ok: true });
}
