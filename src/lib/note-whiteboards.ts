import { parseCanvasSegments } from "@/lib/canvas-document";
import { msg } from "@/lib/i18n/translate";
import { NoteValidationError } from "@/lib/note-document";
import { prisma } from "@/lib/prisma";
import {
  extractNoteWhiteboardPageIds,
  type WhiteboardEmbedMeta,
  type WhiteboardMetaMap,
} from "@/lib/whiteboard/frames";

// ノートに埋め込まれたホワイトボードブロックのサーバー側検証とメタデータ読み込み。
// 埋め込み先が本人の未削除ホワイトボード（kind = "whiteboard", deletedAt = null）であることを確かめる。

type WhiteboardDb = Pick<typeof prisma, "notePage">;

export async function assertNoteWhiteboardsOwner(
  db: WhiteboardDb,
  blocks: unknown,
  userId: string,
  options?: { allowExistingIds?: Iterable<string> },
): Promise<void> {
  const referenced = extractNoteWhiteboardPageIds(blocks);
  if (!referenced.length) return;
  const allowed = options?.allowExistingIds ? new Set(options.allowExistingIds) : null;
  const toCheck = allowed ? referenced.filter((id) => !allowed.has(id)) : referenced;
  if (!toCheck.length) return;
  const rows = await db.notePage.findMany({
    where: { id: { in: toCheck }, userId, kind: "whiteboard", deletedAt: null },
    select: { id: true },
  });
  if (rows.length !== toCheck.length) {
    throw new NoteValidationError(msg("This page embeds a whiteboard that is not available."), 400);
  }
}

// ノート内の埋め込みホワイトボード（生きている自分のホワイトボードのみ）の題名と枠名（NoteCanvas.segments）をまとめて読む。
// 検索スニペット・AI read_note・Markdown エクスポートが共用する。
export async function loadEmbeddedWhiteboardMeta(
  userId: string,
  blocksList: unknown | readonly unknown[],
  db: WhiteboardDb = prisma,
): Promise<WhiteboardMetaMap> {
  const ids = new Set<string>();
  const sources = Array.isArray(blocksList) && blocksList.every((entry) => Array.isArray(entry) || entry === null || entry === undefined)
    ? (blocksList as readonly unknown[])
    : [blocksList];
  for (const blocks of sources) {
    for (const id of extractNoteWhiteboardPageIds(blocks)) ids.add(id);
  }
  const map = new Map<string, WhiteboardEmbedMeta>();
  if (!ids.size) return map;
  const rows = await db.notePage.findMany({
    where: { id: { in: [...ids] }, userId, kind: "whiteboard", deletedAt: null },
    select: { id: true, title: true, canvas: { select: { segments: true } } },
  });
  for (const row of rows) {
    const frames = new Map<string, string>();
    for (const segment of parseCanvasSegments(row.canvas?.segments)) {
      const text = segment.text.trim();
      if (segment.id && text && !frames.has(segment.id)) frames.set(segment.id, text);
    }
    map.set(row.id, { title: row.title, frames });
  }
  return map;
}
