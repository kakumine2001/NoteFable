import { NextResponse } from "next/server";
import { getOrCreateUser } from "@/lib/auth";
import { answerConversationUrl, answerFileName, conversationToMarkdownFile } from "@/lib/answer-export";
import { savedAtFrom, toConversationMessages } from "@/lib/answer-export-server";
import { prisma } from "@/lib/prisma";
import { msg } from "@/lib/i18n/translate";

type RouteContext = { params: Promise<{ sessionId: string }> };

// 会話全体の Markdown（Android App の「…」→ Download conversation）。ブラウザが messages API から作るのと同じ
// conversationToMarkdownFile / answerFileName を使う。App はファイル名を見て保存先を選ばせ、markdown をそのまま書く。
// USER / ASSISTANT だけを読み、SYSTEM メッセージや providerContext は読まない。
// ?date=YYYY-MM-DD は端末の日付（出典の日付）。→ 200 { fileName, markdown }
export async function GET(request: Request, context: RouteContext) {
  const user = await getOrCreateUser();
  const { sessionId } = await context.params;
  const session = await prisma.session.findFirst({
    where: { id: sessionId, userId: user.id, noteId: null },
    select: { title: true },
  });
  if (!session) return NextResponse.json({ error: msg("Session not found.") }, { status: 404 });
  const messages = await prisma.message.findMany({
    where: { sessionId, role: { in: ["USER", "ASSISTANT"] } },
    orderBy: { createdAt: "asc" },
    select: { role: true, content: true, attachments: { select: { id: true, filename: true, imageStoragePath: true } } },
  });
  if (!messages.length) return NextResponse.json({ error: msg("Session not found.") }, { status: 404 });
  const url = new URL(request.url);
  const source = {
    conversationTitle: session.title,
    conversationUrl: answerConversationUrl(url.origin, sessionId),
    savedAt: savedAtFrom(url.searchParams.get("date")),
  };
  return NextResponse.json(
    { fileName: answerFileName(session.title.trim() || "conversation"), markdown: conversationToMarkdownFile(toConversationMessages(messages), source) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
