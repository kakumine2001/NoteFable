// チャットの自前ツール（Notes など）を、プロバイダーに依存しない形で扱う共通部品。
// 各プロバイダーのループ（anthropic-messages.ts / responses-tool-loop.ts）はここを経由して実行する。

import { msg } from "@/lib/i18n/translate";

export type ToolDefinition = { name: string; description: string; parameters: Record<string, unknown> };
// ツール結果に添える画像（ページの予覧）。base64 は data: を付けない本体。
export type ToolImage = { mimeType: "image/png" | "image/jpeg" | "image/webp"; base64: string };
// label は進捗表示用の短い説明。content がモデルへ返すツール結果の本文になる。
// events はモデルには見せず、画面へ流すだけの追加イベント（編集案など）。
// images は結果の本文と一緒にモデルへ返す画像（Claude は tool_result の image、OpenAI・DeepSeek は function_call_output の input_image）。
export type ToolRun = { content: string; isError?: boolean; label: string; events?: object[]; images?: ToolImage[] };
export type ToolRunner = (name: string, input: unknown) => Promise<ToolRun>;
export type ToolCall = { id: string; name: string; input: unknown };

// 1 回の回答で上流へ送るリクエスト数の上限（Claude の pause_turn 続行を含む）。
export const MAX_TOOL_ROUNDS = 8;
// 1 ラウンドで実行する呼び出し数の上限。超えた分はエラー結果を返し、モデルに分けて呼び直させる。
export const MAX_TOOL_CALLS_PER_ROUND = 5;

// ツール引数の JSON 文字列を読む。壊れた JSON は空オブジェクトにし、ツール側の入力検証でエラーを返す。
export function parseToolArguments(raw: unknown): unknown {
  if (typeof raw !== "string") return raw ?? {};
  try {
    const value: unknown = JSON.parse(raw || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

// Responses API（OpenAI・DeepSeek）の function_call_output.output。画像があれば本文と画像の配列にする。
export function toResponsesToolOutput(run: ToolRun): string | object[] {
  if (!run.images?.length) return run.content;
  return [
    { type: "input_text", text: run.content },
    ...run.images.map((image) => ({ type: "input_image", image_url: `data:${image.mimeType};base64,${image.base64}` })),
  ];
}

// Messages API（Claude）の tool_result.content。画像があれば本文と画像のブロックの配列にする。
export function toAnthropicToolContent(run: ToolRun): string | object[] {
  if (!run.images?.length) return run.content;
  return [
    { type: "text", text: run.content },
    ...run.images.map((image) => ({ type: "image", source: { type: "base64", media_type: image.mimeType, data: image.base64 } })),
  ];
}

// 会話の文脈（圧縮のチェックポイント）に保存するツール結果。予覧の画像は保存しない（モデルはその回で見ている）。
export function storedToolText(run: ToolRun): string {
  if (!run.images?.length) return run.content;
  return `${run.content}\n\n[${run.images.length === 1 ? "The preview image is" : "The preview images are"} not kept in the conversation history.]`;
}

// 同じラウンドの呼び出しは並列に実行し、結果は呼び出し順で返す。
// 途中経過は notefable.tool イベントとして送り、chat-activity.ts が表示用に変換する。
export async function runToolCalls(calls: ToolCall[], runTool: ToolRunner, send: (event: object) => void): Promise<ToolRun[]> {
  return Promise.all(calls.map(async (call, index) => {
    if (index >= MAX_TOOL_CALLS_PER_ROUND) {
      return { content: `Too many tool calls in one turn. Call at most ${MAX_TOOL_CALLS_PER_ROUND} tools at once.`, isError: true, label: "Skipped tool call" };
    }
    send({ type: "notefable.tool", id: call.id, name: call.name, status: "running" });
    const result = await runTool(call.name, call.input).catch((): ToolRun => ({
      content: "The tool failed. Tell the user it could not be completed.", isError: true, label: msg("Tool failed"),
    }));
    send({ type: "notefable.tool", id: call.id, name: call.name, status: "done", label: result.label });
    for (const event of result.events ?? []) send(event);
    return result;
  }));
}
