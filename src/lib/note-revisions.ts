import { Prisma } from "@/generated/prisma/client";
import { databaseSchema, prisma } from "@/lib/prisma";
import type { NoteRevisionDetail, NoteRevisionReason, NoteRevisionSummary } from "@/types/notes";

// ノートの編集履歴。保存のたびではなく、編集の合間に一定間隔で「変更される直前の状態」を残し、AI の編集案の適用と履歴からの復元でも直前の状態を残す。
// 1 ノートに残す件数には上限があり、古いものから消える。自動保存の履歴が AI 編集・復元の直前の履歴を押し出さないよう、上限は別々に持つ。

export const MAX_AUTO_REVISIONS_PER_NOTE = 30;
export const MAX_MARKED_REVISIONS_PER_NOTE = 20;
export const MAX_REVISIONS_PER_NOTE = MAX_AUTO_REVISIONS_PER_NOTE + MAX_MARKED_REVISIONS_PER_NOTE;
export const AUTO_REVISION_INTERVAL_MS = 10 * 60 * 1000;
// 自動保存の履歴は、件数が少なくても 90 日で消す（古い版を何年も抱えない）。
export const AUTO_REVISION_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

type RevisionClient = Pick<typeof prisma, "$executeRaw" | "$executeRawUnsafe" | "noteRevision">;

// 自動保存の直前に呼ぶ（PATCH と同じトランザクションの中で、更新より前）。
// 履歴は保存済みの行から DB 側で 1 文でコピーする。本文を一度アプリに読み込んで送り返さないので、自動保存が遅くならない。
// 条件に合わなければ何も入れない：
//  - 保存済みの版が、これから上書きする版と一致しない（版の競合や、応答だけ失われた保存の再送）
//  - ノートがゴミ箱にある、または本文が空
//  - 直前 10 分以内に自動保存の履歴がある
// FOR UPDATE で行を押さえ、同じ版を同時に保存する 2 つのリクエストが同じ履歴を二重に入れないようにする。
// 時刻は他の列と同じ UTC の時計（timestamp without time zone）で比べる。blocks は jsonb_typeof で配列と確かめてから比べ、式がエラーでトランザクションを壊さないようにする。
export function snapshotSql({ noteId, userId, version }: { noteId: string; userId: string; version: number }) {
  const schema = `"${databaseSchema}"`;
  const note = Prisma.raw(`${schema}."NotePage"`);
  const revision = Prisma.raw(`${schema}."NoteRevision"`);
  const reason = Prisma.raw(`'AUTO'::${schema}."NoteRevisionReason"`);
  const interval = Prisma.raw(`interval '${AUTO_REVISION_INTERVAL_MS / 1000} seconds'`);
  return Prisma.sql`
    INSERT INTO ${revision} ("id", "noteId", "userId", "reason", "title", "icon", "blocks", "version", "createdAt")
    SELECT gen_random_uuid()::text, p."id", p."userId", ${reason}, p."title", p."icon", p."blocks", p."version", (now() AT TIME ZONE 'UTC')
    FROM ${note} p
    WHERE p."id" = ${noteId} AND p."userId" = ${userId} AND p."version" = ${version} AND p."deletedAt" IS NULL
      AND jsonb_typeof(p."blocks") = 'array' AND p."blocks" <> '[]'::jsonb
      AND NOT EXISTS (
        SELECT 1 FROM ${revision} r
        WHERE r."noteId" = p."id" AND r."reason" = ${reason} AND r."createdAt" > (now() AT TIME ZONE 'UTC') - ${interval}
      )
    FOR UPDATE OF p`;
}

// 自動保存の履歴は新しい順に 30 件、AI 編集・復元の直前の履歴は新しい順に 20 件だけ残し、自動保存は 90 日を過ぎたものも消す。
async function pruneRevisions(tx: RevisionClient, noteId: string, userId: string) {
  const newestFirst = [{ createdAt: "desc" as const }, { id: "desc" as const }];
  const staleAuto = await tx.noteRevision.findMany({
    where: { noteId, userId, reason: "AUTO" }, orderBy: newestFirst, skip: MAX_AUTO_REVISIONS_PER_NOTE, select: { id: true },
  });
  const staleMarked = await tx.noteRevision.findMany({
    where: { noteId, userId, reason: { not: "AUTO" } }, orderBy: newestFirst, skip: MAX_MARKED_REVISIONS_PER_NOTE, select: { id: true },
  });
  const stale = [...staleAuto, ...staleMarked];
  if (stale.length) await tx.noteRevision.deleteMany({ where: { id: { in: stale.map((row) => row.id) }, noteId, userId } });
  await tx.noteRevision.deleteMany({ where: { noteId, userId, reason: "AUTO", createdAt: { lt: new Date(Date.now() - AUTO_REVISION_MAX_AGE_MS) } } });
}

// 履歴を入れたら true。
// 履歴の保存は自動保存の「おまけ」なので、失敗しても保存そのものを巻き込まない。失敗した文は Postgres のトランザクション全体を使えなくするため、SAVEPOINT で閉じ込めて戻す。
export async function snapshotBeforeSave(tx: RevisionClient, input: { noteId: string; userId: string; version: number }) {
  try {
    await tx.$executeRawUnsafe("SAVEPOINT note_snapshot");
    const inserted = await tx.$executeRaw(snapshotSql(input));
    if (inserted) await pruneRevisions(tx, input.noteId, input.userId);
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT note_snapshot");
    return Boolean(inserted);
  } catch (error) {
    console.error("Failed to save a note revision", error);
    // SAVEPOINT の前で失敗した（トランザクション自体が壊れている）ときは戻せないので、そのまま呼び出し元の次の文に任せる。
    try { await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT note_snapshot"); } catch { /* 戻せない状態なら、後続の更新が失敗として扱う。 */ }
    return false;
  }
}

// AI の編集案の適用・履歴からの復元の直前に、その時点の状態を残す（呼び出し側のトランザクションの中で。巻き戻されれば履歴も消える）。
export async function createRevision(tx: RevisionClient, input: {
  noteId: string; userId: string; reason: NoteRevisionReason; title: string; icon: string | null; blocks: unknown; version: number;
}) {
  await tx.noteRevision.create({
    data: {
      noteId: input.noteId, userId: input.userId, reason: input.reason, title: input.title, icon: input.icon,
      blocks: input.blocks as Prisma.InputJsonValue, version: input.version,
    },
  });
  await pruneRevisions(tx, input.noteId, input.userId);
}

export const REVISION_SUMMARY_SELECT = { id: true, reason: true, title: true, version: true, createdAt: true } as const;

export function toRevisionSummary(row: { id: string; reason: NoteRevisionReason; title: string; version: number; createdAt: Date }): NoteRevisionSummary {
  return { id: row.id, reason: row.reason, title: row.title, version: row.version, createdAt: row.createdAt.toISOString() };
}

export function toRevisionDetail(row: { id: string; reason: NoteRevisionReason; title: string; icon: string | null; blocks: unknown; version: number; createdAt: Date }): NoteRevisionDetail {
  return { ...toRevisionSummary(row), icon: row.icon, blocks: row.blocks as NoteRevisionDetail["blocks"] };
}
