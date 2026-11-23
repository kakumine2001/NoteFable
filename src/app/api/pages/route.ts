import { NextResponse } from "next/server";
import { getOrCreateUser } from "@/lib/auth";
import { CANVAS_TOO_LARGE, MAX_CANVAS_REQUEST_BYTES, validateCanvasPage } from "@/lib/canvas-document";
import { noteApiError } from "@/lib/note-api";
import { createCanvasPage, createNotePage } from "@/lib/note-create";
import { NoteValidationError, readNoteRequest, topLevelJsonFields, validateNoteContent } from "@/lib/note-document";
import { scheduleNoteEmbeddingSync } from "@/lib/note-embeddings";
import { isCanvasKind, isPageKind } from "@/lib/page-kinds";
import { CHAT_RECENT_COUNT } from "@/types/notes";
import { PAGE_SUMMARY_SELECT } from "@/lib/note-tree-server";
import { prisma } from "@/lib/prisma";
import { msg } from "@/lib/i18n/translate";

export async function GET(request: Request) {
  try {
    const user = await getOrCreateUser();
    if (new URL(request.url).searchParams.get("recent") === "1") {
      const pages = await prisma.notePage.findMany({
        where: { userId: user.id, deletedAt: null },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: CHAT_RECENT_COUNT,
        select: { id: true, kind: true, title: true, icon: true, updatedAt: true },
      });
      return NextResponse.json({ pages }, { headers: { "Cache-Control": "no-store" } });
    }
    const [pages, groups] = await Promise.all([
      prisma.notePage.findMany({
        where: { userId: user.id, deletedAt: null }, orderBy: [{ position: "asc" }, { createdAt: "desc" }, { id: "desc" }],
        select: PAGE_SUMMARY_SELECT,
      }),
      prisma.noteGroup.findMany({ where: { userId: user.id }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: { id: true, name: true, position: true } }),
    ]);
    return NextResponse.json({ pages, groups }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return noteApiError(error); }
}

// 本文に加えて parentId（省略・null は最上位）と kind（省略は note）を受け取る。親を指定するとそのページのサブページになる。
// kind が whiteboard / slides のときは { kind, title, icon, data? }（data を省略すると空の本体）。種類の違うページの下にも作れる。
export async function POST(request: Request) {
  try {
    // ノートの本文は validateNoteContent が 1 MiB で抑える。ホワイトボード・スライドは本体の上限（2 MB）まで読む。
    // それも超えた本文は最後まで読まないので、読めた先頭の最上位の kind で種類を見分け、種類に合った文で断る。
    // kind が切れた先にあるときは、本体（data）があって本文（blocks）がなければホワイトボード・スライドとみなす。
    const body = await readNoteRequest(request, MAX_CANVAS_REQUEST_BYTES, (head) => {
      const { keys, strings } = topLevelJsonFields(head);
      const canvas = strings.has("kind") ? isCanvasKind(strings.get("kind")) : keys.has("data") && !keys.has("blocks");
      return canvas ? CANVAS_TOO_LARGE : msg("Note content exceeds 1 MiB.");
    });
    const rawKind = (body as { kind?: unknown } | null)?.kind ?? "note";
    if (!isPageKind(rawKind)) throw new NoteValidationError(msg("Unknown page kind."));
    const parentId = (body as { parentId?: unknown } | null)?.parentId ?? null;
    if (parentId !== null && (typeof parentId !== "string" || !parentId || parentId.length > 64)) throw new NoteValidationError("parentId must be a note ID or null.");
    if (isCanvasKind(rawKind)) {
      const input = validateCanvasPage(rawKind, body);
      const user = await getOrCreateUser();
      const { page, data } = await createCanvasPage(user.id, rawKind, input, { parentId });
      scheduleNoteEmbeddingSync(user.id, [page.id]);
      return NextResponse.json({ page: { ...page, data } }, { status: 201 });
    }
    const content = validateNoteContent(body);
    const user = await getOrCreateUser();
    const page = await createNotePage(user.id, content, { parentId });
    scheduleNoteEmbeddingSync(user.id, [page.id]);
    return NextResponse.json({ page }, { status: 201 });
  } catch (error) { return noteApiError(error); }
}
