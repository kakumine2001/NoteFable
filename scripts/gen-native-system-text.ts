// 生成原生 Android 安装包里的服务端系统文词典（收录范围见 scripts/native-system-text.ts）。
// 改了服务端的 msg() / fmt() 句子、zh-server.ts / ja-server.ts 或 SYSTEM_TEXT_TEMPLATES 之后运行：
//   npx tsx scripts/gen-native-system-text.ts
// src/lib/native-system-text-asset.test.ts 会在资源过期时让测试失败。
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { NATIVE_SYSTEM_TEXT_ASSET, nativeSystemTextJson } from "./native-system-text";

mkdirSync(dirname(NATIVE_SYSTEM_TEXT_ASSET), { recursive: true });
writeFileSync(NATIVE_SYSTEM_TEXT_ASSET, nativeSystemTextJson());
console.log(`wrote ${NATIVE_SYSTEM_TEXT_ASSET}`);
