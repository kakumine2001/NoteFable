// 生成原生 Android 检索折叠的对照用例（说明见 scripts/native-search-fold-cases.ts）。
// 改了 src/lib/search-fold.ts 之后运行：npx tsx scripts/gen-native-search-fold-cases.ts
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { NATIVE_SEARCH_FOLD_CASES, nativeSearchFoldCases } from "./native-search-fold-cases";

mkdirSync(path.dirname(NATIVE_SEARCH_FOLD_CASES), { recursive: true });
writeFileSync(NATIVE_SEARCH_FOLD_CASES, nativeSearchFoldCases());
console.log(`wrote ${NATIVE_SEARCH_FOLD_CASES}`);
