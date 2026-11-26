import { NextResponse } from "next/server";
import { PAGE_TIMEOUT_MS } from "@/lib/chat-page";
import { msg } from "@/lib/i18n/translate";
import { getModelRegistry, upstreamModelFor } from "@/lib/model-registry";
import { getModelOption, normalizeModel } from "@/lib/models";
import { noteApiError } from "@/lib/note-api";
import { NoteValidationError, readNoteRequest } from "@/lib/note-document";
import { generateOneShotText } from "@/lib/one-shot-model";
import { isClientRequestId } from "@/lib/page-ai/ids";
import { readChatMaterial, readNotesMaterial, readTopicMaterial, type Material } from "@/lib/page-ai/one-shot";
import { parseOptions, parseSource, type SlidesOptions, type SlidesSource } from "@/lib/slides/ai-wizard";

// POST /api/pages/slides/outline と /deck の共通部分（要求の読み方、材料、モデルの 1 回の呼び出し）。

export const SLIDES_FAILED = msg("Could not generate slides. Try again.");

const invalidRequest = () => NextResponse.json({ error: msg("Invalid JSON request.") }, { status: 400 });

export type SlidesRequest = { body: Record<string, unknown>; source: SlidesSource; options: SlidesOptions; clientRequestId: string };

// 要求の本文（1 MiB まで）。読めない・形が違うときは返す応答。
export async function readSlidesRequest(request: Request): Promise<SlidesRequest | Response> {
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await readNoteRequest(request);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    body = parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof NoteValidationError && error.status === 413) return noteApiError(error);
    return invalidRequest();
  }
  const source = parseSource(body.source);
  const options = parseOptions(body.options);
  if (!source || !options || !isClientRequestId(body.clientRequestId)) return invalidRequest();
  return { body, source, options, clientRequestId: body.clientRequestId };
}

// 材料を読む。本人のものでなければ 404、何も書かれていなければ 400（どちらも数える前）。
export async function readSlidesMaterial(userId: string, source: SlidesSource): Promise<Material | Response> {
  const material = source.type === "topic"
    ? readTopicMaterial(source.topic)
    : source.type === "notes"
      ? await readNotesMaterial(userId, source.pageIds)
      : await readChatMaterial(userId, source.sessionId);
  if (!material) {
    return NextResponse.json({ error: source.type === "chat" ? msg("Session not found.") : msg("Note not found.") }, { status: 404 });
  }
  if (!material.text) return NextResponse.json({ error: msg("There is nothing to make slides from yet.") }, { status: 400 });
  return material;
}

// 選択中のチャットモデル（未知の値は既定のモデル）。
export function slidesModel(requested: unknown) {
  const registry = getModelRegistry();
  const id = normalizeModel(typeof requested === "string" ? requested : null, registry);
  return { id, option: getModelOption(id, registry.options), upstream: upstreamModelFor(id, registry.options) };
}

// 1 回だけ非ストリームで要求する（検索もツールも使わない）。上流の失敗・時間切れ・途中で切れた返事・空の返事は null。
export async function generateSlidesText({ model, instructions, input, userId, request, maxOutputTokens }: {
  model: ReturnType<typeof slidesModel>;
  instructions: string;
  input: string;
  userId: string;
  request: Request;
  // この用途の出力の上限。モデルの上限が小さければそちら。
  maxOutputTokens: number;
}): Promise<string | null> {
  try {
    const reply = await generateOneShotText({
      provider: model.option.provider,
      model: model.upstream,
      effort: model.option.defaultReasoning,
      instructions,
      input,
      userId,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(PAGE_TIMEOUT_MS)]),
      maxOutputTokens: Math.min(maxOutputTokens, model.option.tokenLimits?.maxOutputTokens || maxOutputTokens),
    });
    if (reply.cutOff || !reply.text.trim()) {
      console.error("Slides generation stopped early", reply.cutOff ? "max output tokens" : "empty output");
      return null;
    }
    return reply.text;
  } catch (error) {
    console.error("Failed to generate slides", error instanceof Error ? error.message : error);
    return null;
  }
}
