// 生成原生 Android / iOS 检索折叠的对照用例（说明见 scripts/native-search-fold-cases.ts）。
// 改了 src/lib/search-fold.ts 之后运行：npx tsx scripts/gen-native-search-fold-cases.ts
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { IOS_SEARCH_FOLD_CASES, NATIVE_SEARCH_FOLD_CASES, nativeSearchFoldCases } from "./native-search-fold-cases";

const cases = nativeSearchFoldCases();
for (const file of [NATIVE_SEARCH_FOLD_CASES, IOS_SEARCH_FOLD_CASES]) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, cases);
  console.log(`wrote ${file}`);
}
