import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { parseAiGenerateRequest } from "@/lib/ai-generate";
import { getOrCreateUser } from "@/lib/auth";
import { validateCanvasPage } from "@/lib/canvas-document";
import { MAX_PAGE_OUTPUT_TOKENS, PAGE_TIMEOUT_MS } from "@/lib/chat-page";
import { msg } from "@/lib/i18n/translate";
import { getModelRegistry, upstreamModelFor } from "@/lib/model-registry";
import { getModelOption, normalizeModel } from "@/lib/models";
import { noteApiError } from "@/lib/note-api";
import { noteGenerateInput, noteGenerateInstructions, parseGeneratedNoteReply } from "@/lib/note-ai-generate";
import { createCanvasPage, createNotePage } from "@/lib/note-create";
import { MAX_NOTE_TITLE, NoteValidationError, readNoteRequest } from "@/lib/note-document";
import { scheduleNoteEmbeddingSync } from "@/lib/note-embeddings";
import { PAGE_SUMMARY_SELECT } from "@/lib/note-tree-server";
import { generateOneShotText, type OneShotTurn } from "@/lib/one-shot-model";
import { aiRequestPageId, findRequestedPage, isDuplicateCreate, readNotesMaterial } from "@/lib/page-ai/one-shot";
import { prisma } from "@/lib/prisma";
import { clientNetworkKey, consumeUsage, refundUsage, usageLimitResponse, type UsageTicket } from "@/lib/usage-limits";
import { WhiteboardEditError } from "@/lib/whiteboard/ai-edit";
import {
  parseStructuredBoardReply,
  whiteboardBoardInstructions,
  whiteboardBoardRetryPrompt,
  whiteboardDiagramInstructions,
  whiteboardGenerateInput,
} from "@/lib/whiteboard/ai-generate";
import { clipTitle, DiagramSourceError, diagramRetryPrompt, diagramToWhiteboard, parseDiagramReply } from "@/lib/whiteboard/diagram";

export const runtime = "nodejs";
export const maxDuration = 300;

const NOTE_FAILED = msg("Could not generate the note. Try again.");
const WHITEBOARD_FAILED = msg("Could not generate the whiteboard. Try again.");
const MAX_WHITEBOARD_OUTPUT_TOKENS = 16_000;
const WHITEBOARD_RETRIES = 1;

function summary<T extends Record<string, unknown>>(page: T) {
  return Object.fromEntries(Object.keys(PAGE_SUMMARY_SELECT).map((key) => [key, page[key]]));
}

// 端末の統合生成下書きを利用者ごとに分けるための値（/api/pages/slides/outline の GET と同じ仕組み）。
export async function GET() {
  try {
    const user = await getOrCreateUser();
    const scope = createHash("sha256").update(`notefable:ai-generate-draft:v1:${user.id}`).digest("base64url").slice(0, 22);
    return NextResponse.json({ scope }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Failed to read the AI generate draft scope", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: msg("Database is unavailable. Try again in a moment.") }, { status: 503 });
  }
}

// ワークスペースの統合「AI で生成」：トピック・指示（および任意の参考ノート）から新しいノートまたはホワイトボードを生成して保存する。
// スライド生成は既存の大綱→生成フロー（/api/pages/slides/outline, /deck）をそのまま使う。
// 送信 1 回分（chat）として数え、生成・検証・保存のいずれかが失敗したら回数を戻し、途中のページは残さない。
// 同じ clientRequestId の再送は作成済みのページを 200 で返し、二重作成・二重カウントを防ぐ。
export async function POST(request: Request) {
  let rawBody: unknown;
  try {
    rawBody = await readNoteRequest(request);
  } catch (error) {
    if (error instanceof NoteValidationError && error.status === 413) return noteApiError(error);
    return NextResponse.json({ error: msg("Invalid JSON request.") }, { status: 400 });
  }

  const parsed = parseAiGenerateRequest(rawBody);
  if (!parsed) {
    return NextResponse.json({ error: msg("Invalid JSON request.") }, { status: 400 });
  }

  const { kind, prompt, noteIds, language, noteStyle, whiteboardStructure, groupId, parentId, clientRequestId } = parsed;
  const failedMessage = kind === "note" ? NOTE_FAILED : WHITEBOARD_FAILED;

  let ticket: UsageTicket | undefined;
  try {
    const user = await getOrCreateUser();
    const purpose = kind === "note" ? "ai-note" : "ai-whiteboard";
    const pageId = aiRequestPageId(user.id, purpose, clientRequestId);

    const existing = await findRequestedPage(user.id, pageId);
    if (existing) return replayed(existing, kind);

    // 作り先と参考ノートの所有権・存在を課金・生成の前に確かめる。
    if (parentId) {
      const parent = await prisma.notePage.findFirst({ where: { id: parentId, userId: user.id, deletedAt: null }, select: { id: true } });
      if (!parent) return NextResponse.json({ error: msg("Page not found.") }, { status: 404 });
    } else if (groupId) {
      const group = await prisma.noteGroup.findFirst({ where: { id: groupId, userId: user.id }, select: { id: true } });
      if (!group) return NextResponse.json({ error: msg("Project not found.") }, { status: 404 });
    }

    let materialText = "";
    let materialTitle = "";
    let materialTruncated = false;
    if (noteIds.length > 0) {
      const material = await readNotesMaterial(user.id, noteIds);
      if (!material) return NextResponse.json({ error: msg("Note not found.") }, { status: 404 });
      materialText = material.text;
      materialTitle = material.title;
      materialTruncated = material.truncated;
      if (!prompt && !materialText) {
        return NextResponse.json({ error: msg("There is nothing to generate from yet.") }, { status: 400 });
      }
    }

    const fallbackTitle = clipTitle(prompt.split("\n")[0]?.trim() || materialTitle || "Untitled", MAX_NOTE_TITLE) || "Untitled";

    const registry = getModelRegistry();
    const model = normalizeModel(parsed.model, registry);
    const option = getModelOption(model, registry.options);
    const upstream = upstreamModelFor(model, registry.options);

    const usage = await consumeUsage(user, "chat", clientNetworkKey(request));
    if (!usage.ok) return usageLimitResponse(usage, "chat");
    ticket = usage.ticket;

    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(PAGE_TIMEOUT_MS)]);

    if (kind === "note") {
      const limit = Math.min(MAX_PAGE_OUTPUT_TOKENS, option.tokenLimits?.maxOutputTokens || MAX_PAGE_OUTPUT_TOKENS);
      let reply: { text: string; cutOff: boolean };
      try {
        reply = await generateOneShotText({
          provider: option.provider,
          model: upstream,
          effort: option.defaultReasoning,
          instructions: noteGenerateInstructions(Boolean(materialText)),
          input: noteGenerateInput({ prompt, materialText: materialText || undefined, style: noteStyle, language }),
          userId: user.id,
          signal,
          maxOutputTokens: limit,
        });
      } catch (error) {
        console.error("Failed to generate a note", error instanceof Error ? error.message : error);
        await refundUsage(ticket);
        return NextResponse.json({ error: NOTE_FAILED }, { status: 502 });
      }

      const generated = parseGeneratedNoteReply(reply.text, fallbackTitle);
      if (!generated) {
        await refundUsage(ticket);
        return NextResponse.json({ error: NOTE_FAILED }, { status: 502 });
      }

      let page;
      try {
        page = await createNotePage(user.id, generated.content, { parentId, groupId, ai: true, id: pageId });
      } catch (error) {
        if (!isDuplicateCreate(error)) throw error;
        await refundUsage(ticket);
        ticket = undefined;
        const created = await findRequestedPage(user.id, pageId);
        if (created) return replayed(created, kind);
        throw error;
      }
      scheduleNoteEmbeddingSync(user.id, [page.id]);
      const partial = materialTruncated || generated.truncated || reply.cutOff;
      return NextResponse.json({ page: summary(page), ...(partial ? { partial: true } : {}) }, { status: 201 });
    }

    // kind === "whiteboard": 編集可能な要素だけを生成（画像は作らない）。
    const limit = Math.min(MAX_WHITEBOARD_OUTPUT_TOKENS, option.tokenLimits?.maxOutputTokens || MAX_WHITEBOARD_OUTPUT_TOKENS);
    const isBoard = whiteboardStructure === "board";
    const instructions = isBoard
      ? whiteboardBoardInstructions(Boolean(materialText))
      : whiteboardDiagramInstructions(whiteboardStructure, Boolean(materialText));
    const turns: OneShotTurn[] = [{
      role: "user",
      content: whiteboardGenerateInput({ prompt, materialText: materialText || undefined, language }),
    }];

    let sceneData: Awaited<ReturnType<typeof diagramToWhiteboard>>["data"] | null = null;
    let sceneTrimmed = false;
    let boardTitle: string | null = null;
    let lastError = "";

    for (let attempt = 0; attempt <= WHITEBOARD_RETRIES && !sceneData; attempt++) {
      let reply: { text: string; cutOff: boolean };
      try {
        reply = await generateOneShotText({
          provider: option.provider,
          model: upstream,
          effort: option.defaultReasoning,
          instructions,
          input: turns,
          userId: user.id,
          signal,
          maxOutputTokens: limit,
        });
      } catch (error) {
        console.error("Failed to generate a whiteboard", error instanceof Error ? error.message : error);
        await refundUsage(ticket);
        return NextResponse.json({ error: WHITEBOARD_FAILED }, { status: 502 });
      }
      if (reply.cutOff || !reply.text.trim()) {
        console.error("Whiteboard generation stopped early", reply.cutOff ? "max output tokens" : "empty output");
        await refundUsage(ticket);
        return NextResponse.json({ error: WHITEBOARD_FAILED }, { status: 502 });
      }

      try {
        if (isBoard) {
          const built = parseStructuredBoardReply(reply.text);
          sceneData = built.data;
          boardTitle = built.title;
        } else {
          const parsedDiagram = parseDiagramReply(reply.text);
          const converted = await diagramToWhiteboard(parsedDiagram.source);
          sceneData = converted.data;
          sceneTrimmed = converted.trimmed;
          boardTitle = parsedDiagram.title;
        }
      } catch (error) {
        if (!(error instanceof DiagramSourceError) && !(error instanceof WhiteboardEditError)) throw error;
        lastError = error.message;
        turns.push(
          { role: "assistant", content: reply.text },
          { role: "user", content: isBoard ? whiteboardBoardRetryPrompt(error.message) : diagramRetryPrompt(error.message) },
        );
      }
    }

    if (!sceneData) {
      console.error("Could not convert generated whiteboard", lastError);
      await refundUsage(ticket);
      return NextResponse.json({ error: WHITEBOARD_FAILED }, { status: 422 });
    }

    const pageTitle = clipTitle(boardTitle || fallbackTitle, MAX_NOTE_TITLE);
    const input = validateCanvasPage("whiteboard", { title: pageTitle, icon: null, data: sceneData });
    let page;
    try {
      ({ page } = await createCanvasPage(user.id, "whiteboard", input, { parentId, groupId, ai: true, id: pageId }));
    } catch (error) {
      if (!isDuplicateCreate(error)) throw error;
      await refundUsage(ticket);
      ticket = undefined;
      const created = await findRequestedPage(user.id, pageId);
      if (created) return replayed(created, kind);
      throw error;
    }
    scheduleNoteEmbeddingSync(user.id, [page.id]);
    const partial = materialTruncated || sceneTrimmed;
    return NextResponse.json({ page: summary(page), ...(partial ? { partial: true } : {}) }, { status: 201 });
  } catch (error) {
    await refundUsage(ticket);
    if (error instanceof NoteValidationError) return noteApiError(error);
    console.error("AI generate request failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: failedMessage }, { status: 503 });
  }
}

function replayed(page: NonNullable<Awaited<ReturnType<typeof findRequestedPage>>>, kind: "note" | "whiteboard") {
  if (page.deletedAt) {
    return NextResponse.json(
      { error: kind === "note" ? msg("This note was moved to the trash.") : msg("This whiteboard was moved to the trash.") },
      { status: 404 },
    );
  }
  return NextResponse.json({ page: summary(page) }, { status: 200 });
}
