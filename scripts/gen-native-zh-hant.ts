// 生成原生 Android 的繁体中文文案 res/values-b+zh+Hant/*.xml（规则见 scripts/native-zh-hant.ts）。
// 改了 res/values-zh 下的任何文件之后运行：
//   npx tsx scripts/gen-native-zh-hant.ts
// src/lib/native-zh-hant-asset.test.ts 会在资源过期时让测试失败。
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { NATIVE_ZH_HANT_DIR, nativeZhHantFiles } from "./native-zh-hant";

const files = nativeZhHantFiles();
mkdirSync(NATIVE_ZH_HANT_DIR, { recursive: true });
// values-zh 里删掉的文件，繁体里也删掉。
for (const name of readdirSync(NATIVE_ZH_HANT_DIR)) {
  if (!files.has(name)) rmSync(path.join(NATIVE_ZH_HANT_DIR, name));
}
for (const [name, content] of files) writeFileSync(path.join(NATIVE_ZH_HANT_DIR, name), content);
console.log(`wrote ${files.size} file(s) to ${NATIVE_ZH_HANT_DIR}`);
