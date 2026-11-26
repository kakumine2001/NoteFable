import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { extractCanvasSegments, type CanvasData, type CanvasSegment } from "@/lib/canvas-document";
import { extractCanvasLinks } from "@/lib/note-backlinks";
import type { CanvasKind } from "@/lib/page-kinds";
import { databaseSchema, prisma } from "@/lib/prisma";

// ホワイトボード・スライドの本体（NoteCanvas）の読み書き。本体は大きいので、一覧・検索・ページの行には入れない。
// 検索用の文字（segments）、ページへのリンク（links、バックリンク用）と内容のハッシュは、保存のたびにサーバーが本体から作る（利用者が送った値は使わない）。

type Tx = Prisma.TransactionClient;
const canvasTable = () => Prisma.raw(`"${databaseSchema}"."NoteCanvas"`);

export function canvasHash(data: CanvasData) {
  return createHash("sha256").update(JSON.stringify(data)).digest("hex");
}

// filePaths: 本体が参照しているファイル（validateCanvasData が集めたもの）。書く前に claimStoredFiles で使用中へ戻す。
export type PreparedCanvas = { data: CanvasData; segments: CanvasSegment[]; links: string[]; hash: string; size: number; filePaths: string[] };

export function prepareCanvas(kind: CanvasKind, data: CanvasData, size: number, filePaths: string[] = []): PreparedCanvas {
  return { data, segments: extractCanvasSegments(kind, data), links: extractCanvasLinks(kind, data), hash: canvasHash(data), size, filePaths };
}

// ページの本体を置き換える（無ければ作る）。呼び出し側のトランザクションの中で、ページの版を進めたのと同じ時に呼ぶ。
export async function writeCanvas(tx: Tx, noteId: string, canvas: PreparedCanvas) {
  const values = {
    data: canvas.data as Prisma.InputJsonValue, segments: canvas.segments as unknown as Prisma.InputJsonValue, links: canvas.links, hash: canvas.hash, size: canvas.size,
  };
  await tx.noteCanvas.upsert({ where: { noteId }, create: { noteId, ...values }, update: values });
}

// 複製：本体を DB の中で写す（大きな本体をアプリに読み込まない）。
export async function copyCanvas(tx: Tx, fromId: string, toId: string) {
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO ${canvasTable()} ("noteId", "data", "segments", "links", "hash", "size", "updatedAt")
    SELECT ${toId}, c."data", c."segments", c."links", c."hash", c."size", (now() AT TIME ZONE 'UTC') FROM ${canvasTable()} c WHERE c."noteId" = ${fromId}`);
}

// 公開共有のページの本体（resolvePublicShare が持ち主・公開・ゴミ箱を確かめた後に呼ぶ）。
export async function readCanvasDataForShare(noteId: string): Promise<CanvasData | null> {
  const row = await prisma.noteCanvas.findFirst({ where: { noteId, note: { deletedAt: null } }, select: { data: true } });
  return (row?.data as CanvasData | undefined) ?? null;
}

// 本人の、ゴミ箱に入っていないページの本体。
export async function readCanvasData(userId: string, noteId: string): Promise<CanvasData | null> {
  const row = await prisma.noteCanvas.findFirst({ where: { noteId, note: { userId, deletedAt: null } }, select: { data: true } });
  return (row?.data as CanvasData | undefined) ?? null;
}

