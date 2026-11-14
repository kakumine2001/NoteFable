// 確認済みメールの照合に使う形（前後の空白を除いて小文字）。メールログインの入力も Google のアドレスもこれで揃える。
// auth.ts と email-login.ts の両方が使う（この形が違うと同じ人が別の利用者に分かれる）。
export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

// Google のアドレスをメールログインの利用者とまとめてよいか。Google は Gmail と Workspace（ID トークンに hd がある）の
// アドレスだけを「そのアカウントのもの」と保証する。それ以外（Google アカウントに登録しただけの外部アドレス）は、
// email_verified が true でも、後でメールボックスの持ち主が変わっている場合があるので、まとめない。
export function isAuthoritativeGoogleEmail(email: string | null | undefined, emailVerified: unknown, hostedDomain: unknown) {
  if (!email || (emailVerified !== true && emailVerified !== "true")) return false;
  const address = normalizeEmail(email);
  if (address.endsWith("@gmail.com") || address.endsWith("@googlemail.com")) return true;
  return typeof hostedDomain === "string" && hostedDomain.length > 0 && address.endsWith(`@${hostedDomain.toLowerCase()}`);
}
