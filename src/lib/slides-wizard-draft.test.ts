import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DRAFT_MAX_AGE_MS, DRAFTS_PER_SCOPE, newSlidesDraft, readSlidesDraft, removeSlidesDraft, slidesEntryKey, writeSlidesDraft, type SlidesDraft,
} from "./slides-wizard-draft";
import { MAX_TOPIC_CHARS } from "./slides/ai-wizard";

const NOTE = "cnote000000000000000000001";
const OTHER = "cnote000000000000000000002";
const SESSION = "csession00000000000000001";

class MemoryStorage {
  items = new Map<string, string>();
  get length() { return this.items.size; }
  key(index: number) { return [...this.items.keys()][index] ?? null; }
  getItem(key: string) { return this.items.get(key) ?? null; }
  setItem(key: string, value: string) { this.items.set(key, value); }
  removeItem(key: string) { this.items.delete(key); }
}
let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal("localStorage", storage);
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-26T00:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function filled(topic: string): SlidesDraft {
  const draft = newSlidesDraft({ type: "new" });
  return { ...draft, source: { ...draft.source, topic } };
}

describe("slides wizard draft", () => {
  it("keys entries by where the wizard was opened", () => {
    expect(slidesEntryKey({ type: "new" })).toBe("new");
    expect(slidesEntryKey({ type: "new", groupId: "g1" })).toBe("new:g:g1");
    expect(slidesEntryKey({ type: "new", parentId: "p1", groupId: "g1" })).toBe("new:p:p1");
    expect(slidesEntryKey({ type: "note", pageId: NOTE })).toBe(`note:${NOTE}`);
    expect(slidesEntryKey({ type: "chat", sessionId: SESSION })).toBe(`chat:${SESSION}`);
  });

  it("starts with the source the entry points at", () => {
    expect(newSlidesDraft({ type: "new" }).source).toEqual({ type: "topic", topic: "", notes: [] });
    expect(newSlidesDraft({ type: "note", pageId: NOTE, title: "Plan", icon: "📘" }).source).toEqual({ type: "notes", topic: "", notes: [{ id: NOTE, title: "Plan", icon: "📘" }] });
    expect(newSlidesDraft({ type: "chat", sessionId: SESSION, title: "Chat" }).source).toEqual({ type: "chat", topic: "", notes: [], chat: { sessionId: SESSION, title: "Chat" } });
    expect(newSlidesDraft({ type: "new" }).options.theme).not.toBe(newSlidesDraft({ type: "new" }).options.theme);
  });

  it("keeps drafts apart by user and entry, including half-edited outlines", () => {
    const draft: SlidesDraft = {
      ...filled("Vaccines"), step: "outline", partial: true,
      outline: { title: "", slides: [{ title: "", points: ["", "One"] }] },
      request: { stage: "deck", clientRequestId: "request-0001", key: "{}" },
    };
    writeSlidesDraft("user-a", "new", draft);
    expect(readSlidesDraft("user-a", { type: "new" })).toEqual({ ...draft, updatedAt: Date.now() });
    expect(readSlidesDraft("user-b", { type: "new" })).toBeNull();
    expect(readSlidesDraft("user-a", { type: "new", groupId: "g1" })).toBeNull();
    removeSlidesDraft("user-a", "new");
    expect(readSlidesDraft("user-a", { type: "new" })).toBeNull();
  });

  it("keeps the entry's note first and the entry's chat fixed", () => {
    const draft = newSlidesDraft({ type: "note", pageId: NOTE, title: "Plan" });
    writeSlidesDraft("u", `note:${NOTE}`, { ...draft, source: { ...draft.source, type: "topic", notes: [{ id: OTHER, title: "Other", icon: null }] } });
    expect(readSlidesDraft("u", { type: "note", pageId: NOTE })?.source).toEqual({
      type: "notes", topic: "", notes: [{ id: NOTE, title: "", icon: null }, { id: OTHER, title: "Other", icon: null }],
    });
    writeSlidesDraft("u", `chat:${SESSION}`, newSlidesDraft({ type: "chat", sessionId: SESSION, title: "Old name" }));
    expect(readSlidesDraft("u", { type: "chat", sessionId: SESSION })?.source.chat).toEqual({ sessionId: SESSION, title: "Old name" });
  });

  it("drops broken, over-limit and old drafts", () => {
    const key = "notefable:slides-wizard:v1:u:new";
    for (const value of ["not json", JSON.stringify({ v: 2 }), JSON.stringify({ ...filled("x".repeat(MAX_TOPIC_CHARS + 1)) }), JSON.stringify({ ...filled("a"), options: { tone: "loud" } })]) {
      storage.setItem(key, value);
      expect(readSlidesDraft("u", { type: "new" })).toBeNull();
      expect(storage.getItem(key)).toBeNull();
    }
    writeSlidesDraft("u", "new", filled("Old"));
    vi.advanceTimersByTime(DRAFT_MAX_AGE_MS + 1);
    expect(readSlidesDraft("u", { type: "new" })).toBeNull();
    // 大綱が壊れていれば材料の手順に戻す。
    writeSlidesDraft("u", "new", { ...filled("A"), step: "outline", outline: { title: "T", slides: [] } });
    expect(readSlidesDraft("u", { type: "new" })).toMatchObject({ step: "source", outline: null });
  });

  it("keeps only the newest drafts of a user", () => {
    writeSlidesDraft("other", "new", filled("Other user"));
    for (let index = 0; index < DRAFTS_PER_SCOPE + 3; index++) {
      vi.advanceTimersByTime(1000);
      writeSlidesDraft("u", `new:g:g${index}`, filled(`Draft ${index}`));
    }
    const mine = [...storage.items.keys()].filter((key) => key.startsWith("notefable:slides-wizard:v1:u:"));
    expect(mine).toHaveLength(DRAFTS_PER_SCOPE);
    expect(readSlidesDraft("u", { type: "new", groupId: "g0" })).toBeNull();
    expect(readSlidesDraft("u", { type: "new", groupId: `g${DRAFTS_PER_SCOPE + 2}` })?.source.topic).toBe(`Draft ${DRAFTS_PER_SCOPE + 2}`);
    expect(readSlidesDraft("other", { type: "new" })).not.toBeNull();
  });

  it("works without storage", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); },
    });
    expect(() => writeSlidesDraft("u", "new", filled("a"))).not.toThrow();
    expect(() => removeSlidesDraft("u", "new")).not.toThrow();
    expect(readSlidesDraft("u", { type: "new" })).toBeNull();
  });
});
