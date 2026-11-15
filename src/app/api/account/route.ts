import { after, NextResponse, type NextRequest } from "next/server";
import { deleteAccount } from "@/lib/account-deletion";
import { currentAccountProfile, getOrCreateUser, isAccountUser } from "@/lib/auth";
import { isSameOrigin, isSecureRequest } from "@/lib/native-google-login";
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
    const row = await getOrCreateUser().catch(() => null);
    // 削除したアカウントの古いログイン Cookie（deleted-accounts.ts）は匿名の行になる。ログインしていない表示にする。
    if (row && !isAccountUser(row)) return NextResponse.json({ configured: true, ...methods, user: null, googleClientId });
    // 行を読めなかったときは表示言語を返さない（null を返すと「未選択」と区別できず、ブラウザの選択で上書きされる）。
    const user = toAccountUser({ displayName: row?.displayName ?? null, avatarIcon: row?.avatarIcon ?? null, avatarImage: row?.avatarImage ?? null, locale: row ? row.locale : undefined }, google);
    return NextResponse.json({ configured: true, ...methods, user, googleClientId });
  } catch {
    return NextResponse.json({ configured: false, user: null });
  }
}

// 表示名・絵文字アイコン・表示言語を変える。Google にログインしている本人だけ。null で Google の名前・写真に戻す。
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

  const row = await getOrCreateUser();
  // 念のためアカウントに紐付いた行だけを更新する（匿名の行は変えない）。
  if (!isAccountUser(row)) {
    return NextResponse.json({ error: msg("Sign in to edit your profile.") }, { status: 401 });
  }

  // アイコン（絵文字）を選ぶ・Google の表示に戻すときは、アップロードした写真を外す（写真かアイコンのどちらか一方）。
  const replacesPhoto = "avatarIcon" in parsed.data;
  let updated;
  if (replacesPhoto) {
    // 読んだときの写真のままの場合だけ外す。別のタブが同時に新しい写真をアップロードしていたら、そちらを消さない。
    const result = await prisma.user.updateMany({
      where: { id: row.id, avatarImage: row.avatarImage },
      data: { ...parsed.data, avatarImage: null },
    });
    if (!result.count) {
      return NextResponse.json({ error: msg("Your profile changed somewhere else. Try again.") }, { status: 409 });
    }
    updated = await prisma.user.findUniqueOrThrow({ where: { id: row.id } });
    if (row.avatarImage) await deleteStoredImage(row.avatarImage).catch(() => {});
  } else {
    updated = await prisma.user.update({ where: { id: row.id }, data: parsed.data });
  }
  return NextResponse.json({ user: toAccountUser(updated, google) });
}

// アカウントを完全に削除する（設定の「アカウントを削除」、Google Play のアカウント削除要件）。ログインしている本人だけ。
// 消した後はログインと端末の Cookie も消す。残すと、次のリクエストで同じ Google / メールの空のアカウントがすぐ作り直される。
// ネイティブアプリの要求は Origin を付けないので通す（isSameOrigin）。
export async function DELETE(request: NextRequest) {
  if (!isAccountLoginConfigured()) {
    return NextResponse.json({ error: msg("Sign-in is not enabled.") }, { status: 404 });
  }
  if (!isSameOrigin(request.headers.get("origin"), request.headers.get("host"))) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const google = await currentAccountProfile().catch(() => null);
  if (!google) {
    return NextResponse.json({ error: msg("Sign in to delete your account.") }, { status: 401 });
  }
  const row = await getOrCreateUser();
  if (!isAccountUser(row)) {
    return NextResponse.json({ error: msg("Sign in to delete your account.") }, { status: 401 });
  }

  const { cleanup } = await deleteAccount(row);
  // ファイルは応答のあとに消す（多いと時間がかかり、行を消したのに応答が届かないと画面が失敗と表示するため）。
  after(async () => {
    const failed = await cleanup();
    if (failed.length) console.error(`Account ${row.id} deleted; could not remove stored files: ${failed.join(", ")}`);
  });

  // ログイン Cookie を消す。端末の Cookie（notefable_device）は残す: 別の匿名の行を指していることがあり、
  // 消すとその端末のログイン前のデータに戻れなくなる。消したアカウントの行を指していれば、次の要求で新しい匿名の行になる。
  const response = NextResponse.json({ deleted: true });
  const secure = isSecureRequest(request);
  for (const { name } of request.cookies.getAll()) {
    if (/^(__Secure-|__Host-)?authjs\./.test(name)) {
      response.cookies.set(name, "", { httpOnly: true, secure: secure || name.startsWith("__"), path: "/", maxAge: 0 });
    }
  }
  return response;
}
