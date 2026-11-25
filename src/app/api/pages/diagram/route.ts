import { NextResponse } from "next/server";
import { getOrCreateUser } from "@/lib/auth";
import { validateCanvasPage } from "@/lib/canvas-document";
import { PAGE_TIMEOUT_MS } from "@/lib/chat-page";
import { msg } from "@/lib/i18n/translate";
import { getModelRegistry, upstreamModelFor } from "@/lib/model-registry";
import { getModelOption, normalizeModel } from "@/lib/models";
import { noteApiError } from "@/lib/note-api";
import { createCanvasPage } from "@/lib/note-create";
import { MAX_NOTE_TITLE, NoteValidationError, readNoteRequest } from "@/lib/note-document";
import { scheduleNoteEmbeddingSync } from "@/lib/note-embeddings";
import { PAGE_SUMMARY_SELECT } from "@/lib/note-tree-server";
import { generateOneShotText, type OneShotTurn } from "@/lib/one-shot-model";
import { aiRequestPageId, findRequestedPage, isClientRequestId, isDuplicateCreate, isRecordId, readAnswerMaterial, readNoteMaterial } from "@/lib/page-ai/one-shot";
import { DIAGRAM_INSTRUCTIONS, DiagramSourceError, diagramRetryPrompt, diagramToWhiteboard, parseDiagramReply } from "@/lib/whiteboard/diagram";
import { clientNetworkKey, consumeUsage, refundUsage, usageLimitResponse, type UsageTicket } from "@/lib/usage-limits";

export const runtime = "nodejs";
// 生成（と、変換できなかったときの 1 回の作り直し）を待つ。上流の要求は PAGE_TIMEOUT_MS で先に打ち切る。
export const maxDuration = 300;

const FAILED = msg("Could not draw a diagram. Try again.");
const NOT_CONVERTED = msg("Could not turn this into an editable diagram.");
// 図の返事は短い（推論を含めてもこれで足りる）。モデルの上限がこれより小さければそちらに合わせる。
const MAX_DIAGRAM_OUTPUT_TOKENS = 16_000;
// 変換できなかったとき、誤りを添えてモデルに作り直させる回数。作り直しは同じ 1 回分として数える。
const RETRIES = 1;

type Source = { type: "answer"; messageId: string } | { type: "note"; pageId: string };

function summary<T extends Record<string, unknown>>(page: T) {
  return Object.fromEntries(Object.keys(PAGE_SUMMARY_SELECT).map((key) => [key, page[key]]));
}

function readSource(body: Record<string, unknown>): Source | null {
  if (body.source === "answer" && isRecordId(body.messageId)) return { type: "answer", messageId: body.messageId };
  if (body.source === "note" && isRecordId(body.pageId)) return { type: "note", pageId: body.pageId };
  return null;
}

// 「画成図」：チャットの回答かノートを、AI が Mermaid の図にし、サーバーで編集できる白板の要素にして、新しいホワイトボードとして保存する。
// body: { source: "answer", messageId } | { source: "note", pageId }、model?、clientRequestId（操作ごとに 1 つ。送り直しでも同じもの）
// → 201 { page }（新しいホワイトボードの一覧用の形。ノートからはそのノートのサブページ）
//   同じ clientRequestId で既に作ってあれば 200 { page }（数え直さない）。
// 送信 1 回分（chat）として数え、作れなかったときは戻す。変換できない図を作り直しても失敗したときは 422 で Mermaid の原文（source）を返す。
// docs/architecture/chat-flow.md の「画成図」。
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
  const source = readSource(body);
  if (!source || !isClientRequestId(body.clientRequestId)) return NextResponse.json({ error: msg("Invalid JSON request.") }, { status: 400 });
  const clientRequestId = body.clientRequestId;

  let ticket: UsageTicket | undefined;
  try {
    const user = await getOrCreateUser();
    const pageId = aiRequestPageId(user.id, "diagram", clientRequestId);
    // 同じ要求の送り直し（応答だけが失われたなど）：作ってあるページを返す。
    const existing = await findRequestedPage(user.id, pageId);
    if (existing) return replayed(existing);

    const material = source.type === "answer" ? await readAnswerMaterial(user.id, source.messageId) : await readNoteMaterial(user.id, source.pageId);
    if (!material) {
      return NextResponse.json({ error: source.type === "answer" ? msg("Message not found.") : msg("Note not found.") }, { status: 404 });
    }
    if (!material.text) return NextResponse.json({ error: msg("There is nothing to draw yet.") }, { status: 400 });

    const registry = getModelRegistry();
    const model = normalizeModel(typeof body.model === "string" ? body.model : null, registry);
    const option = getModelOption(model, registry.options);
    const limit = Math.min(MAX_DIAGRAM_OUTPUT_TOKENS, option.tokenLimits?.maxOutputTokens || MAX_DIAGRAM_OUTPUT_TOKENS);

    const usage = await consumeUsage(user, "chat", clientNetworkKey(request));
    if (!usage.ok) return usageLimitResponse(usage, "chat");
    ticket = usage.ticket;

    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(PAGE_TIMEOUT_MS)]);
    const turns: OneShotTurn[] = [{ role: "user", content: material.text }];
    let scene: Awaited<ReturnType<typeof diagramToWhiteboard>> | null = null;
    let title: string | null = null;
    let lastSource = "";
    let lastError = "";
    for (let attempt = 0; attempt <= RETRIES && !scene; attempt++) {
      let reply: { text: string; cutOff: boolean };
      try {
        reply = await generateOneShotText({
          provider: option.provider,
          model: upstreamModelFor(model, registry.options),
          effort: option.defaultReasoning,
          instructions: DIAGRAM_INSTRUCTIONS,
          input: turns,
          userId: user.id,
          signal,
          maxOutputTokens: limit,
        });
      } catch (error) {
        console.error("Failed to generate a diagram", error instanceof Error ? error.message : error);
        await refundUsage(ticket);
        return NextResponse.json({ error: FAILED }, { status: 502 });
      }
      // 途中で切れた Mermaid は使えない。
      if (reply.cutOff || !reply.text.trim()) {
        console.error("Diagram generation stopped early", reply.cutOff ? "max output tokens" : "empty output");
        await refundUsage(ticket);
        return NextResponse.json({ error: FAILED }, { status: 502 });
      }
      try {
        const parsed = parseDiagramReply(reply.text);
        lastSource = parsed.source;
        scene = await diagramToWhiteboard(parsed.source);
        title = parsed.title;
      } catch (error) {
        if (!(error instanceof DiagramSourceError)) throw error;
        lastError = error.message;
        turns.push({ role: "assistant", content: reply.text }, { role: "user", content: diagramRetryPrompt(error.message) });
      }
    }
    if (!scene) {
      console.error("Could not convert the diagram", lastError);
      await refundUsage(ticket);
      return NextResponse.json({ error: NOT_CONVERTED, code: "diagram_invalid", source: lastSource }, { status: 422 });
    }

    const pageTitle = Array.from(title || material.title).slice(0, MAX_NOTE_TITLE).join("");
    const input = validateCanvasPage("whiteboard", { title: pageTitle, icon: null, data: scene.data });
    let page;
    try {
      ({ page } = await createCanvasPage(user.id, "whiteboard", input, { parentId: source.type === "note" ? source.pageId : null, ai: true, id: pageId }));
    } catch (error) {
      // 同じ要求が同時に届き、先に作られていた：数えた分を戻して、そのページを返す。
      if (!isDuplicateCreate(error)) throw error;
      await refundUsage(ticket);
      ticket = undefined;
      const created = await findRequestedPage(user.id, pageId);
      if (created) return replayed(created);
      throw error;
    }
    scheduleNoteEmbeddingSync(user.id, [page.id]);
    return NextResponse.json({ page: summary(page), ...(scene.trimmed || material.truncated ? { partial: true } : {}) }, { status: 201 });
  } catch (error) {
    await refundUsage(ticket);
    if (error instanceof NoteValidationError) return noteApiError(error);
    console.error("Draw as diagram request failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: FAILED }, { status: 503 });
  }
}

function replayed(page: NonNullable<Awaited<ReturnType<typeof findRequestedPage>>>) {
  if (page.deletedAt) return NextResponse.json({ error: msg("This diagram was moved to the trash.") }, { status: 404 });
  return NextResponse.json({ page: summary(page) }, { status: 200 });
}
