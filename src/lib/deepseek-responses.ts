import { msg } from "@/lib/i18n/translate";
export type DeepSeekResponsesInput = {
  role: string;
  content: unknown;
};

export type DeepSeekResponsesRequest = {
  model: string;
  instructions: string;
  input: DeepSeekResponsesInput[] | string;
  reasoning?: {
    effort: string;
  };
  max_output_tokens?: number;
  stream: boolean;
};

type DeepSeekResponsesEvent = {
  type?: string;
  delta?: string | null;
  error?: {
    message?: string | null;
  };
  response?: {
    error?: {
      message?: string | null;
    };
  };
  item?: { type?: string };
};

// DeepSeek の Responses API はモデルによって組み込み検索ツールの type が異なる：
// deepseek-v4-pro は web_search、それ以外（deepseek-flash / DeepSeek-V4.1-Flash 等）は deepseek_web_search を送る。
export function deepSeekWebSearchTool(model: string): { type: "deepseek_web_search" } | { type: "web_search" } {
  const normalized = model.trim().toLowerCase();
  return normalized === "deepseek-v4-pro" || normalized.startsWith("deepseek-v4-pro-")
    ? { type: "web_search" }
    : { type: "deepseek_web_search" };
}

export function buildDeepSeekResponsesRequest({
  model,
  instructions,
  input,
  effort,
  maxOutputTokens,
  stream,
}: {
  model: string;
  instructions: string;
  input: DeepSeekResponsesInput[] | string;
  effort?: string;
  maxOutputTokens?: number;
  stream: boolean;
}): DeepSeekResponsesRequest {
  return {
    model,
    instructions,
    input,
    ...(effort ? { reasoning: { effort } } : {}),
    ...(maxOutputTokens ? { max_output_tokens: maxOutputTokens } : {}),
    stream,
  };
}

export function parseDeepSeekResponsesDelta(line: string) {
  const data = JSON.parse(line) as DeepSeekResponsesEvent;

  if (data.type === "error" || data.type === "response.failed") {
    throw new Error(
      data.error?.message ??
        data.response?.error?.message ??
        msg("DeepSeek Responses API returned an error."),
    );
  }

  if (data.type === "response.incomplete") {
    throw new Error(msg("DeepSeek response was incomplete. Please retry."));
  }

  if (data.item?.type === "function_call" || data.item?.type === "custom_tool_call") {
    throw new Error(msg("DeepSeek requested an unavailable tool. Use GPT for web search."));
  }

  // 推論差分は本文に混ぜず（途中経過として chat-activity で別に扱う）、本文差分だけを返す。
  return data.type === "response.output_text.delta" ? (data.delta ?? "") : "";
}
