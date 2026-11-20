import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { IOS_SEARCH_FOLD_CASES, NATIVE_SEARCH_FOLD_CASES, nativeSearchFoldCases } from "../../scripts/native-search-fold-cases";

describe("native search folding parity cases", () => {
  it("are up to date (regenerate with npx tsx scripts/gen-native-search-fold-cases.ts)", () => {
    expect(readFileSync(NATIVE_SEARCH_FOLD_CASES, "utf8").replace(/\r\n/g, "\n")).toBe(nativeSearchFoldCases());
  });

  it("the iOS copy is up to date (regenerate with npx tsx scripts/gen-native-search-fold-cases.ts)", () => {
    expect(readFileSync(IOS_SEARCH_FOLD_CASES, "utf8").replace(/\r\n/g, "\n")).toBe(nativeSearchFoldCases());
  });
});
