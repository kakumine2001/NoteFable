import { NextResponse } from "next/server";
import { currentAccountProfile, getOrCreateAnonymousUser, isAccountUser } from "@/lib/auth";
import { optionalEnv } from "@/lib/env";
import { isAccountLoginConfigured, isEmailLoginConfigured, isGoogleLoginConfigured } from "@/lib/google-auth";
import { prisma } from "@/lib/prisma";
import { deleteStoredImage } from "@/lib/storage";
import { parseProfilePatch, toAccountUser } from "@/lib/user-profile";
import { msg } from "@/lib/i18n/translate";

// サイドバーのアカウント / プロフィール表示用。どのログインも未設定ならボタン自体を出さない。
// google / email はそれぞれのログイン方法が使えるか（使えない方のボタンは出さない）。
export async function GET() {
  if (!isAccountLoginConfigured()) {
    return NextResponse.json({ configured: false, user: null });
  }
  const methods = { google: isGoogleLoginConfigured(), email: isEmailLoginConfigured() };

  try {
    const google = await currentAccountProfile();
    // googleClientId は公開しても問題ない値（ログイン画面の URL にも含まれる）。Android アプリの端末側ログインが使う。
    const googleClientId = methods.google ? (optionalEnv("AUTH_GOOGLE_ID") ?? null) : null;
    if (!google) return NextResponse.json({ configured: true, ...methods, user: null, googleClientId });

    // 自分で決めた表示名とアイコンは利用者の行に持つ。取れなくても Google の名前と写真で表示を続ける。
    const row = await getOrCreateAnonymousUser().catch(() => null);
    const user = toAccountUser({ displayName: row?.displayName ?? null, avatarIcon: row?.avatarIcon ?? null, avatarImage: row?.avatarImage ?? null }, google);
    return NextResponse.json({ configured: true, ...methods, user, googleClientId });
  } catch {
    return NextResponse.json({ configured: false, user: null });
  }
}

// 表示名と絵文字アイコンを変える。Google にログインしている本人だけ。null で Google の名前・写真に戻す。
export async function PATCH(request: Request) {
  if (!isAccountLoginConfigured()) {
    return NextResponse.json({ error: msg("Sign-in is not enabled.") }, { status: 404 });
  }

  let google;
  try {
    google = await currentAccountProfile();
  } catch {
    google = null;
  }
  if (!google) {
    return NextResponse.json({ error: msg("Sign in to edit your profile.") }, { status: 401 });
  }

  const parsed = parseProfilePatch(await request.json().catch(() => null));
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const row = await getOrCreateAnonymousUser();
  // 念のためアカウントに紐付いた行だけを更新する（匿名の行は変えない）。
  if (!isAccountUser(row)) {
    return NextResponse.json({ error: msg("Sign in to edit your profile.") }, { status: 401 });
  }

  // アイコン（絵文字）を選ぶ・Google の表示に戻すときは、アップロードした写真を外す（写真かアイコンのどちらか一方）。
  const replacesPhoto = "avatarIcon" in parsed.data;
  let updated;
  if (replacesPhoto) {
    // 読んだときの写真のままの場合だけ外す。別のタブが同時に新しい写真をアップロードしていたら、そちらを消さない。
    const result = await prisma.anonymousUser.updateMany({
      where: { id: row.id, avatarImage: row.avatarImage },
      data: { ...parsed.data, avatarImage: null },
    });
    if (!result.count) {
      return NextResponse.json({ error: msg("Your profile changed somewhere else. Try again.") }, { status: 409 });
    }
    updated = await prisma.anonymousUser.findUniqueOrThrow({ where: { id: row.id } });
    if (row.avatarImage) await deleteStoredImage(row.avatarImage).catch(() => {});
  } else {
    updated = await prisma.anonymousUser.update({ where: { id: row.id }, data: parsed.data });
  }
  return NextResponse.json({ user: toAccountUser(updated, google) });
}
