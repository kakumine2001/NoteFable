import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { extractCanvasSegments, parseCanvasSegments, type CanvasData, type CanvasSegment } from "@/lib/canvas-document";
import type { CanvasKind } from "@/lib/page-kinds";
import { databaseSchema, prisma } from "@/lib/prisma";

// ホワイトボード・スライドの本体（NoteCanvas）の読み書き。本体は大きいので、一覧・検索・ページの行には入れない。
// 検索用の文字（segments）と内容のハッシュは、保存のたびにサーバーが本体から作る（利用者が送った値は使わない）。

type Tx = Prisma.TransactionClient;
const canvasTable = () => Prisma.raw(`"${databaseSchema}"."NoteCanvas"`);

export function canvasHash(data: CanvasData) {
  return createHash("sha256").update(JSON.stringify(data)).digest("hex");
}

export type PreparedCanvas = { data: CanvasData; segments: CanvasSegment[]; hash: string; size: number };

export function prepareCanvas(kind: CanvasKind, data: CanvasData, size: number): PreparedCanvas {
  return { data, segments: extractCanvasSegments(kind, data), hash: canvasHash(data), size };
}

// ページの本体を置き換える（無ければ作る）。呼び出し側のトランザクションの中で、ページの版を進めたのと同じ時に呼ぶ。
export async function writeCanvas(tx: Tx, noteId: string, canvas: PreparedCanvas) {
  const values = {
    data: canvas.data as Prisma.InputJsonValue, segments: canvas.segments as unknown as Prisma.InputJsonValue, hash: canvas.hash, size: canvas.size,
  };
  await tx.noteCanvas.upsert({ where: { noteId }, create: { noteId, ...values }, update: values });
}

// 複製：本体を DB の中で写す（大きな本体をアプリに読み込まない）。
export async function copyCanvas(tx: Tx, fromId: string, toId: string) {
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO ${canvasTable()} ("noteId", "data", "segments", "hash", "size", "updatedAt")
    SELECT ${toId}, c."data", c."segments", c."hash", c."size", (now() AT TIME ZONE 'UTC') FROM ${canvasTable()} c WHERE c."noteId" = ${fromId}`);
}

// 本人の、ゴミ箱に入っていないページの本体。
export async function readCanvasData(userId: string, noteId: string): Promise<CanvasData | null> {
  const row = await prisma.noteCanvas.findFirst({ where: { noteId, note: { userId, deletedAt: null } }, select: { data: true } });
  return (row?.data as CanvasData | undefined) ?? null;
}

// 検索・チャットの文脈用の文字だけを読む（本体は読まない）。本人のページだけ。
export async function readCanvasSegments(userId: string, noteIds: string[]): Promise<Map<string, CanvasSegment[]>> {
  if (!noteIds.length) return new Map();
  const rows = await prisma.noteCanvas.findMany({ where: { noteId: { in: noteIds }, note: { userId } }, select: { noteId: true, segments: true } });
  return new Map(rows.map((row) => [row.noteId, parseCanvasSegments(row.segments)]));
}
