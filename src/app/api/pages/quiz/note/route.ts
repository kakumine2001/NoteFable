import { NextResponse } from "next/server";
import { getOrCreateUser } from "@/lib/auth";
import { msg } from "@/lib/i18n/translate";
import { noteApiError } from "@/lib/note-api";
import { createNotePage } from "@/lib/note-create";
import { NoteValidationError, readNoteRequest, validateNoteContent } from "@/lib/note-document";
import { scheduleNoteEmbeddingSync } from "@/lib/note-embeddings";
import { PAGE_SUMMARY_SELECT } from "@/lib/note-tree-server";
import { isClientRequestId, isRecordId } from "@/lib/page-ai/ids";
import { aiRequestPageId, findRequestedPage, isDuplicateCreate } from "@/lib/page-ai/one-shot";
import { prisma } from "@/lib/prisma";
import { parseReviewNoteLabels, quizToReviewNoteContent, validateReviewQuiz } from "@/lib/quiz/model";

export const runtime = "nodejs";

function summary<T extends Record<string, unknown>>(page: T) {
  return Object.fromEntries(Object.keys(PAGE_SUMMARY_SELECT).map((key) => [key, page[key]]));
}

function replayed(page: NonNullable<Awaited<ReturnType<typeof findRequestedPage>>>) {
  if (page.deletedAt) return NextResponse.json({ error: msg("This note was moved to the trash.") }, { status: 404 });
  return NextResponse.json({ page: summary(page) }, { status: 200 });
}

// 復習・クイズの結果を通常のノートとして保存する（aiUpdatedAt を付けて通報可能にする）。
// 元のノート・スライド自体は書き換えず、サブページとして保存する（スライドは公開ツリーの葉なので公開リンクには出ない）。
// body: { pageId, quiz, clientRequestId, labels? }
// → 201 { page }。同じ clientRequestId の再送・連打は既存のページを 200 { page } で返し、二重に作らない。
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await readNoteRequest(request);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    body = parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof NoteValidationError && error.status === 413) return noteApiError(error);
    return NextResponse.json({ error: msg("Invalid JSON request.") }, { status: 400 });
  }

  const pageId = body.pageId;
  const quiz = validateReviewQuiz(body.quiz);
  const clientRequestId = body.clientRequestId;
  if (!isRecordId(pageId) || !quiz || !isClientRequestId(clientRequestId)) {
    return NextResponse.json({ error: msg("Invalid JSON request.") }, { status: 400 });
  }
  const labels = parseReviewNoteLabels(body.labels);

  try {
    const user = await getOrCreateUser();
    const noteId = aiRequestPageId(user.id, "quiz-note", clientRequestId);
    const existing = await findRequestedPage(user.id, noteId);
    if (existing) return replayed(existing);

    const source = await prisma.notePage.findFirst({
      where: { id: pageId, userId: user.id, deletedAt: null, kind: { in: ["note", "slides"] } },
      select: { id: true, title: true },
    });
    if (!source) return NextResponse.json({ error: msg("Page not found.") }, { status: 404 });

    const draft = quizToReviewNoteContent(quiz, labels, { pageId: source.id, title: source.title });
    const content = validateNoteContent({
      title: draft.title,
      icon: null,
      cover: null,
      coverPosition: null,
      blocks: draft.blocks,
    });

    let page;
    try {
      // 親ページや祖先が「サブページも公開」で共有中でも、保存した復習ノート（問題と解答）が自動で公開されないよう shareExcludeFromParent を立てる。
      page = await createNotePage(user.id, content, { parentId: source.id, ai: true, id: noteId, shareExcludeFromParent: true });
    } catch (error) {
      if (!isDuplicateCreate(error)) throw error;
      const created = await findRequestedPage(user.id, noteId);
      if (created) return replayed(created);
      throw error;
    }

    scheduleNoteEmbeddingSync(user.id, [page.id]);
    return NextResponse.json({ page: summary(page) }, { status: 201 });
  } catch (error) {
    if (error instanceof NoteValidationError) return noteApiError(error);
    console.error("Failed to save review note", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: msg("Could not save the review note. Try again.") }, { status: 503 });
  }
}
