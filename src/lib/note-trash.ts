import { prisma } from "@/lib/prisma";
import { TRASH_RETENTION_DAYS, type NoteTrashItem, type PageKind } from "@/types/notes";

// ノートのゴミ箱（deletedAt）。ゴミ箱のノートは通常の一覧・検索・AI ツール・編集には出さず、ゴミ箱の API だけが扱う。
// 画面側が同じ日数を使えるよう、定数の定義はサーバー依存のない @/types/notes にあり、ここから再公開する。
export { TRASH_RETENTION_DAYS };
export const TRASH_RETENTION_MS = TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;

// これより前に捨てたノートは復元できず、完全に削除される。復元（>= cutoff）と削除（< cutoff）で境目を共有する。
export const trashCutoff = (now = Date.now()) => new Date(now - TRASH_RETENTION_MS);
export const trashPurgeAt = (deletedAt: Date) => new Date(deletedAt.getTime() + TRASH_RETENTION_MS);

export function toTrashItem(row: { id: string; kind?: PageKind; title: string; icon: string | null; deletedAt: Date }): NoteTrashItem {
  return { id: row.id, kind: row.kind ?? "note", title: row.title, icon: row.icon, deletedAt: row.deletedAt.toISOString(), purgeAt: trashPurgeAt(row.deletedAt).toISOString() };
}

// 保持期間を過ぎた自分のノートを完全に削除する（履歴・プロジェクトの参照・ホワイトボードとスライドの本体は外部キーで一緒に消える。このノートで始めたチャットは残り、ノートとの結び付きだけが外れる）。
export async function purgeExpiredNotes(userId: string, now = Date.now()) {
  const result = await prisma.notePage.deleteMany({ where: { userId, deletedAt: { lt: trashCutoff(now) } } });
  return result.count;
}

// 掃除の失敗で、本来の操作（削除・一覧表示）を失敗させない。取り残しは次の機会に消える。
export async function tryPurgeExpiredNotes(userId: string) {
  try { return await purgeExpiredNotes(userId); }
  catch (error) { console.error("Could not purge expired trashed notes", error); return 0; }
}
