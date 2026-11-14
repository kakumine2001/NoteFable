import { NextResponse } from "next/server";
import { getOrCreateUser } from "@/lib/auth";
import { answerConversationUrl, answerToNoteContent } from "@/lib/answer-export";
import { readFromAnswer, savedAtFrom } from "@/lib/answer-export-server";
import { noteApiError } from "@/lib/note-api";
import { createNotePage } from "@/lib/note-create";
import { readNoteRequest, validateNoteContent } from "@/lib/note-document";
import { prisma } from "@/lib/prisma";
import { msg } from "@/lib/i18n/translate";

// 回答の Markdown から新しいノートを作る（Android App の「…」→ Save to page）。
// ブラウザは answerToNoteContent で作ったブロックを POST /api/pages に送る。App には同じ変換が無いので、ここで同じ関数を使って組み立てる。
// 本文は App が表示している回答そのもの（POST /api/pages と同じく、自分のノートに自分の文を入れるだけ）。
// 会話はタイトルと戻りリンクのためだけに読み、現在のユーザーの Chats の会話でなければ 404 にする。
// body: { markdown, sessionId, messageId?, savedOn?: "YYYY-MM-DD" } → 201 { page }
export async function POST(request: Request) {
  try {
    const body = readFromAnswer(await readNoteRequest(request));
    const user = await getOrCreateUser();
    const session = await prisma.session.findFirst({
      where: { id: body.sessionId, userId: user.id, noteId: null },
      select: { title: true },
    });
    if (!session) return NextResponse.json({ error: msg("Session not found.") }, { status: 404 });
    const source = {
      conversationTitle: session.title,
      conversationUrl: answerConversationUrl(new URL(request.url).origin, body.sessionId, body.messageId),
      savedAt: savedAtFrom(body.savedOn),
    };
    const { title, blocks } = answerToNoteContent(body.markdown, source);
    const content = validateNoteContent({ title, icon: null, cover: null, coverPosition: null, blocks });
    const page = await createNotePage(user.id, content);
    return NextResponse.json({ page }, { status: 201 });
  } catch (error) { return noteApiError(error); }
}
