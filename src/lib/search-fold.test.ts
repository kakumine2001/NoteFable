import { describe, expect, it } from "vitest";
import { buildSearchSnippet, countMatchedTerms, findTermRanges, foldSearchText, foldWithMap, isShortAsciiTerm, termMatcher } from "./search-fold";

// テストの入力に結合文字などを直接書くと読めないので、コードから作る。
const VOICED = String.fromCharCode(0x3099);
const ACUTE = String.fromCharCode(0x0301);
const regexOf = (term: string) => new RegExp(termMatcher(term).regex, "u");

describe("foldSearchText", () => {
  it("folds full-width Latin letters, digits and symbols to ASCII, and lowercases", () => {
    expect(foldSearchText("ＡＰＩ２０２６年")).toBe("api2026年");
    expect(foldSearchText("Hello WORLD")).toBe("hello world");
    expect(foldSearchText("１２％")).toBe("12%");
    expect(foldSearchText("（ａ＿ｂ）！")).toBe("(a_b)!");
  });

  it("turns half-width katakana into full-width, composing the voiced marks", () => {
    expect(foldSearchText("ﾃﾞｰﾀﾍﾞｰｽ")).toBe("データベース");
    expect(foldSearchText("ﾊﾟｿｺﾝ")).toBe("パソコン");
    expect(foldSearchText("ｱｲｳ")).toBe("アイウ");
  });

  it("folds hiragana to katakana, including the iteration marks", () => {
    expect(foldSearchText("でーた")).toBe("データ");
    expect(foldSearchText("あるごりずむ")).toBe("アルゴリズム");
    expect(foldSearchText("ぁゔゝゞ")).toBe("ァヴヽヾ");
    expect(foldSearchText("ひらがなカタカナ")).toBe("ヒラガナカタカナ");
  });

  it("turns typographic quotes and dashes into the ASCII ones that people type", () => {
    expect(foldSearchText("Don’t ‘quote’ “this” — 2024–2025 ‐ ‑ −")).toBe("don't 'quote' \"this\" - 2024-2025 - - -");
    expect(foldSearchText("multi‐head")).toBe("multi-head");
  });

  it("composes a base letter and a combining mark, and maps ideographic space to a space", () => {
    expect(foldSearchText(`か${VOICED}`)).toBe("ガ");
    expect(foldSearchText(`e${ACUTE}`)).toBe("é");
    expect(foldSearchText("会議　資料")).toBe("会議 資料");
  });

  it("drops NUL, which PostgreSQL text cannot hold", () => {
    expect(foldSearchText("a" + String.fromCharCode(0) + "B")).toBe("ab");
    expect(foldSearchText(String.fromCharCode(0))).toBe("");
  });

  it("leaves other scripts, astral characters and empty text alone, and is idempotent", () => {
    expect(foldSearchText("复习提纲")).toBe("复习提纲");
    expect(foldSearchText("😀𠮷")).toBe("😀𠮷");
    expect(foldSearchText("")).toBe("");
    for (const text of ["ＡＰＩ", "ﾃﾞｰﾀ", "でーた", "Ünï", "㌔㈱", "x"]) expect(foldSearchText(foldSearchText(text))).toBe(foldSearchText(text));
  });
});

describe("foldWithMap", () => {
  it("maps every folded unit back to the original characters it came from", () => {
    const composed = foldWithMap("ﾃﾞｰﾀ");
    expect(composed.folded).toBe("データ");
    // ﾃ+ﾞ は 1 文字のデになる。
    expect([...composed.starts]).toEqual([0, 2, 3]);
    expect([...composed.ends]).toEqual([2, 3, 4]);

    const expanded = foldWithMap("a㌔b");
    expect(expanded.folded).toBe("aキロb");
    // ㌔ から生まれた 2 文字は、どちらも元の 1 文字を指す。
    expect([...expanded.starts]).toEqual([0, 1, 1, 2]);
    expect([...expanded.ends]).toEqual([1, 2, 2, 3]);
  });

  it("keeps surrogate pairs together", () => {
    const { folded, starts, ends } = foldWithMap("a𠮷B");
    expect(folded).toBe("a𠮷b");
    expect([...starts]).toEqual([0, 1, 1, 3]);
    expect([...ends]).toEqual([1, 3, 3, 4]);
  });
});

describe("findTermRanges", () => {
  const marked = (text: string, terms: string[]) => findTermRanges(text, terms).map(({ start, end }) => text.slice(start, end));

  it("finds terms through case, width and kana differences and returns the original characters", () => {
    expect(marked("ＡＰＩ設計と Api", ["api"])).toEqual(["ＡＰＩ", "Api"]);
    expect(marked("でーたべーすとデータ", ["データ"])).toEqual(["でーた", "データ"]);
    expect(marked("ﾃﾞｰﾀﾍﾞｰｽ設計", ["データベース"])).toEqual(["ﾃﾞｰﾀﾍﾞｰｽ"]);
    expect(marked("２０２６年度", ["2026年"])).toEqual(["２０２６年"]);
    expect(marked("売上は12％増", ["12%"])).toEqual(["12％"]);
  });

  it("returns ranges in the original text, left to right", () => {
    expect(findTermRanges("ﾃﾞｰﾀ と データ", ["データ"])).toEqual([{ start: 0, end: 4 }, { start: 7, end: 10 }]);
  });

  it("prefers the leftmost match, and the longer term at the same position", () => {
    expect(marked("mitosis", ["mito", "mitosis"])).toEqual(["mitosis"]);
    expect(marked("abcd", ["bc", "ab"])).toEqual(["ab"]);
    expect(marked("aaaaaa", ["aaa"])).toEqual(["aaa", "aaa"]);
  });

  it("treats characters that look like patterns as plain text", () => {
    expect(marked("a+b (c) [d] a.b aab", ["a+b", "(c)", "[d]", "a.b"])).toEqual(["a+b", "(c)", "[d]", "a.b"]);
  });

  it("matches a character that expands under NFKC as one range", () => {
    expect(marked("単位は㌔です", ["キロ"])).toEqual(["㌔"]);
  });

  it("finds a term through typographic quotes and dashes", () => {
    expect(marked("Don’t worry (2024–2025)", ["don't", "2024-2025"])).toEqual(["Don’t", "2024–2025"]);
  });

  it("matches 1-2 character ASCII terms only at the start of a word", () => {
    expect(isShortAsciiTerm("ai")).toBe(true);
    expect(isShortAsciiTerm("a")).toBe(true);
    expect(isShortAsciiTerm("api")).toBe(false);
    expect(isShortAsciiTerm("あ")).toBe(false);
    expect(marked("detail sustainable AI活用 ai、AIs Ａｉ", ["ai"])).toEqual(["AI", "ai", "AI", "Ａｉ"]);
    expect(marked("cell 2024 12", ["2"])).toEqual(["2"]);
  });

  it("returns nothing for empty input", () => {
    expect(findTermRanges("", ["a"])).toEqual([]);
    expect(findTermRanges("abc", [])).toEqual([]);
    expect(findTermRanges("abc", [""])).toEqual([]);
    expect(findTermRanges("abc", ["zzz"])).toEqual([]);
  });
});

describe("countMatchedTerms", () => {
  it("counts the distinct terms present, whatever their notation", () => {
    expect(countMatchedTerms("ＡＰＩ の でーた", ["api", "データ", "missing"])).toBe(2);
    expect(countMatchedTerms("api api api", ["api"])).toBe(1);
    expect(countMatchedTerms("", ["api"])).toBe(0);
    expect(countMatchedTerms("sustainable", ["ai"])).toBe(0);
  });
});

describe("buildSearchSnippet", () => {
  it("collapses whitespace and returns the start when no term is found", () => {
    expect(buildSearchSnippet("  one\n\n two\tthree ", ["zzz"])).toBe("one two three");
    expect(buildSearchSnippet(null, ["a"])).toBe("");
    expect(buildSearchSnippet("hello", [])).toBe("hello");
  });

  it("cuts around a match with ellipses, in the original characters", () => {
    const text = `${"x".repeat(200)} ＡＰＩ ${"y".repeat(200)}`;
    const snippet = buildSearchSnippet(text, ["api"]);
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
    expect(snippet).toContain("ＡＰＩ");
    expect(snippet.length).toBeLessThan(170);
    expect(buildSearchSnippet("でーたの話", ["データ"])).toBe("でーたの話");
  });

  it("does not split a surrogate pair at either end", () => {
    const text = `${"😀".repeat(100)} api ${"😀".repeat(100)}`;
    const snippet = buildSearchSnippet(text, ["api"]);
    expect(snippet).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/);
  });
});

describe("termMatcher", () => {
  it("uses LIKE for terms with no other spelling, such as kanji", () => {
    expect(termMatcher("复习提纲").literal).toBe(true);
    expect(termMatcher("期待値").literal).toBe(true);
    expect(termMatcher("会议").literal).toBe(true);
    expect(termMatcher("api").literal).toBe(false);
    expect(termMatcher("データ").literal).toBe(false);
    expect(termMatcher("100%").literal).toBe(false);
  });

  it("builds a pattern that matches every spelling that folds to the term", () => {
    const api = regexOf("api");
    for (const text of ["api", "API", "Api", "ＡＰＩ", "ａｐｉ", "x api y"]) expect(api.test(text)).toBe(true);
    for (const text of ["ap", "a p i", "aqi"]) expect(api.test(text)).toBe(false);

    const data = regexOf("データ");
    // 「デ」は、デ・で・ﾃﾞ・テ+゛・て+゛・ﾃ+ﾞ のどれで書かれていても当たる。
    for (const text of ["データ", "でーた", "ﾃﾞｰﾀ", `て${VOICED}ーた`, `テ${VOICED}ータ`, "ﾃ" + String.fromCharCode(0xff9e) + "ｰﾀ"]) expect(data.test(text)).toBe(true);
    expect(data.test("テータ")).toBe(false);
    // 濁点が付く字の手前までを語の最後の字に当てない（ｶﾞｷﾞ は ガギ であって ガキ ではない）。
    expect(regexOf("ガキ").test("ｶﾞｷﾞ")).toBe(false);
    expect(regexOf("ガキ").test("ｶﾞｷ")).toBe(true);
    expect(regexOf("カ").test("ｶﾞ")).toBe(false);

    expect(regexOf("2026年").test("２０２６年")).toBe(true);
    expect(regexOf("12%").test("売上は１２％増")).toBe(true);
    expect(regexOf("é").test(`e${ACUTE}`)).toBe(true);

    expect(regexOf("don't").test("Don’t worry")).toBe(true);
    expect(regexOf("2024-2025").test("(2024–2025)")).toBe(true);
    expect(regexOf("multi-head").test("Multi‐head attention")).toBe(true);
    expect(regexOf("multi-head").test("multi head")).toBe(false);
  });

  it("escapes characters that mean something in a regular expression", () => {
    expect(regexOf("a.b").test("axb")).toBe(false);
    expect(regexOf("a.b").test("a.b")).toBe(true);
    expect(regexOf("(x)").test("(x)")).toBe(true);
    expect(regexOf("[d]").test("[d]")).toBe(true);
    expect(regexOf("a|b").test("a")).toBe(false);
    expect(regexOf("c++").test("c++")).toBe(true);
    expect(regexOf("a\\b").test("a\\b")).toBe(true);
    expect(regexOf("^$").test("^$")).toBe(true);
    expect(regexOf("a-b").test("a-b")).toBe(true);
  });

  it("matches a 1-2 character ASCII term only at the start of a word", () => {
    const ai = regexOf("ai");
    for (const text of ["ai", "AI活用", "the AI era", "ＡＩ", "(ai)"]) expect(ai.test(text)).toBe(true);
    for (const text of ["detail", "sustainable", "ＳＡＩ", "x2ai"]) expect(ai.test(text)).toBe(false);
  });

  it("agrees with the JavaScript folding for a set of mixed spellings", () => {
    const samples = ["ＡＰＩ設計", "でーたべーす", "ﾃﾞｰﾀﾍﾞｰｽ", "２０２６年度", "Hello World", "カ" + VOICED + "キ", "ｶﾞｷﾞ", "ＵＮＩＣＯＤＥ", "１２％", "x(y)", "ー", "ｰ"];
    const terms = ["api", "データ", "データベース", "2026", "hello", "ガ", "ガキ", "unicode", "12%", "(y)", "ー", "ベ"];
    for (const text of samples) {
      for (const term of terms) {
        expect(regexOf(term).test(text), `${term} in ${text}`).toBe(findTermRanges(text, [term]).length > 0);
      }
    }
  });
});
