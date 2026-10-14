import { describe, expect, it } from "vitest";
import { parseChatStreamLine } from "./chat-stream";

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
