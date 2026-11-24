import { describe, expect, it } from "vitest";
import { isSavedMessageId, reconcileFetchedMessages } from "@/lib/chat-message-sync";
import type { Message } from "@/types/chat";

function msg(
  id: string,
  role: "USER" | "ASSISTANT",
  content = "hi",
  extra?: Partial<Message>,
): Message {
  return { id, role, content, ...extra };
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
  it("transfers explicit handoff optimistic IDs to renderKey when a turn is persisted", () => {
    const previous = [
      msg("uuid-user-1", "USER", "Hello"),
      msg("uuid-asst-1", "ASSISTANT", "Hi there"),
    ];
    const fetched = [
      msg(CUID_1, "USER", "Hello"),
      msg(CUID_2, "ASSISTANT", "Hi there"),
    ];

    const result = reconcileFetchedMessages(previous, fetched, ["uuid-user-1", "uuid-asst-1"]);
    expect(result.map((m) => [m.id, m.renderKey])).toEqual([
      [CUID_1, "uuid-user-1"],
      [CUID_2, "uuid-asst-1"],
    ]);
  });

  it("preserves prior renderKeys across subsequent turns", () => {
    const previous = [
      msg(CUID_1, "USER", "First", { renderKey: "uuid-user-1" }),
      msg(CUID_2, "ASSISTANT", "Reply 1", { renderKey: "uuid-asst-1" }),
      msg("uuid-user-2", "USER", "Second"),
      msg("uuid-asst-2", "ASSISTANT", "Reply 2"),
    ];
    const fetched = [
      msg(CUID_1, "USER", "First"),
      msg(CUID_2, "ASSISTANT", "Reply 1"),
      msg(CUID_3, "USER", "Second"),
      msg(CUID_4, "ASSISTANT", "Reply 2"),
    ];

    const result = reconcileFetchedMessages(previous, fetched, ["uuid-user-2", "uuid-asst-2"]);
    expect(result.map((m) => [m.id, m.renderKey])).toEqual([
      [CUID_1, "uuid-user-1"],
      [CUID_2, "uuid-asst-1"],
      [CUID_3, "uuid-user-2"],
      [CUID_4, "uuid-asst-2"],
    ]);
  });

  it("transfers renderKey for regenerate (single optimistic assistant)", () => {
    const previous = [
      msg(CUID_1, "USER", "Prompt", { renderKey: "uuid-user-1" }),
      msg("uuid-regen", "ASSISTANT", "New reply"),
    ];
    const fetched = [
      msg(CUID_1, "USER", "Prompt"),
      msg(CUID_ALT, "ASSISTANT", "New reply"),
    ];

    const result = reconcileFetchedMessages(previous, fetched, ["uuid-regen"]);
    expect(result.map((m) => [m.id, m.renderKey])).toEqual([
      [CUID_1, "uuid-user-1"],
      [CUID_ALT, "uuid-regen"],
    ]);
  });

  it("does not transfer optimistic keys on rollback (e.g. rejected edit) when handoffIds is omitted", () => {
    const previous = [
      msg("uuid-edited-user", "USER", "Edited draft"),
      msg("uuid-empty-asst", "ASSISTANT", ""),
    ];
    const fetched = [
      msg(CUID_1, "USER", "Original prompt"),
      msg(CUID_2, "ASSISTANT", "Original reply"),
    ];

    const result = reconcileFetchedMessages(previous, fetched);
    expect(result.map((m) => [m.id, m.renderKey])).toEqual([
      [CUID_1, undefined],
      [CUID_2, undefined],
    ]);
  });

  it("hands off the newly succeeded turn's keys even when an earlier failed local turn is still visible", () => {
    const previous = [
      msg(CUID_1, "USER", "Earlier", { renderKey: "uuid-u0" }),
      msg(CUID_2, "ASSISTANT", "Earlier reply", { renderKey: "uuid-a0" }),
      msg("uuid-failed-u", "USER", "Failed prompt"),
      msg("uuid-failed-a", "ASSISTANT", "Request failed", { failed: true }),
      msg("uuid-retry-u", "USER", "Retry prompt"),
      msg("uuid-retry-a", "ASSISTANT", "Retry reply"),
    ];
    const fetched = [
      msg(CUID_1, "USER", "Earlier"),
      msg(CUID_2, "ASSISTANT", "Earlier reply"),
      msg(CUID_3, "USER", "Retry prompt"),
      msg(CUID_4, "ASSISTANT", "Retry reply"),
    ];

    const result = reconcileFetchedMessages(previous, fetched, ["uuid-retry-u", "uuid-retry-a"]);
    expect(result.map((m) => [m.id, m.renderKey])).toEqual([
      [CUID_1, "uuid-u0"],
      [CUID_2, "uuid-a0"],
      [CUID_3, "uuid-retry-u"],
      [CUID_4, "uuid-retry-a"],
    ]);
  });

  it("does not inherit renderKey when switching between already-saved versions", () => {
    const previous = [
      msg(CUID_1, "USER", "Prompt", { renderKey: "uuid-user-1" }),
      msg(CUID_2, "ASSISTANT", "Version 1", { renderKey: "uuid-asst-1" }),
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

    const result = reconcileFetchedMessages(previous, fetched, ["uuid-user-1"]);
    expect(result[0]?.renderKey).toBeUndefined();
  });

  it("returns fetched directly when previous or fetched is empty", () => {
    const fetched = [msg(CUID_1, "USER", "Hello")];
    expect(reconcileFetchedMessages([], fetched, ["uuid-1"])).toBe(fetched);
    expect(reconcileFetchedMessages(fetched, [], ["uuid-1"])).toEqual([]);
  });
});
