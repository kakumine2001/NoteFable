import { NextResponse } from "next/server";
import { getOrCreateUser } from "@/lib/auth";
import { PAGE_TIMEOUT_MS } from "@/lib/chat-page";
import { msg } from "@/lib/i18n/translate";
import { getModelRegistry, upstreamModelFor } from "@/lib/model-registry";
import { getModelOption, normalizeModel } from "@/lib/models";
import { noteApiError } from "@/lib/note-api";
import { NoteValidationError, readNoteRequest } from "@/lib/note-document";
import { generateOneShotText } from "@/lib/one-shot-model";
import { isClientRequestId, isRecordId } from "@/lib/page-ai/ids";
import { readQuizMaterial } from "@/lib/page-ai/one-shot";
import { parseQuizOptions, parseQuizReply } from "@/lib/quiz/model";
import { quizInput, quizInstructions } from "@/lib/quiz/prompt";
import { issueQuizReportToken } from "@/lib/quiz-report-token";
import { clientNetworkKey, consumeUsage, refundUsage, usageLimitResponse, type UsageTicket } from "@/lib/usage-limits";
import { abandonUsageRequest, claimUsageRequest, completeUsageRequest, releaseUsageRequest, type UsageRequestClaim } from "@/lib/usage-requests";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_QUIZ_OUTPUT_TOKENS = 16_000;
const QUIZ_FAILED = msg("Could not generate a quiz. Try again.");

// ノートまたはスライドから復習・クイズ問題を AI が作成する。ページは作らず、元のページにも書き込まない（ゼロマイグレーション）。
// body: { pageId, options: { count, types, language }, model?, clientRequestId }
// → 200 { quiz, reportToken, partial? }（partial: 材料を上限で切った）
// 送信 1 回分（chat）として数え、上流エラー・途中終了・構造検証失敗のときは戻す。
// 同じ clientRequestId と同じ入力の送り直しは数え直さない（usage-requests.ts）。
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
  const options = parseQuizOptions(body.options);
  const clientRequestId = body.clientRequestId;
  if (!isRecordId(pageId) || !options || !isClientRequestId(clientRequestId)) {
    return NextResponse.json({ error: msg("Invalid JSON request.") }, { status: 400 });
  }

  let ticket: UsageTicket | undefined;
  let claim: Exclude<UsageRequestClaim, { state: "busy" }> | undefined;
  const giveUp = async () => {
    await refundUsage(ticket);
    ticket = undefined;
    if (claim?.state === "new") await releaseUsageRequest(claim);
    else if (claim?.state === "resume") await abandonUsageRequest(claim);
    claim = undefined;
  };

  try {
    const user = await getOrCreateUser();
    const material = await readQuizMaterial(user.id, pageId);
    if (!material) return NextResponse.json({ error: msg("Page not found.") }, { status: 404 });
    if (!material.text) return NextResponse.json({ error: msg("There is nothing to make a quiz from yet.") }, { status: 400 });

    const registry = getModelRegistry();
    const modelId = normalizeModel(typeof body.model === "string" ? body.model : null, registry);
    const modelOption = getModelOption(modelId, registry.options);
    const upstream = upstreamModelFor(modelId, registry.options);

    const claimed = await claimUsageRequest(user.id, "page-quiz", clientRequestId, { pageId, options, model: modelId });
    if (claimed.state === "busy") {
      return NextResponse.json({ error: msg("This request is still running. Try again in a moment."), code: "request_in_progress" }, { status: 409 });
    }
    claim = claimed;
    if (claim.state === "new") {
      const usage = await consumeUsage(user, "chat", clientNetworkKey(request));
      if (!usage.ok) {
        await giveUp();
        return usageLimitResponse(usage, "chat");
      }
      ticket = usage.ticket;
    }

    let rawText: string | null = null;
    try {
      const reply = await generateOneShotText({
        provider: modelOption.provider,
        model: upstream,
        effort: modelOption.defaultReasoning,
        instructions: quizInstructions(material.pageKind),
        input: quizInput(material.text, options),
        userId: user.id,
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(PAGE_TIMEOUT_MS)]),
        maxOutputTokens: Math.min(MAX_QUIZ_OUTPUT_TOKENS, modelOption.tokenLimits?.maxOutputTokens || MAX_QUIZ_OUTPUT_TOKENS),
      });
      if (reply.cutOff || !reply.text.trim()) {
        console.error("Quiz generation stopped early", reply.cutOff ? "max output tokens" : "empty output");
      } else {
        rawText = reply.text;
      }
    } catch (error) {
      console.error("Failed to generate quiz", error instanceof Error ? error.message : error);
    }

    const quiz = rawText === null ? null : parseQuizReply(rawText, options, material.title);
    if (!quiz) {
      if (rawText !== null) console.error("The quiz reply did not follow the schema");
      await giveUp();
      return NextResponse.json({ error: QUIZ_FAILED }, { status: 502 });
    }

    const reportToken = await issueQuizReportToken(user.id, { pageId, pageKind: material.pageKind, model: modelId, quiz });
    await completeUsageRequest(claim);
    ticket = undefined;
    claim = undefined;
    return NextResponse.json({ quiz, reportToken, ...(material.truncated ? { partial: true } : {}) });
  } catch (error) {
    await giveUp();
    console.error("Quiz request failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: QUIZ_FAILED }, { status: 503 });
  }
}
