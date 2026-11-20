// 原生端的检索折叠（mobile/android/.../data/SearchFold.kt、mobile/ios/NoteFable/Core/Text/SearchFold.swift）
// 和网页 src/lib/search-fold.ts 的对照用例。
// 输入取自 src/lib/search-fold.test.ts（再加几条），期望值由网页的实现算出，写进 Android 单元测试的资源，
// SearchFoldParityTest 用它核对 Kotlin 版；iOS 的单元测试（SearchFoldParityTests）用内容相同的一份。
// 生成：npx tsx scripts/gen-native-search-fold-cases.ts
// src/lib/native-search-fold-cases.test.ts 会在用例过期（改了 search-fold.ts 没重新生成）时让测试失败。
import path from "node:path";
import { buildSearchSnippet, countMatchedTerms, findTermRanges, foldSearchText, foldWithMap } from "../src/lib/search-fold";
import { parseSearchTerms } from "../src/types/search";

export const NATIVE_SEARCH_FOLD_CASES = path.join(process.cwd(), "mobile/android/app/src/test/resources/search-fold-cases.json");
// iOS 的测试包只带 Tests/NoteFableCoreTests/Fixtures 下的文件，所以放一份同样的。
export const IOS_SEARCH_FOLD_CASES = path.join(process.cwd(), "mobile/ios/Tests/NoteFableCoreTests/Fixtures/search-fold-cases.json");

const VOICED = String.fromCharCode(0x3099);
const ACUTE = String.fromCharCode(0x0301);
const NUL = String.fromCharCode(0);
const HALF_VOICED = String.fromCharCode(0xff9e);

const FOLD_INPUTS = [
  "ＡＰＩ２０２６年", "Hello WORLD", "１２％", "（ａ＿ｂ）！", "ﾃﾞｰﾀﾍﾞｰｽ", "ﾊﾟｿｺﾝ", "ｱｲｳ", "でーた", "あるごりずむ", "ぁゔゝゞ", "ひらがなカタカナ",
  "Don’t ‘quote’ “this” — 2024–2025 ‐ ‑ −", "multi‐head", `か${VOICED}`, `e${ACUTE}`, "会議　資料", `a${NUL}B`, NUL, "复习提纲", "😀𠮷", "",
  "Ünï", "㌔㈱", "x", "a㌔b", "a𠮷B", "ＵＮＩＣＯＤＥ", "ｶﾞｷﾞ", `ﾃ${HALF_VOICED}ｰﾀ`, "한국어 가", "İstanbul ǅ ß",
];

const RANGE_CASES: [string, string[]][] = [
  ["ＡＰＩ設計と Api", ["api"]], ["でーたべーすとデータ", ["データ"]], ["ﾃﾞｰﾀﾍﾞｰｽ設計", ["データベース"]], ["２０２６年度", ["2026年"]],
  ["売上は12％増", ["12%"]], ["ﾃﾞｰﾀ と データ", ["データ"]], ["mitosis", ["mito", "mitosis"]], ["abcd", ["bc", "ab"]], ["aaaaaa", ["aaa"]],
  ["a+b (c) [d] a.b aab", ["a+b", "(c)", "[d]", "a.b"]], ["単位は㌔です", ["キロ"]], ["Don’t worry (2024–2025)", ["don't", "2024-2025"]],
  ["detail sustainable AI活用 ai、AIs Ａｉ", ["ai"]], ["cell 2024 12", ["2"]], ["", ["a"]], ["abc", []], ["abc", [""]], ["abc", ["zzz"]],
  ["ｶﾞｷﾞ", ["ガキ"]], ["ｶﾞｷ", ["ガキ"]], ["😀 api 😀", ["api"]], ["x(y) ー ｰ", ["(y)", "ー"]],
];

const SNIPPET_CASES: [string | null, string[]][] = [
  ["  one\n\n two\tthree ", ["zzz"]], [null, ["a"]], ["hello", []], [`${"x".repeat(200)} ＡＰＩ ${"y".repeat(200)}`, ["api"]],
  ["でーたの話", ["データ"]], [`${"😀".repeat(100)} api ${"😀".repeat(100)}`, ["api"]], [`${"a".repeat(30)}　データ end`, ["データ"]],
];

const QUERIES = ["ＡＰＩ　でーた api", "  a b a c d e f g h i j ", "", "Don’t ﾃﾞｰﾀ"];

export function nativeSearchFoldCases(): string {
  const cases = {
    fold: FOLD_INPUTS.map((input) => {
      const map = foldWithMap(input);
      return { input, folded: foldSearchText(input), mapped: map.folded, starts: [...map.starts], ends: [...map.ends] };
    }),
    ranges: RANGE_CASES.map(([text, terms]) => ({ text, terms, ranges: findTermRanges(text, terms) })),
    counts: RANGE_CASES.map(([text, terms]) => ({ text, terms, count: countMatchedTerms(text, terms) })),
    snippets: SNIPPET_CASES.map(([body, terms]) => ({ body, terms, snippet: buildSearchSnippet(body, terms) })),
    terms: QUERIES.map((query) => ({ query, terms: parseSearchTerms(query) })),
  };
  return JSON.stringify(cases, null, 1) + "\n";
}
