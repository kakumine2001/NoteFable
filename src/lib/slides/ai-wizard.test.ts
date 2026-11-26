import { describe, expect, it } from "vitest";
import { DEFAULT_SLIDES_OPTIONS, parseOptions, parseOutline, parseSource } from "./ai-wizard";

const id = (index: number) => `cnote${index}`;

describe("parseSource", () => {
  it("accepts a one-line topic, up to five own note ids, or a chat", () => {
    expect(parseSource({ type: "topic", topic: "  光合作用\n 入门 " })).toEqual({ type: "topic", topic: "光合作用 入门" });
    expect(parseSource({ type: "notes", pageIds: [id(1), id(2)] })).toEqual({ type: "notes", pageIds: [id(1), id(2)] });
    expect(parseSource({ type: "chat", sessionId: "cs1", extra: true })).toEqual({ type: "chat", sessionId: "cs1" });
    expect(parseSource({ type: "topic", topic: "x".repeat(300) })).not.toBeNull();
  });

  it("rejects missing, oversized and duplicate values", () => {
    for (const value of [
      null, "topic", {}, { type: "answer" }, { type: "topic", topic: "  " }, { type: "topic", topic: "x".repeat(301) },
      { type: "notes", pageIds: [] }, { type: "notes", pageIds: [1] }, { type: "notes", pageIds: [id(1), id(1)] },
      { type: "notes", pageIds: Array.from({ length: 6 }, (_, index) => id(index)) }, { type: "notes", pageIds: ["../x"] },
      { type: "chat", sessionId: "" },
    ]) expect(parseSource(value), JSON.stringify(value)).toBeNull();
  });
});

describe("parseOptions", () => {
  it("fills in the defaults for missing fields", () => {
    expect(parseOptions(undefined)).toEqual(DEFAULT_SLIDES_OPTIONS);
    expect(parseOptions({})).toEqual(DEFAULT_SLIDES_OPTIONS);
    expect(parseOptions({ pageCount: 30, tone: "academic", audience: " first-year\nstudents ", language: "zh-Hant", wording: "keep", theme: { mode: "dark" } }))
      .toEqual({ pageCount: 30, tone: "academic", audience: "first-year students", language: "zh-Hant", wording: "keep", theme: { id: "simple", mode: "dark" } });
  });

  it("rejects wrong values", () => {
    for (const value of [
      null, [], { pageCount: 2 }, { pageCount: 31 }, { pageCount: 4.5 }, { pageCount: "10" }, { tone: "funny" }, { audience: 3 },
      { audience: "x".repeat(201) }, { language: "pt" }, { wording: "long" }, { theme: "tech" }, { theme: { id: "neon" } }, { theme: { mode: "auto" } },
    ]) expect(parseOptions(value), JSON.stringify(value)).toBeNull();
  });
});

describe("parseOutline", () => {
  it("keeps the edited titles and points and drops empty points", () => {
    expect(parseOutline({ title: " Deck ", slides: [{ title: "A\nB", points: ["one", "  ", "two"] }, { title: "C" }] }))
      .toEqual({ title: "Deck", slides: [{ title: "A B", points: ["one", "two"] }, { title: "C", points: [] }] });
    // 空の要点を除いてから数える。
    expect(parseOutline({ title: "t", slides: [{ title: "s", points: [...Array(12).fill("p"), ""] }] })?.slides[0].points).toHaveLength(12);
  });

  it("rejects outlines beyond the limits", () => {
    const slide = { title: "s", points: [] };
    expect(parseOutline({ title: "t", slides: Array(29).fill(slide) })).not.toBeNull();
    for (const value of [
      null, { title: "", slides: [slide] }, { title: "x".repeat(201), slides: [slide] }, { title: "t", slides: [] },
      { title: "t", slides: Array(30).fill(slide) }, { title: "t", slides: [{ title: " ", points: [] }] },
      { title: "t", slides: [{ title: "s", points: "p" }] }, { title: "t", slides: [{ title: "s", points: [1] }] },
      { title: "t", slides: [{ title: "s", points: Array(13).fill("p") }] }, { title: "t", slides: [{ title: "s", points: ["x".repeat(501)] }] },
    ]) expect(parseOutline(value), JSON.stringify(value).slice(0, 80)).toBeNull();
  });

  it("removes characters that cannot be stored", () => {
    expect(parseOutline({ title: "a\u0000b\uD800", slides: [{ title: "s", points: [] }] })?.title).toBe("ab�");
  });
});
