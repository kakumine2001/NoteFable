import { describe, expect, it } from "vitest";
import { failureText, localizeFailureText } from "@/lib/failure-text";
import { createTranslator } from "@/lib/i18n/translate";
import { applyActivityEvent, parseStoredActivity, serializeActivity } from "@/lib/chat-activity";
import { parseChatStreamLine } from "@/lib/chat-stream";

const t = createTranslator({ "Request failed: {detail}": "请求失败：{detail}", "Note not found.": "找不到笔记。" });

describe("answer failure text", () => {
  it("translates only explicitly marked system failures through the SSE and storage round trip", () => {
    const content = `Partial answer\n\n${failureText("Note not found.")}`;
    const event = parseChatStreamLine(`data: ${JSON.stringify({ activity: { type: "failure", id: "request-failure", offset: 16, detail: "Note not found." } })}`);
    if (!event || typeof event === "string") throw new Error("expected failure event");
    const restored = parseStoredActivity(serializeActivity(applyActivityEvent([], event)));
    const failure = restored?.find((step) => step.kind === "failure");
    expect(failure).toMatchObject({ kind: "failure", offset: 16, detail: "Note not found." });
    expect(localizeFailureText(content, t, failure)).toBe("Partial answer\n\n请求失败：找不到笔记。");
    expect(content).toBe("Partial answer\n\nRequest failed: Note not found.");
    expect(localizeFailureText(failureText("Upstream said no"), t, { offset: 0, detail: "Upstream said no" })).toBe("请求失败：Upstream said no");
  });

  it("leaves ordinary answers and old records without metadata untouched", () => {
    const quotedError = "The server returned this error:\n\nRequest failed: Note not found.";
    expect(localizeFailureText(quotedError, t)).toBe(quotedError);
    expect(localizeFailureText(failureText("Note not found."), t)).toBe("Request failed: Note not found.");
    expect(localizeFailureText("He wrote: Request failed: maybe", t)).toBe("He wrote: Request failed: maybe");
    expect(localizeFailureText("Request failed: one\n\nmore text", t)).toBe("Request failed: one\n\nmore text");
  });

  it("does not rewrite text when metadata no longer matches its exact suffix", () => {
    const content = failureText("Note not found.");
    expect(localizeFailureText(content, t, { offset: 1, detail: "Note not found." })).toBe(content);
    expect(localizeFailureText(content, t, { offset: 0, detail: "Unknown error." })).toBe(content);
    expect(parseStoredActivity(JSON.stringify([{ id: "x", kind: "failure", offset: -1, detail: "Note not found." }]))).toBeUndefined();
  });
});
