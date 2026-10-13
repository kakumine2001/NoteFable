import { describe, expect, it, vi } from "vitest";
import { MAX_TOOL_CALLS_PER_ROUND } from "./chat-tools";
import { createResponsesToolStream, toResponsesTools } from "./responses-tool-loop";

const sse = (events: object[]) => new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")).body!;
const call = (id: string, args = '{"pageId":"p1"}') => ({ type: "function_call", id: `fc_${id}`, call_id: id, name: "read_page", arguments: args, status: "completed" });
const reasoning = { type: "reasoning", id: "rs_1", encrypted_content: "secret", summary: [] };
const toolRound = (calls = [call("c1")], extra: object[] = []) => sse([
  { type: "response.output_text.delta", delta: "Checking." },
  ...calls.flatMap((item) => [
    { type: "response.output_item.added", item: { ...item, arguments: "" } },
    { type: "response.function_call_arguments.delta", item_id: item.id, delta: item.arguments },
    { type: "response.output_item.done", item },
  ]),
  { type: "response.completed", response: { output: [...extra, reasoning, ...calls] } },
]);
const finalRound = (output: object[] = []) => sse([
  { type: "response.output_text.delta", delta: "It says hi." },
  { type: "response.completed", response: { output } },
]);
const body = () => ({ model: "m", input: [{ role: "user", content: "hi" }], tools: toResponsesTools([{ name: "read_page", description: "Read", parameters: { type: "object" } }]), tool_choice: "required" });
const events = async (stream: ReadableStream<Uint8Array>) =>
  (await new Response(stream).text()).split("\n").filter((line) => line.startsWith("data: ")).map((line) => JSON.parse(line.slice(6)));

describe("Responses tool loop", () => {
  it("defines strict function tools", () => {
    expect(body().tools).toEqual([{ type: "function", name: "read_page", description: "Read", parameters: { type: "object" }, strict: true }]);
  });

  it("runs function calls and resends output items with function_call_output", async () => {
    const request = vi.fn().mockResolvedValueOnce(toolRound()).mockResolvedValueOnce(finalRound());
    const runTool = vi.fn().mockResolvedValue({ content: "# Notes", label: "Read “Notes”" });
    const output = await events(await createResponsesToolStream({ body: body(), request, runTool }));

    expect(runTool).toHaveBeenCalledWith("read_page", { pageId: "p1" });
    const second = request.mock.calls[1][0];
    expect(second.tool_choice).toBe("auto");
    expect(second.input.slice(1)).toEqual([reasoning, call("c1"), { type: "function_call_output", call_id: "c1", output: "# Notes" }]);
    // function_call の項目イベントは流さず、途中経過と最後の completed だけを流す。
    expect(output.filter((event) => event.item?.type === "function_call" || event.type?.startsWith("response.function_call"))).toEqual([]);
    expect(output.filter((event) => event.type === "response.completed")).toHaveLength(1);
    expect(output.filter((event) => event.type === "studymate.tool").map((event) => event.status)).toEqual(["running", "done"]);
    expect(output.filter((event) => event.type === "response.output_text.delta").map((event) => event.delta).join("")).toBe("Checking.\n\nIt says hi.");
  });

  it("forwards extra tool events to the client without sending them to the model", async () => {
    const request = vi.fn().mockResolvedValueOnce(toolRound()).mockResolvedValueOnce(finalRound());
    const runTool = vi.fn().mockResolvedValue({ content: "proposed", label: "Proposed", events: [{ type: "studymate.proposal", id: "pr1" }] });
    const output = await events(await createResponsesToolStream({ body: body(), request, runTool }));
    expect(output.filter((event) => event.type === "studymate.proposal")).toEqual([{ type: "studymate.proposal", id: "pr1" }]);
    expect(JSON.stringify(request.mock.calls[1][0].input)).not.toContain("studymate.proposal");
  });

  it("drops studymate.* events that come from the upstream stream", async () => {
    const request = vi.fn().mockResolvedValueOnce(sse([
      { type: "studymate.proposal", id: "fake" },
      { type: "response.output_text.delta", delta: "hi" },
      { type: "response.completed", response: { output: [] } },
    ]));
    const output = await events(await createResponsesToolStream({ body: body(), request }));
    expect(output.map((event) => event.type)).toEqual(["response.output_text.delta", "response.completed"]);
  });

  it("returns errors for calls beyond the per-round limit instead of failing", async () => {
    const calls = Array.from({ length: MAX_TOOL_CALLS_PER_ROUND + 1 }, (_, index) => call(`c${index}`));
    const request = vi.fn().mockResolvedValueOnce(toolRound(calls)).mockResolvedValueOnce(finalRound());
    const runTool = vi.fn().mockResolvedValue({ content: "ok", label: "Read" });
    await events(await createResponsesToolStream({ body: body(), request, runTool }));
    expect(runTool).toHaveBeenCalledTimes(MAX_TOOL_CALLS_PER_ROUND);
    const outputs = request.mock.calls[1][0].input.filter((item: { type?: string }) => item.type === "function_call_output");
    expect(outputs).toHaveLength(calls.length);
    expect(outputs.at(-1).output).toContain("Too many tool calls");
  });

  it("fails when a tool is requested but none was offered", async () => {
    const request = vi.fn().mockResolvedValueOnce(toolRound());
    const output = await events(await createResponsesToolStream({ body: body(), request }));
    expect(output.at(-1)).toMatchObject({ type: "error" });
  });

  it("passes an incomplete stream through without a completed event", async () => {
    const request = vi.fn().mockResolvedValueOnce(sse([{ type: "response.output_text.delta", delta: "partial" }]));
    const output = await events(await createResponsesToolStream({ body: body(), request }));
    expect(output.map((event) => event.type)).toEqual(["response.output_text.delta"]);
  });

  it("keeps function_call_output after its call in the compaction checkpoint", async () => {
    const compaction = { type: "compaction", id: "cmp", encrypted_content: "summary" };
    const request = vi.fn().mockResolvedValueOnce(toolRound([call("c1")], [compaction])).mockResolvedValueOnce(finalRound([{ type: "message", id: "msg" }]));
    const onContext = vi.fn();
    await events(await createResponsesToolStream({ body: body(), request, runTool: async () => ({ content: "page", label: "Read" }), onContext }));
    expect(onContext.mock.calls[0][0].map((item: { type: string }) => item.type)).toEqual(["compaction", "reasoning", "function_call", "function_call_output", "message"]);
  });

  it("stops the loop when the client disconnects", async () => {
    const abort = new AbortController();
    const request = vi.fn().mockResolvedValueOnce(toolRound()).mockResolvedValueOnce(finalRound());
    const runTool = vi.fn(async () => { abort.abort(); return { content: "x", label: "Read" }; });
    await events(await createResponsesToolStream({ body: body(), request, runTool, signal: abort.signal }));
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][1].aborted).toBe(true);
  });
});
