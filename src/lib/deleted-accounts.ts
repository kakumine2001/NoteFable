import { createHmac } from "crypto";
import { getCookieSecret } from "@/lib/env";
import { prisma } from "@/lib/prisma";

// 削除したアカウントの印（DeletedAccount）。ログイン Cookie は JWT でサーバーに記録が無いので、削除しても別の端末や
// 送信中のリクエストの Cookie はまだ有効なまま。それが同じ Google / メールの空のアカウントを作り直さないよう、
// 削除より前にログインした Cookie はここで無効とみなす。印は ID そのものではなく HMAC だけを持ち、400 日で消す。
export const DELETED_ACCOUNT_RETENTION_DAYS = 400;

type LoginId = { kind: "google"; sub: string } | { kind: "email"; email: string };

export function deletedAccountKey(id: LoginId) {
  const value = id.kind === "google" ? `google:${id.sub}` : `email:${id.email}`;
  return createHmac("sha256", getCookieSecret()).update(`deleted-account:${value}`).digest("base64url");
}

// 削除する利用者のログイン ID 全部（Google と確認済みメールの両方を持つこともある）。
export function deletedAccountKeys(user: { googleSub: string | null; verifiedEmail: string | null }) {
  const ids: LoginId[] = [];
  if (user.googleSub) ids.push({ kind: "google", sub: user.googleSub });
  if (user.verifiedEmail) ids.push({ kind: "email", email: user.verifiedEmail });
  return ids.map(deletedAccountKey);
}

// このログイン Cookie は削除済みのアカウントのものか。signedInAt（秒）が無い古い Cookie は、印があれば無効。
// 削除のあとに改めてログインした Cookie は新しい利用者として通す。
export async function isDeletedLogin(id: LoginId, signedInAt: number | null) {
  const row = await prisma.deletedAccount.findUnique({ where: { key: deletedAccountKey(id) } });
  if (!row) return false;
  return (signedInAt ?? 0) * 1000 < row.deletedAt.getTime();
}
