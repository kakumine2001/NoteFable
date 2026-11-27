import { NextResponse } from "next/server";
import { getOrCreateUser } from "@/lib/auth";
import { msg } from "@/lib/i18n/translate";
import { noteApiError } from "@/lib/note-api";
import { NoteValidationError, readNoteRequest } from "@/lib/note-document";
import { pageKindOf } from "@/lib/page-kinds";
import { prisma } from "@/lib/prisma";
import {
  extractPageCardSummary,
  isValidPageCardId,
  MAX_PAGE_CARD_BATCH,
  type PageCardPreview,
} from "@/lib/whiteboard/links";

const MAX_REQUEST_BYTES = 32 * 1024;

// ホワイトボードのページカード用：参照先の自分のページ（未削除のみ）の最新タイトル・アイコン・短い要約を 1 回でまとめて返す。
// 見つからない ID（ゴミ箱・削除済み・他人のページ）は応答の cards に含めない（画面側は「ページ不存在」と表示する）。
export async function POST(request: Request) {
  try {
    const user = await getOrCreateUser();
    const body = await readNoteRequest(request, MAX_REQUEST_BYTES);
    if (!body || typeof body !== "object" || Array.isArray(body) || !Array.isArray((body as { ids?: unknown }).ids)) {
      throw new NoteValidationError(msg("Invalid JSON request."));
    }
    const rawIds = (body as { ids: unknown[] }).ids;
    const uniqueIds: string[] = [];
    const seen = new Set<string>();
    for (const item of rawIds) {
      if (!isValidPageCardId(item) || seen.has(item)) continue;
      seen.add(item);
      uniqueIds.push(item);
      if (uniqueIds.length >= MAX_PAGE_CARD_BATCH) break;
    }
    if (!uniqueIds.length) {
      return NextResponse.json({ cards: {} }, { headers: { "Cache-Control": "no-store" } });
    }
    const rows = await prisma.notePage.findMany({
      where: { id: { in: uniqueIds }, userId: user.id, deletedAt: null },
      select: {
        id: true,
        kind: true,
        title: true,
        icon: true,
        blocks: true,
        canvas: { select: { segments: true } },
      },
    });
    const cards: Record<string, PageCardPreview> = {};
    for (const row of rows) {
      const kind = pageKindOf(row);
      cards[row.id] = {
        id: row.id,
        kind,
        title: row.title,
        icon: row.icon,
        summary: extractPageCardSummary(kind, row.blocks, row.canvas?.segments),
      };
    }
    return NextResponse.json({ cards }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return noteApiError(error);
  }
}
