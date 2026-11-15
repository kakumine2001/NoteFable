import { deletedAccountKeys, DELETED_ACCOUNT_RETENTION_DAYS } from "@/lib/deleted-accounts";
import { prisma } from "@/lib/prisma";
import { deleteStoredImage, deleteStoredPrefix } from "@/lib/storage";
import { AVATAR_ROOT } from "@/lib/user-profile";

// 利用者ごとのフォルダ（保存先のパスに利用者 ID を含むもの）。チャットの画像だけは日付フォルダなので行から集める。
// 新しく利用者ごとのフォルダを作ったら、ここにも足す。
export function userStoragePrefixes(userId: string) {
  return [`note-files/${userId}/`, `page-covers/${userId}/`, `${AVATAR_ROOT}/${userId}/`, `chat-uploads/${userId}/`];
}

// アカウントを完全に削除する（Google Play のアカウント削除要件）。利用者の行を消すと、チャット・メッセージ・ノート・
// 履歴・グループ・プロジェクト・提案・表紙の記録は外部キーの onDelete: Cascade でまとめて消える。
// 同じトランザクションで削除の印（deleted-accounts.ts）を付ける。返す cleanup は保存したファイルを消す処理で、
// 応答を返したあとに呼ぶ（失敗しても行は戻さず、残ったパスを返す。行が無いのでもう誰からも読めない）。
export async function deleteAccount(user: { id: string; googleSub: string | null; verifiedEmail: string | null }) {
  const attachments = await prisma.attachment.findMany({
    where: { message: { session: { userId: user.id } }, imageStoragePath: { not: null } },
    select: { imageStoragePath: true },
  });
  const files = [...new Set(attachments.map((row) => row.imageStoragePath).filter((path): path is string => Boolean(path)))];
  const now = new Date();
  const expired = new Date(now.getTime() - DELETED_ACCOUNT_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  await prisma.$transaction([
    ...(user.verifiedEmail ? [prisma.emailLoginCode.deleteMany({ where: { email: user.verifiedEmail } })] : []),
    prisma.usageCounter.deleteMany({ where: { key: `user:${user.id}` } }),
    ...deletedAccountKeys(user).map((key) =>
      prisma.deletedAccount.upsert({ where: { key }, create: { key, deletedAt: now }, update: { deletedAt: now } })),
    prisma.deletedAccount.deleteMany({ where: { deletedAt: { lt: expired } } }),
    prisma.user.delete({ where: { id: user.id } }),
  ]);

  return {
    async cleanup() {
      const failed: string[] = [];
      for (let start = 0; start < files.length; start += 20) {
        await Promise.all(files.slice(start, start + 20).map((path) => deleteStoredImage(path).catch(() => { failed.push(path); })));
      }
      for (const prefix of userStoragePrefixes(user.id)) await deleteStoredPrefix(prefix).catch(() => { failed.push(prefix); });
      return failed;
    },
  };
}
