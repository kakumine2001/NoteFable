// 从默认英文资源（res/values/strings*.xml）与网页多语言字典（src/lib/i18n/messages/*.ts）生成 Android 13 种新增语言的 XML。
// 运行：npx tsx scripts/gen-native-strings.ts
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  GENERATED_NATIVE_LOCALES,
  NATIVE_LOCALE_RES_DIRS,
  NATIVE_RES_DIR,
  nativeLocaleStringFiles,
} from "./native-strings";

let totalFiles = 0;
for (const locale of GENERATED_NATIVE_LOCALES) {
  const dir = path.join(NATIVE_RES_DIR, NATIVE_LOCALE_RES_DIRS[locale]);
  mkdirSync(dir, { recursive: true });
  const expected = nativeLocaleStringFiles(locale);
  for (const existing of readdirSync(dir)) {
    if (existing.endsWith(".xml") && !expected.has(existing)) {
      rmSync(path.join(dir, existing));
    }
  }
  for (const [name, content] of expected) {
    writeFileSync(path.join(dir, name), content);
    totalFiles++;
  }
}
console.log(`Generated ${totalFiles} Android string XML files across ${GENERATED_NATIVE_LOCALES.length} locales.`);
