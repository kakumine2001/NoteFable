// 从 Android 的字符串资源生成 iOS 的 Localizable.strings（说明见 scripts/ios-strings.ts）。
// 改了 mobile/android/app/src/main/res/values*/strings*.xml（或跑了 gen-native-strings.ts / gen-native-zh-hant.ts）之后运行：
//   npx tsx scripts/gen-ios-strings.ts
// src/lib/ios-strings.test.ts 会在文件过期时让测试失败。
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { existingIosStringsPaths, IOS_RESOURCES_DIR, iosStringsFiles } from "./ios-strings";

const files = iosStringsFiles();
// 语言表里去掉的语言：只删它的 Localizable.strings，lproj 里别的文件不动。
for (const stale of existingIosStringsPaths()) {
  if (!files.has(stale)) rmSync(stale);
}
for (const [file, content] of files) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}
console.log(`wrote ${files.size} Localizable.strings file(s) under ${IOS_RESOURCES_DIR}`);
