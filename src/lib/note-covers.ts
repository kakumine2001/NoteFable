import { NoteValidationError, uploadedCoverPath } from "@/lib/note-document";
import { prisma } from "@/lib/prisma";
import { deleteStoredImage } from "@/lib/storage";

// ページカバー画像として受け付ける形式。拡張子ではなく先頭バイトで判定する。
export function sniffCoverImage(buffer: Buffer): string | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 6 && /^GIF8[79]a$/.test(buffer.subarray(0, 6).toString("latin1"))) return "image/gif";
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("latin1") === "RIFF" && buffer.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

export const COVER_CONTENT_TYPES: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };

// 他人のフォルダにある画像キーを、自分のページのカバーとして保存させない。
export function assertCoverOwner(cover: string | null, userId: string) {
  const upload = uploadedCoverPath(cover);
  if (upload && upload.ownerId !== userId) throw new NoteValidationError("Unsupported page cover.");
}

type CoverClient = Pick<typeof prisma, "noteCoverAsset">;

// ページにアップロード画像を設定する保存処理の中で呼ぶ。資産行を「使用中」に戻し、
// 日次削除がすでに行を消していた場合は保存を拒否して、存在しない画像を参照させない。
export async function claimCover(tx: CoverClient, cover: string | null, userId: string) {
  const upload = uploadedCoverPath(cover);
  if (!upload) return;
  const claimed = await tx.noteCoverAsset.updateMany({ where: { path: upload.path, userId, deletingAt: null }, data: { releasedAt: null } });
  if (!claimed.count) throw new NoteValidationError("This cover image is no longer available. Choose another cover.");
}

// どのページからも参照されない状態が続いてから削除するまでの猶予。
// 別タブの下書きや競合時の「新しいページとして保存」が、置き換え前の画像をまだ使えるようにする。
export const COVER_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
const COVER_CLEANUP_LIMIT = 100;
const COVER_SCAN_PAGE = 500;
const COVER_SCAN_PAGES = 20;

async function referencedPaths(paths: string[]) {
  if (!paths.length) return new Set<string>();
  const pages = await prisma.notePage.findMany({ where: { cover: { in: paths.map((path) => `upload:${path}`) } }, select: { cover: true } });
  return new Set(pages.map((page) => page.cover!.slice("upload:".length)));
}

export async function collectUnusedCovers(now = Date.now()) {
  const nowDate = new Date(now);

  // 1. 使用中の資産のうち参照がなくなったものに解放時刻を記録する（猶予はここから数える）。
  //    確認した時刻を残し、次回は最も長く確認していないものから続けるため、件数が多くても全件を巡回する。
  //    記録後にもう一度参照を確かめ、記録と同時に付いた参照があれば使用中に戻す。
  let released = 0;
  for (let page = 0; page < COVER_SCAN_PAGES; page += 1) {
    const held = await prisma.noteCoverAsset.findMany({
      where: { releasedAt: null, deletingAt: null, OR: [{ checkedAt: null }, { checkedAt: { lt: nowDate } }] },
      select: { path: true }, orderBy: [{ checkedAt: { sort: "asc", nulls: "first" } }, { path: "asc" }], take: COVER_SCAN_PAGE,
    });
    if (!held.length) break;
    await prisma.noteCoverAsset.updateMany({ where: { path: { in: held.map((asset) => asset.path) } }, data: { checkedAt: nowDate } });
    const referenced = await referencedPaths(held.map((asset) => asset.path));
    const unused = held.map((asset) => asset.path).filter((path) => !referenced.has(path));
    if (unused.length) {
      const marked = await prisma.noteCoverAsset.updateMany({ where: { path: { in: unused }, releasedAt: null, deletingAt: null }, data: { releasedAt: nowDate } });
      const reclaimed = [...await referencedPaths(unused)];
      if (reclaimed.length) await prisma.noteCoverAsset.updateMany({ where: { path: { in: reclaimed }, deletingAt: null }, data: { releasedAt: null } });
      released += Math.max(0, marked.count - reclaimed.length);
    }
    if (held.length < COVER_SCAN_PAGE) break;
  }

  // 2. 猶予を過ぎても未使用のものを削除中にする。参照を付ける保存と同じ行で競合するため、
  //    保存が先なら条件が外れて削除されず、こちらが先なら保存側の確保が失敗して保存が拒否される。
  const cutoff = new Date(now - COVER_GRACE_MS);
  const expired = await prisma.noteCoverAsset.findMany({
    where: { releasedAt: { lt: cutoff }, deletingAt: null }, select: { path: true }, orderBy: { releasedAt: "asc" }, take: COVER_CLEANUP_LIMIT,
  });
  let started = 0;
  for (const { path } of expired) {
    if ((await referencedPaths([path])).size) {
      await prisma.noteCoverAsset.updateMany({ where: { path, deletingAt: null }, data: { releasedAt: null } });
      continue;
    }
    started += (await prisma.noteCoverAsset.updateMany({ where: { path, releasedAt: { lt: cutoff }, deletingAt: null }, data: { deletingAt: nowDate } })).count;
  }

  // 3. 削除中の行は、画像の削除に成功してから行を消す。失敗した分は次回の実行で再試行する。
  const deleting = await prisma.noteCoverAsset.findMany({
    where: { deletingAt: { not: null } }, select: { path: true }, orderBy: { deletingAt: "asc" }, take: COVER_CLEANUP_LIMIT,
  });
  let deleted = 0;
  for (const { path } of deleting) {
    try {
      await deleteStoredImage(path);
      await prisma.noteCoverAsset.deleteMany({ where: { path, deletingAt: { not: null } } });
      deleted += 1;
    } catch (error) {
      console.error("Failed to delete page cover", error);
    }
  }
  return { released, started, deleted };
}
