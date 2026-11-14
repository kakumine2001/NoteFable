// 確認済みメールの照合に使う形（前後の空白を除いて小文字）。メールログインの入力も Google のアドレスもこれで揃える。
// auth.ts と email-login.ts の両方が使う（この形が違うと同じ人が別の利用者に分かれる）。
export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}
