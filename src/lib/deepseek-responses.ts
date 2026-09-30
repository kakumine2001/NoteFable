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
        "DeepSeek Responses API returned an error.",
    );
  }

  if (data.type === "response.incomplete") {
    throw new Error("DeepSeek response was incomplete. Please retry.");
  }

  if (data.item?.type === "function_call" || data.item?.type === "custom_tool_call") {
    throw new Error("DeepSeek requested an unavailable tool. Use GPT for web search.");
  }

  // 推論差分は画面に出さず、本文差分だけを転送する。
  return data.type === "response.output_text.delta" ? (data.delta ?? "") : "";
}
