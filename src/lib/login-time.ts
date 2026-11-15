// ログイン Cookie を発行した時刻（秒）。Cookie に signedInAt として入れ、Auth.js が Cookie を更新しても変えない。
// 削除したアカウントの古い Cookie を見分けるのに使う（deleted-accounts.ts）。
export function loginTimestamp(now = Date.now()) {
  return Math.floor(now / 1000);
}
