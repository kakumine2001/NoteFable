import { optionalEnv, requireEnv } from "@/lib/env";
import { closeQuietly, consumeSseData } from "@/lib/sse";
import { buildUpstreamErrorMessage } from "@/lib/upstream-errors";
import { ANTHROPIC_HAIKU_LIMITS, type ReasoningEffort } from "@/lib/models";
import type { WebSearchMode } from "@/lib/web-search";
import { MAX_TOOL_ROUNDS, parseToolArguments, runToolCalls, storedToolText, toAnthropicToolContent, type ToolDefinition, type ToolRunner } from "@/lib/chat-tools";
import { msg, fmt } from "@/lib/i18n/translate";

type Block = {
  type: string;
  text?: string;
  thinking?: string;
  signature?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  citations?: unknown[];
  [key: string]: unknown;
};
type Message = { role: "user" | "assistant"; content: Block[] };
type Input = { role: string; content: unknown };

// The shared history uses Responses input parts. Translate only at the provider boundary.
export function toAnthropicMessages(input: Input[]): Message[] {
  return input.map((message) => {
    const role = message.role === "assistant" ? "assistant" : "user";
    const parts = typeof message.content === "string"
      ? [{ type: "input_text", text: message.content }]
      : message.content;
    if (!Array.isArray(parts)) throw new Error("Invalid Claude message content.");
    const content: Block[] = parts.filter((part) => !((part.type === "input_text" || part.type === "output_text") && typeof part.text === "string" && !part.text.trim())).map((part) => {
      if ((part.type === "input_text" || part.type === "output_text") && typeof part.text === "string") {
        return { type: "text", text: part.text };
      }
      if (part.type === "input_image" && typeof part.image_url === "string") {
        const match = part.image_url.match(/^data:(image\/(?:png|jpeg|webp));base64,([\s\S]+)$/);
        if (!match || role !== "user") throw new Error("Invalid Claude image input.");
        return { type: "image", source: { type: "base64", media_type: match[1], data: match[2] } };
      }
      throw new Error("Unsupported Claude input part.");
    });
    if (!content.length) throw new Error("Claude message has no text or image content.");
    return { role, content };
  });
}

export function buildAnthropicRequest({ model, instructions, input, effort, webSearchMode = "off", stream = true, maxTokens = ANTHROPIC_HAIKU_LIMITS.maxOutputTokens, compaction = false, nativeContext = [], customTools = [], cache = false }: {
  model: string;
  instructions: string;
  input: Input[];
  effort: ReasoningEffort;
  webSearchMode?: WebSearchMode;
  stream?: boolean;
  maxTokens?: number;
  compaction?: boolean;
  nativeContext?: Record<string, unknown>[];
  customTools?: ToolDefinition[];
  // 会話の続きで同じ prefix を再送するリクエストだけ有効にする。単発のタイトル生成では書き込み料金が無駄になる。
  cache?: boolean;
}) {
  if (!["low", "medium", "high", "xhigh", "max"].includes(effort)) {
    throw new Error("Unsupported Claude effort.");
  }
  const tools = [
    ...(webSearchMode !== "off" ? [{ type: "web_search_20250305", name: "web_search" }] : []),
    ...customTools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.parameters })),
  ];
  return {
    model,
    system: instructions,
    messages: [...nativeContext as Message[], ...toAnthropicMessages(input)],
    max_tokens: maxTokens,
    // 自動キャッシュ: 最後のブロックに breakpoint を置き、ツールループの次ラウンドや次の発言で前回までの prefix を読む。
    ...(cache ? { cache_control: { type: "ephemeral" } } : {}),
    thinking: { type: "adaptive", display: "summarized" },
    output_config: { effort },
    ...(compaction ? { context_management: { edits: [{ type: "compact_20260112" }] } } : {}),
    ...(tools.length ? {
      tools,
      tool_choice: webSearchMode === "force" ? { type: "tool", name: "web_search" } : { type: "auto" },
    } : {}),
    stream,
  };
}

// Messages API の URL。ANTHROPIC_BASE_URL は公式 SDK と同じく /v1 なし（https://api.anthropic.com）でも、
// /v1 付きでも受け付ける。末尾が /v1 でなければ補う。
export function anthropicMessagesUrl(base = optionalEnv("ANTHROPIC_BASE_URL")) {
  return (base?.trim() || "https://api.anthropic.com").replace(/\/+$/, "").replace(/(?:\/v1)?$/, "/v1/messages");
}

export async function requestAnthropic(body: object, signal?: AbortSignal) {
  const serialized = JSON.stringify(body);
  if (Buffer.byteLength(serialized, "utf8") > 32_000_000) throw new Error(msg("Claude's request is too large. Remove images or start a new chat."));
  const response = await fetch(anthropicMessagesUrl(), {
    method: "POST",
    headers: {
      "x-api-key": requireEnv("ANTHROPIC_API_KEY"),
      "anthropic-version": "2023-06-01",
      ...("context_management" in body ? { "anthropic-beta": "compact-2026-01-12" } : {}),
      "Content-Type": "application/json",
    },
    body: serialized,
    signal,
  });
  if (!response.ok) {
    const raw = await response.text();
    let message: string | undefined;
    try { message = JSON.parse(raw).error?.message; } catch { /* HTML / empty error */ }
    throw new Error(message || buildUpstreamErrorMessage("Anthropic", response.status, raw));
  }
  return response;
}

export function extractAnthropicText(data: { content?: Block[] }) {
  return (data.content ?? []).filter((block) => block.type === "text").map((block) => block.text ?? "").join("");
}

type Event = {
  type: string;
  index?: number;
  content_block?: Block;
  delta?: { type?: string; text?: string; content?: string; thinking?: string; signature?: string; partial_json?: string; citation?: { type?: string; url?: string; title?: string }; stop_reason?: string };
  error?: { message?: string };
};

// Preserve native blocks for pause_turn continuation, while exposing only text, summaries and citations.
export class AnthropicStreamTurn {
  constructor(private readonly turnId = "0") {}
  blocks: Block[] = [];
  completed = false;
  stopReason = "";
  private inputs = new Map<number, string>();

  push(event: Event): object[] {
    if (event.type === "error") throw new Error(event.error?.message || msg("Anthropic stream failed."));
    const index = event.index ?? 0;
    const output: object[] = [];
    if (event.type === "content_block_start" && event.content_block) {
      const block = structuredClone(event.content_block);
      this.blocks[index] = block;
      if (block.type === "text" && block.text) output.push({ type: "response.output_text.delta", delta: block.text });
      if (block.type === "server_tool_use" && block.name === "web_search") {
        output.push({ type: "response.output_item.added", item: { type: "web_search_call", id: block.id } });
      }
      if (block.type === "web_search_tool_result") {
        if (!Array.isArray(block.content)) {
          output.push({ type: "response.reasoning_summary_text.delta", item_id: `claude-search-error-${this.turnId}-${index}`, delta: "Web search was unavailable; this answer may lack current verification." });
        }
        const tool = this.blocks.find((item) => item?.id === block.tool_use_id);
        output.push({ type: "response.output_item.done", item: {
          type: "web_search_call", id: block.tool_use_id,
          action: { type: "search", query: (tool?.input as { query?: string } | undefined)?.query, sources: Array.isArray(block.content) ? block.content : [] },
        } });
      }
    }
    const block = this.blocks[index];
    if (event.type === "content_block_delta" && block) {
      const delta = event.delta;
      if (delta?.type === "text_delta" && block.type === "text") {
        block.text = (block.text ?? "") + (delta.text ?? "");
        output.push({ type: "response.output_text.delta", delta: delta.text ?? "" });
      } else if (delta?.type === "compaction_delta" && block.type === "compaction") {
        block.content = (typeof block.content === "string" ? block.content : "") + (delta.content ?? "");
      } else if (delta?.type === "thinking_delta" && block.type === "thinking") {
        block.thinking = (block.thinking ?? "") + (delta.thinking ?? "");
        output.push({ type: "response.reasoning_summary_text.delta", item_id: `claude-thinking-${this.turnId}-${index}`, delta: delta.thinking ?? "" });
      } else if (delta?.type === "signature_delta") {
        block.signature = (block.signature ?? "") + (delta.signature ?? "");
      } else if (delta?.type === "input_json_delta") {
        this.inputs.set(index, (this.inputs.get(index) ?? "") + (delta.partial_json ?? ""));
      } else if (delta?.type === "citations_delta" && delta.citation) {
        block.citations = [...(block.citations ?? []), delta.citation];
        output.push({ type: "response.output_text.annotation.added", annotation: { type: "url_citation", url: delta.citation.url, title: delta.citation.title } });
      }
    }
    if (event.type === "content_block_stop" && block && this.inputs.has(index)) {
      block.input = parseToolArguments(this.inputs.get(index));
    }
    if (event.type === "message_delta") this.stopReason = event.delta?.stop_reason ?? this.stopReason;
    if (event.type === "message_stop") {
      if (!["end_turn", "stop_sequence", "pause_turn", "tool_use"].includes(this.stopReason)) {
        throw new Error(fmt("Claude response stopped: {reason}. Please retry.", { reason: this.stopReason || "unknown reason" }));
      }
      this.completed = true;
    }
    return output;
  }

  finish() {
    if (!this.completed) throw new Error(msg("Claude stream ended before completion. Please retry."));
  }
}

// Convert Messages SSE to the existing frontend contract. Continue long server-tool turns unchanged,
// and run NoteFable's own tools (tool_use) through runTool before asking Claude to continue.
export async function createAnthropicStream(
  body: ReturnType<typeof buildAnthropicRequest>,
  onContext?: (items: Record<string, unknown>[]) => void,
  runTool?: ToolRunner,
  signal?: AbortSignal,
) {
  const abort = new AbortController();
  // クライアントの切断でも、上流リクエストとツールループを止める。
  if (signal?.aborted) abort.abort();
  signal?.addEventListener("abort", () => abort.abort(), { once: true });
  let response = await requestAnthropic(body, abort.signal);
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        let answerText = "";
        let compactedContext: Message[] | undefined;
        let separateNextText = false;
        const send = (event: object) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        for (let attempt = 0; attempt < MAX_TOOL_ROUNDS; attempt++) {
          if (!response.body) throw new Error(msg("Anthropic response has no stream body."));
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          const turn = new AnthropicStreamTurn(String(attempt));
          let buffer = "";
          const forward = (payloads: string[]) => {
            for (const payload of payloads) {
              for (const event of turn.push(JSON.parse(payload))) {
                if ((event as { type?: string }).type === "response.output_text.delta") {
                  // Text written before a tool call and the answer after it must not run together.
                  if (separateNextText) {
                    send({ type: "response.output_text.delta", delta: "\n\n" });
                    answerText += "\n\n";
                    separateNextText = false;
                  }
                  answerText += (event as { delta: string }).delta;
                }
                send(event);
              }
            }
          };
          try {
            while (true) {
              const chunk = await reader.read();
              if (chunk.done) break;
              buffer += decoder.decode(chunk.value, { stream: true });
              const batch = consumeSseData(buffer);
              buffer = batch.remainder;
              forward(batch.data);
            }
            forward(consumeSseData(buffer + decoder.decode(), true).data);
          } finally {
            await reader.cancel().catch(() => {});
            reader.releaseLock();
          }
          turn.finish();
          const compactIndex = turn.blocks.findLastIndex((block) => block?.type === "compaction");
          const reusable = turn.blocks.slice(compactIndex >= 0 ? compactIndex : 0)
            .filter((block) => block.type !== "thinking" && block.type !== "redacted_thinking" && (block.type !== "text" || block.text?.trim()));
          if (compactIndex >= 0) compactedContext = [{ role: "assistant", content: reusable }];
          else if (compactedContext && reusable.length) compactedContext.push({ role: "assistant", content: reusable });
          const content = turn.blocks.filter((block) => block.type !== "text" || block.text?.trim());
          if (turn.stopReason === "tool_use") {
            const calls = turn.blocks.filter((block) => block?.type === "tool_use")
              .map((block) => ({ id: String(block.id), name: String(block.name), input: block.input ?? {} }));
            if (!runTool || !calls.length) throw new Error(msg("Claude requested an unavailable tool. Please retry."));
            const runs = await runToolCalls(calls, runTool, send);
            if (abort.signal.aborted) return closeQuietly(controller);
            const toolMessage: Message = { role: "user", content: runs.map((run, index) => ({
              type: "tool_result", tool_use_id: calls[index].id, content: toAnthropicToolContent(run), ...(run.isError ? { is_error: true } : {}),
            })) };
            // A replayed tool_use must be followed by its tool_result, so keep the pair in the checkpoint (text only: preview images are not stored).
            compactedContext?.push({ role: "user", content: runs.map((run, index) => ({
              type: "tool_result", tool_use_id: calls[index].id, content: storedToolText(run), ...(run.isError ? { is_error: true } : {}),
            })) });
            if (attempt === MAX_TOOL_ROUNDS - 1) throw new Error(msg("Claude tool round limit reached. Please retry."));
            separateNextText = Boolean(answerText.trim());
            body = { ...body, tool_choice: { type: "auto" }, messages: [...body.messages, { role: "assistant", content }, toolMessage] };
            response = await requestAnthropic(body, abort.signal);
            continue;
          }
          if (turn.stopReason !== "pause_turn") {
            if (!answerText.trim()) throw new Error(msg("Claude returned an empty response. Please retry."));
            if (compactedContext) onContext?.(compactedContext);
            controller.enqueue(encoder.encode('data: {"type":"response.completed"}\n\n'));
            controller.close();
            return;
          }
          if (attempt === MAX_TOOL_ROUNDS - 1) throw new Error(msg("Claude search continuation limit reached. Please retry."));
          body = { ...body, ...(body.tools ? { tool_choice: { type: "auto" } } : {}), messages: [...body.messages, { role: "assistant", content }] };
          response = await requestAnthropic(body, abort.signal);
        }
      } catch (error) {
        if (abort.signal.aborted) return closeQuietly(controller);
        abort.abort();
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", error: { message: error instanceof Error ? error.message : msg("Anthropic stream failed.") } })}\n\n`));
        controller.close();
      }
    },
    cancel() { abort.abort(); },
  });
}
