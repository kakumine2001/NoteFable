import { MAX_TOOL_ROUNDS, parseToolArguments, runToolCalls, type ToolDefinition, type ToolRunner } from "@/lib/chat-tools";
import { closeQuietly, consumeSseData } from "@/lib/sse";
import { msg } from "@/lib/i18n/translate";

type Item = Record<string, unknown>;
type ResponsesBody = { input: unknown[]; tools?: unknown[]; tool_choice?: unknown; [key: string]: unknown };
type StreamEvent = { type?: string; delta?: string; item?: Item; response?: { output?: Item[] } };

// 自前ツールを Responses API の function ツール形式にする。OpenAI と DeepSeek で共通。
export function toResponsesTools(tools: ToolDefinition[]) {
  return tools.map((tool) => ({ type: "function", name: tool.name, description: tool.description, parameters: tool.parameters, strict: true }));
}

function isFunctionCall(item: Item | undefined) {
  return item?.type === "function_call";
}

// OpenAI / DeepSeek の Responses ストリームを読み、function_call があれば実行して続きを要求する。
// 呼び出し側（chat route）には、従来どおり 1 本の SSE に見えるよう次の形で流す。
// - 途中ラウンドの response.completed は流さず、最後のラウンドのものだけを流す
// - function_call の項目イベントは流さず、studymate.tool の途中経過イベントに置き換える
// - ツール前後の本文が続かないよう、間に空行を入れる
// store: false のため、各ラウンドの出力項目（暗号化済み推論を含む）と function_call_output を input に積んで送り直す。
export async function createResponsesToolStream({
  body,
  request,
  runTool,
  onContext,
  signal,
}: {
  body: ResponsesBody;
  request: (body: ResponsesBody, signal: AbortSignal) => Promise<ReadableStream<Uint8Array>>;
  runTool?: ToolRunner;
  // サーバー側コンパクションの再利用用。最後の compaction 項目以降の項目を、ツール結果と組にして渡す。
  onContext?: (items: Item[]) => void;
  signal?: AbortSignal;
}) {
  const abort = new AbortController();
  if (signal?.aborted) abort.abort();
  signal?.addEventListener("abort", () => abort.abort(), { once: true });
  let upstream = await request(body, abort.signal);
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: object) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      let answered = false;
      let separateNextText = false;
      let context: Item[] | undefined;
      try {
        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          const reader = upstream.getReader();
          const decoder = new TextDecoder();
          const items: Item[] = [];
          let output: Item[] | undefined;
          let completed: string | undefined;
          let buffer = "";
          const forward = (payloads: string[]) => {
            for (const payload of payloads) {
              const event = JSON.parse(payload) as StreamEvent;
              if (event.type === "response.output_item.done" && event.item) items.push(event.item);
              if (event.type === "response.completed") {
                completed = payload;
                if (Array.isArray(event.response?.output)) output = event.response.output;
                continue;
              }
              // studymate.* は自前のツール実行からだけ出す。上流からの同名イベントは通さない。
              if (event.type?.startsWith("studymate.")) continue;
              if (isFunctionCall(event.item) || event.type?.startsWith("response.function_call_arguments.")) continue;
              if (event.type === "response.output_text.delta" && event.delta) {
                if (separateNextText) send({ type: "response.output_text.delta", delta: "\n\n" });
                separateNextText = false;
                answered = true;
              }
              controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
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
          // 完了イベントがない場合（エラーや途中終了）は、ここまでの内容だけを渡して呼び出し側に判定させる。
          if (!completed) return closeQuietly(controller);

          const roundItems = output?.length ? output : items;
          const compactIndex = roundItems.findLastIndex((item) => item.type === "compaction");
          if (compactIndex >= 0) context = roundItems.slice(compactIndex);
          else context?.push(...roundItems);

          const calls = roundItems.filter(isFunctionCall)
            .map((item) => ({ id: String(item.call_id), name: String(item.name), input: parseToolArguments(item.arguments) }));
          if (!calls.length) {
            controller.enqueue(encoder.encode(`data: ${completed}\n\n`));
            if (context) onContext?.(context);
            return closeQuietly(controller);
          }
          if (!runTool) throw new Error(msg("The model requested an unavailable tool. Please retry."));
          const runs = await runToolCalls(calls, runTool, send);
          if (abort.signal.aborted) return closeQuietly(controller);
          const results = runs.map((run, index) => ({ type: "function_call_output", call_id: calls[index].id, output: run.content }));
          // 再送時に function_call だけが残らないよう、コンテキストにも結果を組で入れる。
          context?.push(...results);
          if (round === MAX_TOOL_ROUNDS - 1) throw new Error(msg("Tool round limit reached. Please retry."));
          separateNextText = answered;
          body = { ...body, ...(body.tools ? { tool_choice: "auto" } : {}), input: [...body.input, ...roundItems, ...results] };
          upstream = await request(body, abort.signal);
        }
      } catch (error) {
        if (abort.signal.aborted) return closeQuietly(controller);
        abort.abort();
        send({ type: "error", error: { message: error instanceof Error ? error.message : msg("Responses stream failed.") } });
        closeQuietly(controller);
      }
    },
    cancel() { abort.abort(); },
  });
}
