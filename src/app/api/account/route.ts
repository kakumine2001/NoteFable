import { NextResponse } from "next/server";
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
    return NextResponse.json({ configured: true, user });
  } catch {
    return NextResponse.json({ configured: false, user: null });
  }
}
