import { NextResponse } from "next/server";
import { optionalEnv } from "@/lib/env";
import { isGoogleLoginConfigured } from "@/lib/google-auth";

// サイドバーのアカウント表示用。Google ログインが未設定ならボタン自体を出さない。
export async function GET() {
  if (!isGoogleLoginConfigured()) {
    return NextResponse.json({ configured: false, user: null });
  }

  try {
    const { auth } = await import("@/lib/google-auth");
    const session = await auth();
    const user = session?.user?.id
      ? { name: session.user.name ?? null, email: session.user.email ?? null, image: session.user.image ?? null }
      : null;
    // googleClientId は公開しても問題ない値（ログイン画面の URL にも含まれる）。Android アプリの端末側ログインが使う。
    return NextResponse.json({ configured: true, user, googleClientId: optionalEnv("AUTH_GOOGLE_ID") ?? null });
  } catch {
    return NextResponse.json({ configured: false, user: null });
  }
}
