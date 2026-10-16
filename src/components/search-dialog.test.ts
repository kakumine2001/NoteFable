import { describe, expect, it } from "vitest";
import { isSearchShortcut, orderProjects, splitHighlight } from "./search-dialog";

describe("splitHighlight", () => {
  it("marks every occurrence of every term, case-insensitively, keeping the original text", () => {
    expect(splitHighlight("Cell division: the cell divides", ["cell", "divid"])).toEqual([
      { text: "Cell", match: true }, { text: " division: the ", match: false }, { text: "cell", match: true }, { text: " ", match: false }, { text: "divid", match: true }, { text: "es", match: false },
    ]);
    expect(splitHighlight("Cell division", ["division"])[0]).toEqual({ text: "Cell ", match: false });
  });

  it("prefers the longer term when terms overlap", () => {
    expect(splitHighlight("mitosis", ["mito", "mitosis"])).toEqual([{ text: "mitosis", match: true }]);
  });

  it("treats regular expression characters as plain text", () => {
    expect(splitHighlight("a+b (c) [d] a.b", ["a+b", "(c)", "[d]", "a.b"]).filter((part) => part.match).map((part) => part.text)).toEqual(["a+b", "(c)", "[d]", "a.b"]);
    expect(splitHighlight("aab", ["a.b"]).some((part) => part.match)).toBe(false);
  });

  it("marks text written in another width, case or kana, keeping the original characters", () => {
    const marked = (text: string, terms: string[]) => splitHighlight(text, terms).filter((part) => part.match).map((part) => part.text);
    expect(marked("ＲＥＳＴ ＡＰＩ の設計と Api", ["api"])).toEqual(["ＡＰＩ", "Api"]);
    expect(marked("でーたべーす入門", ["データ"])).toEqual(["でーた"]);
    expect(marked("ﾃﾞｰﾀﾍﾞｰｽ設計", ["データベース"])).toEqual(["ﾃﾞｰﾀﾍﾞｰｽ"]);
    expect(marked("２０２６年度の履修計画", ["2026年"])).toEqual(["２０２６年"]);
    expect(marked("売上は１２％増", ["12%"])).toEqual(["１２％"]);
    // 戻した部分をつなげると元の文字列に戻る。
    expect(splitHighlight("ＡＰＩ設計", ["api"]).map((part) => part.text).join("")).toBe("ＡＰＩ設計");
    expect(splitHighlight("ＡＰＩ設計", ["api"])).toEqual([{ text: "ＡＰＩ", match: true }, { text: "設計", match: false }]);
  });

  it("marks a 1-2 character ASCII term only at the start of a word", () => {
    const marked = (text: string, terms: string[]) => splitHighlight(text, terms).filter((part) => part.match).map((part) => part.text);
    expect(marked("detail: AI活用 and sustainable ai", ["ai"])).toEqual(["AI", "ai"]);
  });

  it("returns the text unchanged without terms and nothing for empty text", () => {
    expect(splitHighlight("hello", [])).toEqual([{ text: "hello", match: false }]);
    expect(splitHighlight("hello", [""])).toEqual([{ text: "hello", match: false }]);
    expect(splitHighlight("", ["a"])).toEqual([]);
    expect(splitHighlight("hello", ["absent"])).toEqual([{ text: "hello", match: false }]);
  });
});

describe("orderProjects", () => {
  const projects = [{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }, { id: "c", name: "Gamma" }];

  it("puts the current project first and keeps the rest in order", () => {
    expect(orderProjects(projects, "b").map((project) => project.id)).toEqual(["b", "a", "c"]);
    expect(orderProjects(projects, "a").map((project) => project.id)).toEqual(["a", "b", "c"]);
  });

  it("keeps the order when there is no current project or it is unknown", () => {
    expect(orderProjects(projects).map((project) => project.id)).toEqual(["a", "b", "c"]);
    expect(orderProjects(projects, null)).toBe(projects);
    expect(orderProjects(projects, "missing")).toBe(projects);
    expect(orderProjects([], "a")).toEqual([]);
  });
});

describe("isSearchShortcut", () => {
  const press = (overrides = {}) => ({ key: "k", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, repeat: false, defaultPrevented: false, isComposing: false, target: null as EventTarget | null, ...overrides });
  const element = (props: object) => props as unknown as EventTarget;

  it("opens on Ctrl+K and Cmd+K, whatever the case of the key", () => {
    expect(isSearchShortcut(press())).toBe(true);
    expect(isSearchShortcut(press({ ctrlKey: false, metaKey: true }))).toBe(true);
    expect(isSearchShortcut(press({ key: "K" }))).toBe(true);
  });

  it("ignores other keys, extra modifiers, key repeat, composition and handled events", () => {
    expect(isSearchShortcut(press({ key: "j" }))).toBe(false);
    expect(isSearchShortcut(press({ ctrlKey: false }))).toBe(false);
    expect(isSearchShortcut(press({ altKey: true }))).toBe(false);
    expect(isSearchShortcut(press({ shiftKey: true }))).toBe(false);
    expect(isSearchShortcut(press({ repeat: true }))).toBe(false);
    expect(isSearchShortcut(press({ isComposing: true }))).toBe(false);
    expect(isSearchShortcut(press({ defaultPrevented: true }))).toBe(false);
  });

  it("does not open inside a contenteditable or the BlockNote editor, where Ctrl+K inserts a link", () => {
    expect(isSearchShortcut(press({ target: element({ isContentEditable: true }) }))).toBe(false);
    expect(isSearchShortcut(press({ target: element({ isContentEditable: false, closest: (selector: string) => (selector.includes(".bn-editor") ? {} : null) }) }))).toBe(false);
  });

  it("opens from ordinary inputs such as the chat box or the page itself", () => {
    expect(isSearchShortcut(press({ target: element({ isContentEditable: false, closest: () => null }) }))).toBe(true);
    expect(isSearchShortcut(press({ target: element({}) }))).toBe(true);
  });
});
