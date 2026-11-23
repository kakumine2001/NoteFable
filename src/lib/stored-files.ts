import { after } from "next/server";
import { Prisma, type StoredFileKind } from "@/generated/prisma/client";
import { APP_ICON_ROOT } from "@/lib/account-app-icon";
import { msg } from "@/lib/i18n/translate";
import { noteFilePaths } from "@/lib/note-files";
import { databaseSchema, prisma } from "@/lib/prisma";
import { deleteStoredImage, listStoredFiles, sharesForeignStorage, writeStoredImageAt, type StoredFileListing } from "@/lib/storage";
import { usageTier } from "@/lib/usage-limits";
import { STORAGE_LIMITS, STORAGE_LIMIT_CODE, StorageLimitError, type UsageTier } from "@/lib/usage-plans";
import { AVATAR_ROOT } from "@/lib/user-profile";

// ファイル置き場（Private Vercel Blob、ローカル開発は NOTEFABLE_STORAGE_DIR）のファイルを StoredFile の行で記録する。
// 1. 容量の上限: 利用者ごとに行の size を足して数え、新しいファイルの前に空きを確かめる（usage-plans.ts の STORAGE_LIMITS）。
// 2. 後片付け: どこからも参照されなくなったファイルを、猶予（FILE_GRACE_MS）のあとで消す（collectUnusedFiles）。
// ファイルは必ず「行を作ってから書く」。書く前に落ちても行だけが残り（参照がないので後片付けが消す）、記録のないファイルは生まれない。
// 新しい種類のファイル（ホワイトボードやスライドの画像など）を置くときは、StoredFileKind に種類を足し、
// STORED_FILE_PREFIXES に保存先、REFERENCE_CHECKS（ノートと同じ参照の仕方なら NOTE_FILE_SOURCES）に参照の調べ方を足す。
// 置くときは storeFile、保存のたびに使用中へ戻すのは claimStoredFiles を使う。docs/architecture/database.md の StoredFile。

export type StorageOwner = { id: string; googleSub: string | null; verifiedEmail?: string | null; plan?: string | null };
type Db = Prisma.TransactionClient | typeof prisma;

// 種類ごとの保存先（"/" で終わるフォルダ）。ファイル置き場の棚卸しはこのフォルダを見る。
export const STORED_FILE_PREFIXES: Record<StoredFileKind, string> = {
  NOTE_FILE: "note-files/",
  NOTE_COVER: "page-covers/",
  CHAT_IMAGE: "images/",
  AVATAR: `${AVATAR_ROOT}/`,
  APP_ICON: `${APP_ICON_ROOT}/`,
};
const KINDS = Object.keys(STORED_FILE_PREFIXES) as StoredFileKind[];
// 保存先のパスに持ち主の ID が入っている種類（"<フォルダ>/<利用者 ID>/..."）。チャットの画像だけは日付のフォルダ。
const USER_FOLDER_KINDS = new Set<StoredFileKind>(["NOTE_FILE", "NOTE_COVER", "AVATAR", "APP_ICON"]);

// 参照されなくなってから消すまでの猶予。別のタブの下書きや、競合時の「新しいページとして保存」が、
// 置き換える前のファイルをまだ使えるようにする。
export const FILE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

// ---------- 容量の上限 ----------

export function storageLimitFor(owner: Pick<StorageOwner, "googleSub" | "verifiedEmail" | "plan">): { tier: UsageTier; limit: number } {
  const tier = usageTier(owner);
  return { tier, limit: STORAGE_LIMITS[tier] };
}

// 使っている容量（バイト）。削除を始めたファイルは数えない。大きさの分からない古い行は 0 として数える。
export async function storageUsed(userId: string, db: Db = prisma) {
  const rows = await db.$queryRaw<{ used: bigint | number | null }[]>(Prisma.sql`
    SELECT COALESCE(SUM("size"), 0)::bigint AS used FROM ${Prisma.raw(`"${databaseSchema}"."StoredFile"`)}
    WHERE "userId" = ${userId} AND "deletingAt" IS NULL
  `);
  return Number(rows[0]?.used ?? 0);
}

// 設定の「プラン」に出す使用量。
export async function storageSummary(owner: StorageOwner) {
  const { limit } = storageLimitFor(owner);
  return { used: await storageUsed(owner.id), limit };
}

// 上限で断るときの文。アップグレードの案内は各画面が出す（サーバーの文では勧めない。未ログインにはログインを勧める）。
export function storageLimitMessage(tier: UsageTier) {
  return tier === "guest"
    ? msg("There isn't enough storage space left. Sign in for more space, or delete files you no longer need.")
    : msg("There isn't enough storage space left. Delete files you no longer need to free up space.");
}

// 413 { error, code: "storage_limit", tier, used, limit }。画面は code と tier を見て、ログインやアップグレードを勧める。
export function storageLimitResponse(error: StorageLimitError) {
  return Response.json({ error: error.message, code: STORAGE_LIMIT_CODE, tier: error.tier, used: error.used, limit: error.limit }, { status: 413 });
}

const limitError = (tier: UsageTier, used: number, limit: number) => new StorageLimitError(storageLimitMessage(tier), tier, used, limit);

async function ownerRow(owner: StorageOwner | string): Promise<StorageOwner> {
  if (typeof owner !== "string") return owner;
  const row = await prisma.user.findUnique({ where: { id: owner }, select: { id: true, googleSub: true, verifiedEmail: true, plan: true } });
  if (!row) throw new Error("Storage owner not found.");
  return row;
}

// 空きを確かめるだけ（行は作らない）。これから受け取るバイト数が入るか。0 は「大きさがまだ分からないもの（これから作る画像）」で、
// 上限に達していなければ通す。アップロードを受け取る前や、生成を始める前に断るために使う。最後の確認は storeFile がする。
export async function assertStorageRoom(owner: StorageOwner | string, incomingBytes: number) {
  const row = await ownerRow(owner);
  const { tier, limit } = storageLimitFor(row);
  const used = await storageUsed(row.id);
  if (used + incomingBytes > limit || used >= limit) throw limitError(tier, used, limit);
}

// 空きを確かめて、ファイルの行を作る。同じ利用者の同時のアップロードは 1 つずつ数える（合わせて上限を超えないように）。
// enforce: false は上限を確かめない（生成し終えた画像や、1 枚を置き換えるだけのプロフィール画像。費用はもう掛かっている）。
export async function reserveStoredFile(owner: StorageOwner | string, file: { path: string; kind: StoredFileKind; size: number }, { enforce = true } = {}) {
  const row = await ownerRow(owner);
  const { tier, limit } = storageLimitFor(row);
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`notefable-storage:${row.id}`}))`);
    if (enforce) {
      const used = await storageUsed(row.id, tx);
      if (used + file.size > limit) throw limitError(tier, used, limit);
    }
    // アップロードの直後は、まだどこからも参照されていない。参照が付けば保存の処理か後片付けが使用中に戻す。
    await tx.storedFile.create({ data: { path: file.path, userId: row.id, kind: file.kind, size: file.size, releasedAt: new Date() } });
  });
}

// 空きを確かめて記録し、ファイルを書く。上限なら StorageLimitError。書けなかったら行を「削除中」にして（後片付けが片付ける）投げ直す。
export async function storeFile(owner: StorageOwner | string, file: { path: string; kind: StoredFileKind; buffer: Buffer; mimeType: string }, options?: { enforce?: boolean }) {
  await reserveStoredFile(owner, { path: file.path, kind: file.kind, size: file.buffer.byteLength }, options);
  try {
    return await writeStoredImageAt(file.path, file.buffer, file.mimeType);
  } catch (error) {
    const now = new Date();
    await prisma.storedFile.updateMany({ where: { path: file.path }, data: { releasedAt: now, deletingAt: now } }).catch(() => {});
    throw error;
  }
}

// 置いたのに使わなかったファイル（DB に保存する前に失敗した添付）や、置き換えた古いプロフィール画像を消す。
// ファイルを消してから行を消す。消せなかったものは「削除中」のまま残し、後片付けがやり直す。
export async function discardStoredFiles(paths: string[]) {
  const unique = [...new Set(paths.filter(Boolean))];
  if (!unique.length) return;
  const now = new Date();
  await prisma.storedFile.updateMany({ where: { path: { in: unique }, deletingAt: null }, data: { releasedAt: now, deletingAt: now } }).catch(() => {});
  for (const path of unique) {
    try {
      await deleteStoredImage(path);
      await prisma.storedFile.deleteMany({ where: { path } });
    } catch (error) {
      console.error("Failed to delete a stored file; the cleanup will retry", error instanceof Error ? error.message : error);
    }
  }
}

// ---------- 参照を付けるとき ----------

// ページのカバー・アイコンを保存する処理の中で呼ぶ（同じトランザクション）。行を「使用中」に戻す。
// 後片付けがすでに削除を始めていた（または行がない）なら false（呼び出し側が保存を断り、消える画像を参照させない）。
export async function claimStoredFile(tx: Db, path: string, userId: string) {
  const claimed = await tx.storedFile.updateMany({ where: { path, userId, deletingAt: null }, data: { releasedAt: null } });
  return claimed.count > 0;
}

// ノートの本文に入ったファイルを、保存の処理の中で「使用中」に戻す（参照が付いたので猶予の数え直しを止める）。
// 行を書き換えるのは参照がないとされていたものだけ。消えかけ・記録のないファイルは何もしない（保存は止めない）。
export async function claimStoredFiles(tx: Db, paths: string[], userId: string) {
  const unique = [...new Set(paths)];
  if (!unique.length) return;
  await tx.storedFile.updateMany({ where: { path: { in: unique }, userId, deletingAt: null, releasedAt: { not: null } }, data: { releasedAt: null } });
}

// 保存するノートの本文に入っている自分のファイルを、同じトランザクションで「使用中」に戻す（後片付けに消させない）。
// assertNoteFilesOwner を通したあとで呼ぶ。見つからない・消えかけのファイルがあっても保存は止めない。
export async function claimNoteFiles(tx: Db, blocks: unknown, userId: string) {
  await claimStoredFiles(tx, noteFilePaths(blocks), userId);
}

// ---------- 参照の確認 ----------

type Candidate = { path: string; userId: string | null; kind: StoredFileKind };

const table = (name: string) => Prisma.raw(`"${databaseSchema}"."${name}"`);

// ノートのファイルの URL（/api/pages/files?key=note-files%2F<利用者>%2F<UUID>.<拡張子>）に入る UUID。
// 本文の JSON を文字列として探す（エンコードの有無・大文字小文字を問わない）。UUID はファイルごとに違うので取り違えない。
export const NOTE_FILE_REFERENCE = "note-files(?:%2F|/)[a-z0-9]{1,64}(?:%2F|/)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})";
const NOTE_FILE_ID = /^note-files\/[a-z0-9]{1,64}\/([0-9a-f-]{36})\./;

// ノートのファイルを参照しうる場所（持ち主の行だけを見る。ゴミ箱のノートと編集履歴も、復元で戻るので参照に数える）。
// 白板やスライドなど、別の表にファイルの URL を持つ内容を足したら、ここにその表を足す。
export const NOTE_FILE_SOURCES: ((userId: string) => Prisma.Sql)[] = [
  (userId) => Prisma.sql`SELECT "blocks"::text AS body FROM ${table("NotePage")} WHERE "userId" = ${userId}`,
  (userId) => Prisma.sql`SELECT "blocks"::text AS body FROM ${table("NoteRevision")} WHERE "userId" = ${userId}`,
  // 適用を待っている AI の提案（チャットの画像をノート用にコピーしたもの）。適用・破棄したものは数えない。
  (userId) => Prisma.sql`SELECT "payload"::text AS body FROM ${table("NoteProposal")} WHERE "userId" = ${userId} AND "status" = 'PENDING'`,
];

async function noteFileReferences(candidates: Candidate[]) {
  const found = new Set<string>();
  const byUser = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    if (!candidate.userId) continue;
    byUser.set(candidate.userId, [...(byUser.get(candidate.userId) ?? []), candidate]);
  }
  for (const [userId, files] of byUser) {
    const sources = Prisma.join(NOTE_FILE_SOURCES.map((source) => source(userId)), " UNION ALL ");
    const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT DISTINCT lower(m[1]) AS id FROM (
        SELECT regexp_matches(s.body, ${NOTE_FILE_REFERENCE}, 'gi') AS m FROM (${sources}) s
      ) found
    `);
    const ids = new Set(rows.map((row) => row.id));
    for (const file of files) {
      const id = NOTE_FILE_ID.exec(file.path)?.[1];
      if (id && ids.has(id.toLowerCase())) found.add(file.path);
    }
  }
  return found;
}

async function coverReferences(candidates: Candidate[]) {
  // ページのアイコンにも同じ形の画像を使う。編集履歴のアイコンも、復元で使えるよう参照として数える。
  const keys = candidates.map((candidate) => `upload:${candidate.path}`);
  const [pages, revisions] = await Promise.all([
    prisma.notePage.findMany({ where: { OR: [{ cover: { in: keys } }, { icon: { in: keys } }] }, select: { cover: true, icon: true } }),
    prisma.noteRevision.findMany({ where: { icon: { in: keys } }, select: { icon: true } }),
  ]);
  const found = new Set<string>();
  for (const value of [...pages.flatMap((page) => [page.cover, page.icon]), ...revisions.map((revision) => revision.icon)]) {
    if (value && keys.includes(value)) found.add(value.slice("upload:".length));
  }
  return found;
}

async function chatImageReferences(candidates: Candidate[]) {
  // 版の切り替えで戻せる（表示していない）発言の添付も参照に数える。会話を消すと添付の行が消える。
  const rows = await prisma.attachment.findMany({
    where: { imageStoragePath: { in: candidates.map((candidate) => candidate.path) } },
    select: { imageStoragePath: true }, distinct: ["imageStoragePath"],
  });
  return new Set(rows.map((row) => row.imageStoragePath).filter((path): path is string => Boolean(path)));
}

function userColumnReferences(column: "avatarImage" | "appIconImage") {
  return async (candidates: Candidate[]) => {
    const ids = [...new Set(candidates.map((candidate) => candidate.userId).filter((id): id is string => Boolean(id)))];
    if (!ids.length) return new Set<string>();
    const rows = await prisma.user.findMany({ where: { id: { in: ids } }, select: { avatarImage: true, appIconImage: true } });
    return new Set(rows.map((row) => row[column]).filter((path): path is string => Boolean(path)));
  };
}

const REFERENCE_CHECKS: Record<StoredFileKind, (candidates: Candidate[]) => Promise<Set<string>>> = {
  NOTE_FILE: noteFileReferences,
  NOTE_COVER: coverReferences,
  CHAT_IMAGE: chatImageReferences,
  AVATAR: userColumnReferences("avatarImage"),
  APP_ICON: userColumnReferences("appIconImage"),
};

// 候補のうち、どこかから参照されているもののパス。持ち主のいない（アカウントを消した）ファイルは参照なし。
export async function referencedPaths(candidates: Candidate[]) {
  const found = new Set<string>();
  for (const kind of KINDS) {
    const group = candidates.filter((candidate) => candidate.kind === kind && candidate.userId);
    if (!group.length) continue;
    const paths = new Set(group.map((candidate) => candidate.path));
    for (const path of await REFERENCE_CHECKS[kind](group)) {
      if (paths.has(path)) found.add(path);
    }
  }
  return found;
}

// ---------- 後片付け ----------

const SCAN_PAGE = 500;
const SCAN_PAGES = 4;
const CLEANUP_LIMIT = 200;

// どこからも参照されなくなったファイルを消す。ページの保存と同じ行を取り合って決めるので、消えるファイルを参照するページは残らない。
// 1. 使用中の行を、確かめたのが古い順に巡回し、参照がなければ解放の時刻を記録する（猶予はここから数える）。
//    記録したあとにもう一度確かめ、同時に付いた参照があれば使用中に戻す。
// 2. 猶予を過ぎても参照がないものを「削除中」にする。保存（claim）が先なら条件が外れて消さず、こちらが先なら保存の確保が失敗する。
// 3. 削除中のファイルを消し、消せたら行を消す。失敗したものは次の実行でやり直す。
// deadline を過ぎたら、その段階で区切る（続きは次の実行）。
export async function collectUnusedFiles(now = Date.now(), deadline = Number.POSITIVE_INFINITY) {
  const nowDate = new Date(now);
  const select = { path: true, userId: true, kind: true } as const;

  // 持ち主がいない（アカウントを消した）ファイルは猶予なしで消す。アカウントの削除が消し損ねた分もここで拾う。
  await prisma.storedFile.updateMany({ where: { userId: null, deletingAt: null }, data: { releasedAt: nowDate, deletingAt: nowDate } });

  let released = 0;
  for (let page = 0; page < SCAN_PAGES && Date.now() < deadline; page += 1) {
    const held = await prisma.storedFile.findMany({
      where: { releasedAt: null, deletingAt: null, OR: [{ checkedAt: null }, { checkedAt: { lt: nowDate } }] },
      select, orderBy: [{ checkedAt: { sort: "asc", nulls: "first" } }, { path: "asc" }], take: SCAN_PAGE,
    });
    if (!held.length) break;
    await prisma.storedFile.updateMany({ where: { path: { in: held.map((file) => file.path) } }, data: { checkedAt: nowDate } });
    const referenced = await referencedPaths(held);
    const unused = held.filter((file) => !referenced.has(file.path));
    if (unused.length) {
      const marked = await prisma.storedFile.updateMany({ where: { path: { in: unused.map((file) => file.path) }, releasedAt: null, deletingAt: null }, data: { releasedAt: nowDate } });
      const reclaimed = [...await referencedPaths(unused)];
      if (reclaimed.length) await prisma.storedFile.updateMany({ where: { path: { in: reclaimed }, deletingAt: null }, data: { releasedAt: null } });
      released += Math.max(0, marked.count - reclaimed.length);
    }
    if (held.length < SCAN_PAGE) break;
  }

  const cutoff = new Date(now - FILE_GRACE_MS);
  let started = 0;
  if (Date.now() < deadline) {
    const expired = await prisma.storedFile.findMany({
      where: { releasedAt: { lt: cutoff }, deletingAt: null }, select, orderBy: { releasedAt: "asc" }, take: CLEANUP_LIMIT,
    });
    const stillUsed = await referencedPaths(expired);
    for (const { path } of expired) {
      if (stillUsed.has(path)) {
        await prisma.storedFile.updateMany({ where: { path, deletingAt: null }, data: { releasedAt: null } });
        continue;
      }
      started += (await prisma.storedFile.updateMany({ where: { path, releasedAt: { lt: cutoff }, deletingAt: null }, data: { deletingAt: nowDate } })).count;
    }
  }

  let deleted = 0;
  if (Date.now() < deadline) {
    const deleting = await prisma.storedFile.findMany({ where: { deletingAt: { not: null } }, select: { path: true }, orderBy: { deletingAt: "asc" }, take: CLEANUP_LIMIT });
    for (const { path } of deleting) {
      if (Date.now() >= deadline) break;
      try {
        await deleteStoredImage(path);
        await prisma.storedFile.deleteMany({ where: { path, deletingAt: { not: null } } });
        deleted += 1;
      } catch (error) {
        console.error("Failed to delete a stored file", error instanceof Error ? error.message : error);
      }
    }
  }
  return { released, started, deleted };
}

// ---------- 棚卸し ----------

// この表より前から置き場にある（記録のない）ファイルを記録に加え、大きさの分からない行に大きさを補う。
// 持ち主がこの DB で分かるものだけを加える（利用者のフォルダならその利用者がいる、チャットの画像ならこの DB の添付が指している）。
// 別の環境が同じ置き場に置いたファイルには触れない。加えたファイルは参照がまだ確かめられていないので、猶予の数えから始める
// （参照があれば猶予が切れたときの確認で使用中に戻り、なければ消える）。
export type InventoryState = { index: number; cursor?: string; finishedAt?: string };

async function ownersOf(kind: StoredFileKind, files: StoredFileListing[]) {
  const owners = new Map<string, string>();
  if (USER_FOLDER_KINDS.has(kind)) {
    const prefix = STORED_FILE_PREFIXES[kind];
    const idOf = (path: string) => /^([a-z0-9]{1,64})\//.exec(path.slice(prefix.length))?.[1];
    const ids = [...new Set(files.map((file) => idOf(file.path)).filter((id): id is string => Boolean(id)))];
    const users = new Set((await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((user) => user.id));
    for (const file of files) {
      const id = idOf(file.path);
      if (id && users.has(id)) owners.set(file.path, id);
    }
    return owners;
  }
  const rows = await prisma.attachment.findMany({
    where: { imageStoragePath: { in: files.map((file) => file.path) } },
    select: { imageStoragePath: true, message: { select: { session: { select: { userId: true } } } } },
  });
  for (const row of rows) if (row.imageStoragePath) owners.set(row.imageStoragePath, row.message.session.userId);
  return owners;
}

async function adoptListedFiles(kind: StoredFileKind, files: StoredFileListing[], now: Date) {
  if (!files.length) return 0;
  const existing = await prisma.storedFile.findMany({ where: { path: { in: files.map((file) => file.path) } }, select: { path: true, size: true } });
  const known = new Map(existing.map((row) => [row.path, row.size]));
  for (const file of files) {
    if (known.has(file.path) && known.get(file.path) === null) {
      await prisma.storedFile.updateMany({ where: { path: file.path, size: null }, data: { size: file.size } });
    }
  }
  const missing = files.filter((file) => !known.has(file.path));
  if (!missing.length) return 0;
  const owners = await ownersOf(kind, missing);
  const rows = missing.filter((file) => owners.has(file.path)).map((file) => ({
    path: file.path, userId: owners.get(file.path)!, kind, size: file.size, releasedAt: now, createdAt: file.uploadedAt,
  }));
  if (rows.length) await prisma.storedFile.createMany({ data: rows, skipDuplicates: true });
  return rows.length;
}

// 種類のフォルダを 1 ページ（最大 1,000 件）ずつ見ていく。deadline を過ぎたら、どこまで見たかを返して次の実行で続ける。
export async function inventoryStoredFiles(state: InventoryState | null | undefined, deadline: number, now = new Date()): Promise<InventoryState> {
  let index = state?.index ?? 0;
  let cursor = state?.cursor;
  while (index < KINDS.length && Date.now() < deadline) {
    const kind = KINDS[index];
    const page = await listStoredFiles(STORED_FILE_PREFIXES[kind], cursor);
    await adoptListedFiles(kind, page.files, now);
    cursor = page.cursor;
    if (!cursor) index += 1;
  }
  return index >= KINDS.length ? { index: 0, finishedAt: now.toISOString() } : { index, cursor };
}

// ---------- 置き去りの一時ファイル ----------

// チャットの添付は chat-uploads/<利用者>/ に直接送られ、送信のときに読んで消す。送信されなかったものは、
// 受け付けの期限（1 時間）を十分に過ぎた 2 時間後に消す（その利用者の次のアップロードでも消している）。
export const STALE_CHAT_UPLOAD_MS = 2 * 60 * 60 * 1000;

async function reapStaleChatUploads(now: number, deadline: number) {
  let cursor: string | undefined;
  let removed = 0;
  for (let page = 0; page < 3 && Date.now() < deadline; page += 1) {
    const result = await listStoredFiles("chat-uploads/", cursor);
    for (const file of result.files) {
      if (file.uploadedAt.getTime() >= now - STALE_CHAT_UPLOAD_MS) continue;
      await deleteStoredImage(file.path).then(() => { removed += 1; }, () => {});
    }
    cursor = result.cursor;
    if (!cursor) break;
  }
  return removed;
}

// ---------- 定期の後片付け ----------

const JOB = "storage";
// 前の実行から次の実行まで空ける時間と、1 回の実行の持ち時間（リクエストの後で動くので短く区切る）。
const RUN_EVERY_MS = 6 * 60 * 60 * 1000;
const INVENTORY_EVERY_MS = 7 * 24 * 60 * 60 * 1000;
const LOCK_MS = 10 * 60 * 1000;
const BUDGET_MS = 20_000;

type JobState = { inventory?: InventoryState };

// cron の代わりに、アップロードなどのリクエストの後（after）で呼ぶ。前の実行から RUN_EVERY_MS 経つまでは何もしない。
// 同時に 1 つだけ動く（MaintenanceJob の行で順番を取る）。ローカル開発が本番と同じファイル置き場を使っているときは動かない
// （ローカルの DB に無いファイルを、使われていないと見なして消さないように）。
export async function runStorageMaintenance(now = Date.now()) {
  if (sharesForeignStorage()) return null;
  const nowDate = new Date(now);
  await prisma.maintenanceJob.createMany({ data: [{ name: JOB, runAfter: nowDate }], skipDuplicates: true });
  const acquired = await prisma.maintenanceJob.updateMany({
    where: { name: JOB, runAfter: { lte: nowDate }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: nowDate } }] },
    data: { lockedUntil: new Date(now + LOCK_MS) },
  });
  if (!acquired.count) return null;
  const job = await prisma.maintenanceJob.findUnique({ where: { name: JOB }, select: { state: true } });
  const state: JobState = job?.state && typeof job.state === "object" && !Array.isArray(job.state) ? job.state as JobState : {};
  const deadline = Date.now() + BUDGET_MS;
  try {
    const reaped = await reapStaleChatUploads(now, deadline);
    const finished = state.inventory?.finishedAt ? Date.parse(state.inventory.finishedAt) : Number.NaN;
    if (!(now - finished < INVENTORY_EVERY_MS)) state.inventory = await inventoryStoredFiles(state.inventory, deadline, nowDate);
    const collected = await collectUnusedFiles(now, deadline);
    return { reaped, ...collected };
  } finally {
    await prisma.maintenanceJob.update({
      where: { name: JOB },
      data: { lockedUntil: null, runAfter: new Date(now + RUN_EVERY_MS), state: state as Prisma.InputJsonValue },
    }).catch((error: unknown) => console.error("Failed to record storage maintenance", error instanceof Error ? error.message : error));
  }
}

// 応答を返したあとで後片付けを試す（ほとんどの呼び出しは「まだ時間ではない」ですぐ終わる）。失敗はログだけ。
export function scheduleStorageMaintenance() {
  try {
    after(() => runStorageMaintenance().catch((error: unknown) => console.error("Storage maintenance failed", error instanceof Error ? error.message : error)));
  } catch {
    // リクエストの外（テストなど）では何もしない。
  }
}
