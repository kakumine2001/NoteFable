import { describe, expect, it } from "vitest";
import { applyActivityEvent, type ActivityStep } from "./chat-activity";
import { deriveTurnCharacterState } from "./characters";
import { parseChatStreamLine, readChatEventStream } from "./chat-stream";

function sseStreamFrom(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe("parseChatStreamLine", () => {
  it("reads text deltas, activity events, and ignores everything else", () => {
    expect(parseChatStreamLine('data: "Hello"')).toBe("Hello");
    expect(parseChatStreamLine('  data:"\\n"  ')).toBe("\n");
    const event = { type: "tool", id: "1", status: "running", name: "read_note" };
    expect(parseChatStreamLine(`data: ${JSON.stringify({ activity: event })}`)).toEqual(event);
    expect(parseChatStreamLine("data: {}")).toBeNull();
    expect(parseChatStreamLine("data: [DONE]")).toBeNull();
    expect(parseChatStreamLine("data:")).toBeNull();
    expect(parseChatStreamLine(": keep-alive")).toBeNull();
    expect(parseChatStreamLine("")).toBeNull();
  });

  it("throws on a malformed data line so callers can skip it", () => {
    expect(() => parseChatStreamLine("data: {oops")).toThrow();
  });
});

describe("readChatEventStream", () => {
  it("flags streamFailed=true and preserves partial output when a stream emits failure before normal EOF", async () => {
    const partial = "Photosynthesis converts light";
    const errorLine = "\n\nRequest failed: Provider connection reset.";
    const failureEvent = {
      type: "failure" as const,
      id: "request-failure",
      offset: partial.length + 2,
      detail: "Provider connection reset.",
    };
    const stream = sseStreamFrom([
      `data: ${JSON.stringify(partial)}\n\n`,
      `data: ${JSON.stringify(errorLine)}\n\ndata: ${JSON.stringify({ activity: failureEvent })}\n\n`,
    ]);

    let content = "";
    let steps: ActivityStep[] = [];
    const { streamFailed } = await readChatEventStream(stream, (chunk, activity) => {
      content += chunk;
      steps = activity.reduce(applyActivityEvent, steps);
    });

    expect(streamFailed).toBe(true);
    expect(content).toBe(`${partial}${errorLine}`);
    expect(steps).toEqual([
      { kind: "failure", id: "request-failure", offset: partial.length + 2, detail: "Provider connection reset." },
    ]);

    const outcome = streamFailed ? "error" : "completed";
    expect(deriveTurnCharacterState({ isBusy: false, hasOutput: true, outcome })).toBe("error");
  });

  it("flags streamFailed=true and preserves partial output when a data frame is malformed before normal EOF", async () => {
    const stream = sseStreamFrom([
      `data: "Hello "\n\n`,
      `data: {oops\n\n`,
      `data: "world"\n\n`,
    ]);
    let content = "";
    const { streamFailed } = await readChatEventStream(stream, (chunk) => {
      content += chunk;
    });
    expect(streamFailed).toBe(true);
    expect(content).toBe("Hello world");
  });

  it("returns streamFailed=false on a clean completed stream", async () => {
    const stream = sseStreamFrom([
      `data: "Hello "\n\n`,
      `data: "world"\n\n`,
    ]);
    let content = "";
    const { streamFailed } = await readChatEventStream(stream, (chunk) => {
      content += chunk;
    });
    expect(streamFailed).toBe(false);
    expect(content).toBe("Hello world");
  });
});
