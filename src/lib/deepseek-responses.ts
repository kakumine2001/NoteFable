export type DeepSeekResponsesInput = {
  role: string;
  content: unknown;
};

export type DeepSeekResponsesTool = {
  type: "web_search";
};

export type DeepSeekResponsesToolChoice = "auto" | "required" | "none";

export type DeepSeekResponsesRequest = {
  model: string;
  instructions: string;
  input: DeepSeekResponsesInput[] | string;
  reasoning?: {
    effort: string;
  };
  tools?: DeepSeekResponsesTool[];
  tool_choice?: DeepSeekResponsesToolChoice;
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
};

export function buildDeepSeekResponsesRequest({
  model,
  instructions,
  input,
  effort,
  tools,
  toolChoice,
  maxOutputTokens,
  stream,
}: {
  model: string;
  instructions: string;
  input: DeepSeekResponsesInput[] | string;
  effort?: string;
  tools?: DeepSeekResponsesTool[];
  toolChoice?: DeepSeekResponsesToolChoice;
  maxOutputTokens?: number;
  stream: boolean;
}): DeepSeekResponsesRequest {
  return {
    model,
    instructions,
    input,
    ...(effort ? { reasoning: { effort } } : {}),
    ...(tools?.length ? { tools } : {}),
    ...(toolChoice ? { tool_choice: toolChoice } : {}),
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

  // Web検索中のイベントや推論差分は画面に出さず、本文差分だけを転送する。
  return data.type === "response.output_text.delta" ? (data.delta ?? "") : "";
}
