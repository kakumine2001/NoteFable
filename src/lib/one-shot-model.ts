import { buildAnthropicRequest, extractAnthropicText, requestAnthropic } from "@/lib/anthropic-messages";
import { extractResponseText } from "@/lib/chat-title";
import { buildDeepSeekResponsesRequest } from "@/lib/deepseek-responses";
import { optionalEnv, requireEnv } from "@/lib/env";
import type { ModelProvider, ReasoningEffort } from "@/lib/models";
import { stringifyJsonForProxy } from "@/lib/proxy-json";
import { buildUpstreamErrorMessage } from "@/lib/upstream-errors";

// 1 回きりの生成（Create page・画成図など、チャットの流れの外で選択中のモデルに 1 度だけ頼むもの）の要求。
// 検索・Notes のツール・圧縮・キャッシュは使わず、非ストリームで本文の文字だけを受け取る。プロバイダーごとの違いはここだけに置く
// （OpenAI / DeepSeek は Responses API、Anthropic は Messages API。docs/architecture/provider-requests.md）。

export class OneShotGenerationError extends Error {}

// 会話の 1 発言。最後は user。直し（画成図の作り直し）では、前の出力を assistant、直す指示を user として続ける。
export type OneShotTurn = { role: "user" | "assistant"; content: string };

type ResponsesResult = Parameters<typeof extractResponseText>[0] & { status?: string; incomplete_details?: { reason?: string } };

// 出力の上限で止まったときは、書けた分を cutOff: true で返す（何もなければ空の text）。それ以外の止まり方は失敗。
export async function generateOneShotText({ provider, model, effort, instructions, input, userId, signal, maxOutputTokens }: {
  provider: ModelProvider;
  model: string;
  effort: ReasoningEffort;
  instructions: string;
  input: string | readonly OneShotTurn[];
  userId: string;
  signal: AbortSignal;
  maxOutputTokens: number;
}): Promise<{ text: string; cutOff: boolean }> {
  const turns: OneShotTurn[] = typeof input === "string" ? [{ role: "user", content: input }] : [...input];
  if (provider === "anthropic") {
    const response = await requestAnthropic(buildAnthropicRequest({
      model,
      instructions,
      input: turns,
      effort,
      stream: false,
      maxTokens: maxOutputTokens,
    }), signal);
    const data = await response.json();
    if (data.stop_reason !== "end_turn" && data.stop_reason !== "max_tokens") throw new OneShotGenerationError(`Claude stopped with ${String(data.stop_reason)}.`);
    return { text: extractAnthropicText(data), cutOff: data.stop_reason === "max_tokens" };
  }
  const deepseek = provider === "deepseek";
  const url = deepseek
    ? `${(optionalEnv("DEEPSEEK_BASE_URL") || "https://api.deepseek.com").replace(/\/$/, "")}/responses`
    : `${(optionalEnv("OPENAI_BASE_URL") || "https://api.openai.com/v1").replace(/\/$/, "")}/responses`;
  const key = requireEnv(deepseek ? "DEEPSEEK_API_KEY" : "OPENAI_API_KEY");
  // 1 発言だけなら、これまでどおり文字のまま送る（Create page の要求の形を変えない）。
  const responsesInput = typeof input === "string" ? input : turns;
  // DeepSeek には検索・safety_identifier・store を送らない（チャットと同じ）。
  const body = deepseek
    ? JSON.stringify(buildDeepSeekResponsesRequest({ model, instructions, input: responsesInput, effort, maxOutputTokens, stream: false }))
    : stringifyJsonForProxy({
        model,
        instructions,
        input: responsesInput,
        reasoning: { effort },
        max_output_tokens: maxOutputTokens,
        safety_identifier: userId,
        store: false,
        stream: false,
      });
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body,
    signal,
  });
  if (!response.ok) {
    const raw = await response.text();
    throw new OneShotGenerationError(buildUpstreamErrorMessage(deepseek ? "DeepSeek" : "OpenAI", response.status, raw));
  }
  const data = (await response.json()) as ResponsesResult;
  const cutOff = data.status === "incomplete" && data.incomplete_details?.reason === "max_output_tokens";
  if (data.status && data.status !== "completed" && !cutOff) throw new OneShotGenerationError(`Response ${data.status}: ${data.incomplete_details?.reason ?? "unknown"}.`);
  return { text: extractResponseText(data), cutOff };
}
