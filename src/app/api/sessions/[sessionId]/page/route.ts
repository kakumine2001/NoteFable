import { NextResponse } from "next/server";
import { getOrCreateUser } from "@/lib/auth";
import { answerConversationUrl, answerToNoteContent } from "@/lib/answer-export";
import { isSessionId, savedAtFrom } from "@/lib/answer-export-server";
import { buildTranscript, generatePageMarkdown, MAX_TRANSCRIPT_MESSAGES, PAGE_TIMEOUT_MS } from "@/lib/chat-page";
import { msg } from "@/lib/i18n/translate";
import { getModelRegistry, upstreamModelFor } from "@/lib/model-registry";
import { getModelOption, normalizeModel } from "@/lib/models";
import { noteApiError } from "@/lib/note-api";
import { createNotePage } from "@/lib/note-create";
import { NoteValidationError, readNoteRequest, validateNoteContent } from "@/lib/note-document";
import { prisma } from "@/lib/prisma";
import { clientNetworkKey, consumeUsage, refundUsage, usageLimitResponse, type UsageTicket } from "@/lib/usage-limits";

export const runtime = "nodejs";
// 長い会話をまとめる 1 回の生成を待つ。上流の要求は PAGE_TIMEOUT_MS で先に打ち切る。
export const maxDuration = 300;

type RouteContext = { params: Promise<{ sessionId: string }> };

const FAILED = msg("Could not create a page from this chat. Try again.");

// 「Create page」：会話全体を AI が 1 つの読みやすいノートに書き直し、新しいページとして保存する。
// body: { model?: string, savedOn?: "YYYY-MM-DD" } → 201 { page, partial }（partial: 長い会話で古い発言を使わなかった）
// 会話は現在の利用者の Chats の会話だけ（ノート用アシスタントの会話は 404）。USER / ASSISTANT の本文と添付のファイル名だけを読み、
// SYSTEM メッセージや providerContext は読まない。モデルは選択中のチャットモデル（推論強度はそのモデルの既定値）。
// 送信 1 回分（chat）として数え、ページを作れなかったときは戻す。
export async function POST(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;
  if (!isSessionId(sessionId)) return NextResponse.json({ error: msg("Session not found.") }, { status: 404 });
  let body: Record<string, unknown> = {};
  try {
    // ほかのノート API と同じく、受け取る量を 1 MiB までにする。
    const parsed: unknown = await readNoteRequest(request);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
    else throw new Error("not an object");
  } catch (error) {
    if (error instanceof NoteValidationError && error.status === 413) return noteApiError(error);
    return NextResponse.json({ error: msg("Invalid JSON request.") }, { status: 400 });
  }

  let ticket: UsageTicket | undefined;
  try {
    const user = await getOrCreateUser();
    const session = await prisma.session.findFirst({ where: { id: sessionId, userId: user.id, noteId: null }, select: { title: true } });
    if (!session) return NextResponse.json({ error: msg("Session not found.") }, { status: 404 });
    // 使うのは新しい方の発言だけなので、新しい順に上限 + 1 件まで読み、時系列に戻す（1 件多ければ、もっと古い発言がある）。
    const newest = await prisma.message.findMany({
      where: { sessionId, role: { in: ["USER", "ASSISTANT"] } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: MAX_TRANSCRIPT_MESSAGES + 1,
      select: { role: true, content: true, attachments: { select: { filename: true } } },
    });
    const earlierLeftOut = newest.length > MAX_TRANSCRIPT_MESSAGES;
    const transcript = buildTranscript(session.title, newest.slice(0, MAX_TRANSCRIPT_MESSAGES).reverse(), earlierLeftOut);
    if (!transcript) return NextResponse.json({ error: msg("This chat has nothing to turn into a page yet.") }, { status: 400 });

    const registry = getModelRegistry();
    const model = normalizeModel(typeof body.model === "string" ? body.model : null, registry);
    const option = getModelOption(model, registry.options);

    const usage = await consumeUsage(user, "chat", clientNetworkKey(request));
    if (!usage.ok) return usageLimitResponse(usage, "chat");
    ticket = usage.ticket;

    let generated: Awaited<ReturnType<typeof generatePageMarkdown>>;
    try {
      generated = await generatePageMarkdown({
        provider: option.provider,
        model: upstreamModelFor(model, registry.options),
        effort: option.defaultReasoning,
        transcript: transcript.text,
        maxOutputTokens: option.tokenLimits?.maxOutputTokens,
        userId: user.id,
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(PAGE_TIMEOUT_MS)]),
      });
    } catch (error) {
      console.error("Failed to generate a page from a chat", error instanceof Error ? error.message : error);
      await refundUsage(ticket);
      return NextResponse.json({ error: FAILED }, { status: 502 });
    }

    // 出力の上限で途中まで書いて止まったページも保存し、末尾が欠けたことを出典の段落に書く。
    const { title, blocks } = answerToNoteContent(generated.markdown, {
      conversationTitle: session.title,
      conversationUrl: answerConversationUrl(new URL(request.url).origin, sessionId),
      savedAt: savedAtFrom(body.savedOn),
      subject: "page",
      cutOff: generated.cutOff,
    });
    const content = validateNoteContent({ title, icon: null, cover: null, coverPosition: null, blocks });
    const page = await createNotePage(user.id, content);
    return NextResponse.json({ page, partial: transcript.omitted }, { status: 201 });
  } catch (error) {
    await refundUsage(ticket);
    // 長すぎる・形の合わないページは検証の理由（413 / 400）をそのまま返す。それ以外は作れなかったとだけ知らせる。
    if (error instanceof NoteValidationError) return noteApiError(error);
    console.error("Create page request failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: FAILED }, { status: 503 });
  }
}
