// チャットの自前ツール（Pages など）を、プロバイダーに依存しない形で扱う共通部品。
// 各プロバイダーのループ（anthropic-messages.ts / responses-tool-loop.ts）はここを経由して実行する。

export type ToolDefinition = { name: string; description: string; parameters: Record<string, unknown> };
// label は進捗表示用の短い説明。content がモデルへ返すツール結果の本文になる。
// events はモデルには見せず、画面へ流すだけの追加イベント（編集案など）。
export type ToolRun = { content: string; isError?: boolean; label: string; events?: object[] };
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

// 同じラウンドの呼び出しは並列に実行し、結果は呼び出し順で返す。
// 途中経過は studymate.tool イベントとして送り、chat-activity.ts が表示用に変換する。
export async function runToolCalls(calls: ToolCall[], runTool: ToolRunner, send: (event: object) => void): Promise<ToolRun[]> {
  return Promise.all(calls.map(async (call, index) => {
    if (index >= MAX_TOOL_CALLS_PER_ROUND) {
      return { content: `Too many tool calls in one turn. Call at most ${MAX_TOOL_CALLS_PER_ROUND} tools at once.`, isError: true, label: "Skipped tool call" };
    }
    send({ type: "studymate.tool", id: call.id, name: call.name, status: "running" });
    const result = await runTool(call.name, call.input).catch((): ToolRun => ({
      content: "The tool failed. Tell the user it could not be completed.", isError: true, label: "Tool failed",
    }));
    send({ type: "studymate.tool", id: call.id, name: call.name, status: "done", label: result.label });
    for (const event of result.events ?? []) send(event);
    return result;
  }));
}
