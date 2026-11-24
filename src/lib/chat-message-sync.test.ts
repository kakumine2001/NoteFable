import { describe, expect, it } from "vitest";
import { isSavedMessageId, reconcileFetchedMessages } from "@/lib/chat-message-sync";
import type { Message } from "@/types/chat";

function msg(id: string, role: "USER" | "ASSISTANT", content = "hi", renderKey?: string): Message {
  return renderKey ? { id, role, content, renderKey } : { id, role, content };
}

const CUID_1 = "cm1aaaaaaaaaaaaaaaaaaaaaa";
const CUID_2 = "cm2bbbbbbbbbbbbbbbbbbbbbb";
const CUID_3 = "cm3cccccccccccccccccccccc";
const CUID_4 = "cm4dddddddddddddddddddddd";
const CUID_ALT = "cm5eeeeeeeeeeeeeeeeeeeeee";

describe("isSavedMessageId", () => {
  it("recognizes cuid IDs and rejects client UUIDs", () => {
    expect(isSavedMessageId(CUID_1)).toBe(true);
    expect(isSavedMessageId("550e8400-e29b-41d4-a716-446655440000")).toBe(false);
    expect(isSavedMessageId("local-1")).toBe(false);
  });
});

describe("reconcileFetchedMessages", () => {
  it("transfers optimistic local IDs to renderKey when a turn is persisted", () => {
    const previous = [
      msg("uuid-user-1", "USER", "Hello"),
      msg("uuid-asst-1", "ASSISTANT", "Hi there"),
    ];
    const fetched = [
      msg(CUID_1, "USER", "Hello"),
      msg(CUID_2, "ASSISTANT", "Hi there"),
    ];

    const result = reconcileFetchedMessages(previous, fetched);
    expect(result.map((m) => [m.id, m.renderKey])).toEqual([
      [CUID_1, "uuid-user-1"],
      [CUID_2, "uuid-asst-1"],
    ]);
  });

  it("preserves prior renderKeys across subsequent turns", () => {
    const previous = [
      msg(CUID_1, "USER", "First", "uuid-user-1"),
      msg(CUID_2, "ASSISTANT", "Reply 1", "uuid-asst-1"),
      msg("uuid-user-2", "USER", "Second"),
      msg("uuid-asst-2", "ASSISTANT", "Reply 2"),
    ];
    const fetched = [
      msg(CUID_1, "USER", "First"),
      msg(CUID_2, "ASSISTANT", "Reply 1"),
      msg(CUID_3, "USER", "Second"),
      msg(CUID_4, "ASSISTANT", "Reply 2"),
    ];

    const result = reconcileFetchedMessages(previous, fetched);
    expect(result.map((m) => [m.id, m.renderKey])).toEqual([
      [CUID_1, "uuid-user-1"],
      [CUID_2, "uuid-asst-1"],
      [CUID_3, "uuid-user-2"],
      [CUID_4, "uuid-asst-2"],
    ]);
  });

  it("transfers renderKey for regenerate (single optimistic assistant)", () => {
    const previous = [
      msg(CUID_1, "USER", "Prompt", "uuid-user-1"),
      msg("uuid-regen", "ASSISTANT", "New reply"),
    ];
    const fetched = [
      msg(CUID_1, "USER", "Prompt"),
      msg(CUID_ALT, "ASSISTANT", "New reply"),
    ];

    const result = reconcileFetchedMessages(previous, fetched);
    expect(result.map((m) => [m.id, m.renderKey])).toEqual([
      [CUID_1, "uuid-user-1"],
      [CUID_ALT, "uuid-regen"],
    ]);
  });

  it("does not inherit renderKey when switching between already-saved versions", () => {
    const previous = [
      msg(CUID_1, "USER", "Prompt", "uuid-user-1"),
      msg(CUID_2, "ASSISTANT", "Version 1", "uuid-asst-1"),
    ];
    const fetched = [
      msg(CUID_1, "USER", "Prompt"),
      msg(CUID_ALT, "ASSISTANT", "Version 2"),
    ];

    const result = reconcileFetchedMessages(previous, fetched);
    expect(result.map((m) => [m.id, m.renderKey])).toEqual([
      [CUID_1, "uuid-user-1"],
      [CUID_ALT, undefined],
    ]);
  });

  it("does not inherit renderKey when roles do not match", () => {
    const previous = [
      msg("uuid-user-1", "USER", "Hello"),
    ];
    const fetched = [
      msg(CUID_2, "ASSISTANT", "Unexpected"),
    ];

    const result = reconcileFetchedMessages(previous, fetched);
    expect(result[0]?.renderKey).toBeUndefined();
  });

  it("returns fetched directly when previous or fetched is empty", () => {
    const fetched = [msg(CUID_1, "USER", "Hello")];
    expect(reconcileFetchedMessages([], fetched)).toBe(fetched);
    expect(reconcileFetchedMessages(fetched, [])).toEqual([]);
  });
});
