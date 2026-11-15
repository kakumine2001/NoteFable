import { NextResponse } from "next/server";
import { getOrCreateUser } from "@/lib/auth";
import { answerConversationUrl, answerToNoteContent } from "@/lib/answer-export";
import { isSessionId, savedAtFrom } from "@/lib/answer-export-server";
import { buildTranscript, generatePageMarkdown, PAGE_TIMEOUT_MS } from "@/lib/chat-page";
import { msg } from "@/lib/i18n/translate";
import { getModelRegistry, upstreamModelFor } from "@/lib/model-registry";
import { getModelOption, normalizeModel } from "@/lib/models";
import { noteApiError } from "@/lib/note-api";
import { createNotePage } from "@/lib/note-create";
import { NoteValidationError, validateNoteContent } from "@/lib/note-document";
import { prisma } from "@/lib/prisma";
import { clientNetworkKey, consumeUsage, refundUsage, usageLimitResponse, type UsageTicket } from "@/lib/usage-limits";

export const runtime = "nodejs";
// 長い会話をまとめる 1 回の生成を待つ。上流の要求は PAGE_TIMEOUT_MS で先に打ち切る。
export const maxDuration = 300;

type RouteContext = { params: Promise<{ sessionId: string }> };

const FAILED = msg("Could not create a page from this chat. Try again.");

// 「Create page」：会話全体を AI が 1 つの読みやすいノートに書き直し、新しいページとして保存する。
// body: { model?: string, savedOn?: "YYYY-MM-DD" } → 201 { page }
// 会話は現在の利用者の Chats の会話だけ（ノート用アシスタントの会話は 404）。USER / ASSISTANT の本文と添付のファイル名だけを読み、
// SYSTEM メッセージや providerContext は読まない。モデルは選択中のチャットモデル（推論強度はそのモデルの既定値）。
// 送信 1 回分（chat）として数え、ページを作れなかったときは戻す。
export async function POST(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;
  if (!isSessionId(sessionId)) return NextResponse.json({ error: msg("Session not found.") }, { status: 404 });
  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = await request.json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
    else throw new Error("not an object");
  } catch {
    return NextResponse.json({ error: msg("Invalid JSON request.") }, { status: 400 });
  }

  let ticket: UsageTicket | undefined;
  try {
    const user = await getOrCreateUser();
    const session = await prisma.session.findFirst({ where: { id: sessionId, userId: user.id, noteId: null }, select: { title: true } });
    if (!session) return NextResponse.json({ error: msg("Session not found.") }, { status: 404 });
    const messages = await prisma.message.findMany({
      where: { sessionId, role: { in: ["USER", "ASSISTANT"] } },
      orderBy: { createdAt: "asc" },
      select: { role: true, content: true, attachments: { select: { filename: true } } },
    });
    const transcript = buildTranscript(session.title, messages);
    if (!transcript) return NextResponse.json({ error: msg("This chat has nothing to turn into a page yet.") }, { status: 400 });

    const registry = getModelRegistry();
    const model = normalizeModel(typeof body.model === "string" ? body.model : null, registry);
    const option = getModelOption(model, registry.options);

    const usage = await consumeUsage(user, "chat", clientNetworkKey(request));
    if (!usage.ok) return usageLimitResponse(usage, "chat");
    ticket = usage.ticket;

    let markdown: string;
    try {
      markdown = await generatePageMarkdown({
        provider: option.provider,
        model: upstreamModelFor(model, registry.options),
        effort: option.defaultReasoning,
        transcript,
        userId: user.id,
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(PAGE_TIMEOUT_MS)]),
      });
    } catch (error) {
      console.error("Failed to generate a page from a chat", error instanceof Error ? error.message : error);
      await refundUsage(ticket);
      ticket = undefined;
      return NextResponse.json({ error: FAILED }, { status: 502 });
    }

    const { title, blocks } = answerToNoteContent(markdown, {
      conversationTitle: session.title,
      conversationUrl: answerConversationUrl(new URL(request.url).origin, sessionId),
      savedAt: savedAtFrom(body.savedOn),
    });
    const content = validateNoteContent({ title, icon: null, cover: null, coverPosition: null, blocks });
    const page = await createNotePage(user.id, content);
    return NextResponse.json({ page }, { status: 201 });
  } catch (error) {
    await refundUsage(ticket);
    // 長すぎる・形の合わないページは検証の理由（413 / 400）をそのまま返す。それ以外は作れなかったとだけ知らせる。
    if (error instanceof NoteValidationError) return noteApiError(error);
    console.error("Create page request failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: FAILED }, { status: 503 });
  }
}
