import { prisma } from "@/lib/prisma";
import { deleteStoredImage, deleteStoredPrefix } from "@/lib/storage";
import { AVATAR_ROOT } from "@/lib/user-profile";

// 利用者ごとのフォルダ（保存先のパスに利用者 ID を含むもの）。チャットの画像だけは日付フォルダなので行から集める。
export function userStoragePrefixes(userId: string) {
  return [`note-files/${userId}/`, `page-covers/${userId}/`, `${AVATAR_ROOT}/${userId}/`];
}

// アカウントを完全に削除する（Google Play のアカウント削除要件）。利用者の行を消すと、チャット・メッセージ・ノート・
// 履歴・グループ・プロジェクト・提案・表紙の記録は外部キーの onDelete: Cascade でまとめて消える。
// 保存したファイルは行を消した後に消す（失敗しても行は戻さず、残ったパスを返す。行が無いのでもう誰からも読めない）。
export async function deleteAccount(user: { id: string; verifiedEmail: string | null; avatarImage: string | null }) {
  const attachments = await prisma.attachment.findMany({
    where: { message: { session: { userId: user.id } }, imageStoragePath: { not: null } },
    select: { imageStoragePath: true },
  });
  const files = new Set(attachments.map((row) => row.imageStoragePath).filter((path): path is string => Boolean(path)));
  if (user.avatarImage) files.add(user.avatarImage);

  await prisma.$transaction([
    ...(user.verifiedEmail ? [prisma.emailLoginCode.deleteMany({ where: { email: user.verifiedEmail } })] : []),
    prisma.usageCounter.deleteMany({ where: { key: `user:${user.id}` } }),
    prisma.user.delete({ where: { id: user.id } }),
  ]);

  const failed: string[] = [];
  const paths = [...files];
  for (let start = 0; start < paths.length; start += 20) {
    await Promise.all(paths.slice(start, start + 20).map((path) => deleteStoredImage(path).catch(() => { failed.push(path); })));
  }
  for (const prefix of userStoragePrefixes(user.id)) await deleteStoredPrefix(prefix).catch(() => { failed.push(prefix); });
  return { failed };
}
