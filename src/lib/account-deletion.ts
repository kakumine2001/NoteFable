import type { Prisma } from "@/generated/prisma/client";
import { deletedAccountKeys, DELETED_ACCOUNT_RETENTION_DAYS } from "@/lib/deleted-accounts";
import { prisma } from "@/lib/prisma";
import { deleteStoredImage, deleteStoredPrefix } from "@/lib/storage";
import { AVATAR_ROOT } from "@/lib/user-profile";
import { APP_ICON_ROOT } from "@/lib/account-app-icon";

// 利用者ごとのフォルダ（保存先のパスに利用者 ID を含むもの）。チャットの画像だけは日付フォルダなので行から集める。
// 新しく利用者ごとのフォルダを作ったら、ここにも足す。
export function userStoragePrefixes(userId: string) {
  return [`note-files/${userId}/`, `page-covers/${userId}/`, `${AVATAR_ROOT}/${userId}/`, `chat-uploads/${userId}/`, `${APP_ICON_ROOT}/${userId}/`];
}

// アカウントを完全に削除する（Google Play のアカウント削除要件）。利用者の行を消すと、チャット・メッセージ・ノート・
// 履歴・グループ・プロジェクト・提案は外部キーの onDelete: Cascade でまとめて消える。ファイルの記録（StoredFile）は
// 削除中の印を付けて残し（持ち主は null になる）、ファイルを消せたら消す。
// 同じトランザクションで削除の印（deleted-accounts.ts）を付ける。返す cleanup は保存したファイルを消す処理で、
// 応答を返したあとに呼ぶ（失敗しても行は戻さず、残ったパスを返す。行が無いのでもう誰からも読めない）。
// tx を渡すと、その接続（呼び出し側のトランザクション）の中で消す（課金のロックの中で消すとき。接続を余分に取らない）。
export async function deleteAccount(user: { id: string; googleSub: string | null; verifiedEmail: string | null }, tx?: Prisma.TransactionClient) {
  const db = tx ?? prisma;
  const [attachments, stored] = await Promise.all([
    db.attachment.findMany({
      where: { message: { session: { userId: user.id } }, imageStoragePath: { not: null } },
      select: { imageStoragePath: true },
    }),
    // 記録のあるファイル（StoredFile）。行は利用者を消しても残り（持ち主が null になる）、消し終えたら消す。
    db.storedFile.findMany({ where: { userId: user.id }, select: { path: true } }),
  ]);
  const files = [...new Set([...attachments.map((row) => row.imageStoragePath), ...stored.map((row) => row.path)].filter((path): path is string => Boolean(path)))];
  const now = new Date();
  const expired = new Date(now.getTime() - DELETED_ACCOUNT_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const steps = (c: Prisma.TransactionClient | typeof prisma) => [
    // 消し損ねたファイルは、ファイルの後片付け（stored-files.ts）がやり直す。
    () => c.storedFile.updateMany({ where: { userId: user.id, deletingAt: null }, data: { releasedAt: now, deletingAt: now } }),
    ...(user.verifiedEmail ? [() => c.emailLoginCode.deleteMany({ where: { email: user.verifiedEmail! } })] : []),
    () => c.usageCounter.deleteMany({ where: { key: `user:${user.id}` } }),
    ...deletedAccountKeys(user).map((key) => () =>
      c.deletedAccount.upsert({ where: { key }, create: { key, deletedAt: now }, update: { deletedAt: now } })),
    () => c.deletedAccount.deleteMany({ where: { deletedAt: { lt: expired } } }),
    () => c.user.delete({ where: { id: user.id } }),
  ];
  if (tx) {
    for (const step of steps(tx)) await step();
  } else {
    await prisma.$transaction(steps(prisma).map((step) => step()) as Prisma.PrismaPromise<unknown>[]);
  }

  return {
    async cleanup() {
      const failed: string[] = [];
      const removed: string[] = [];
      for (let start = 0; start < files.length; start += 20) {
        await Promise.all(files.slice(start, start + 20).map((path) => deleteStoredImage(path).then(() => { removed.push(path); }, () => { failed.push(path); })));
      }
      for (const prefix of userStoragePrefixes(user.id)) await deleteStoredPrefix(prefix).catch(() => { failed.push(prefix); });
      // 消せたファイルの行を消す（残った行は後片付けがファイルを消してから消す）。
      for (let start = 0; start < removed.length; start += 500) {
        await prisma.storedFile.deleteMany({ where: { path: { in: removed.slice(start, start + 500) }, deletingAt: { not: null } } }).catch(() => {});
      }
      return failed;
    },
  };
}
