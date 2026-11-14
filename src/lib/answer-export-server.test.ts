import { describe, expect, it } from "vitest";
import { readFromAnswer, savedAtFrom } from "./answer-export-server";

describe("savedAtFrom", () => {
  const now = new Date(2026, 0, 1, 9);
  it("keeps the device's calendar date", () => {
    const date = savedAtFrom("2026-10-16", now);
    expect([date.getFullYear(), date.getMonth(), date.getDate()]).toEqual([2026, 9, 16]);
  });
  it.each([[undefined], [20261016], ["2026-1-16"], ["2026-02-30"], ["2026-13-01"], ["x2026-10-16"]])("falls back to now for %j", (value) => {
    expect(savedAtFrom(value, now)).toBe(now);
  });
});

describe("readFromAnswer", () => {
  it("accepts a missing message id", () => {
    expect(readFromAnswer({ markdown: "Hi", sessionId: "s1" })).toEqual({ markdown: "Hi", sessionId: "s1", messageId: null, savedOn: undefined });
  });
});
