// 生成原生 Android 安装包里自带的每日上限（mobile/android/app/src/main/assets/usage-limits.json）。
// 内容就是 src/lib/usage-plans.ts 的 USAGE_LIMITS，每档再加上文件存储上限 storage（STORAGE_LIMITS，字节）。App 的上限登录提示（GuestLimitPrompt）用 member 的数值，
// 和网页 guest-limit-prompt.tsx 一样不从接口读。改了 usage-plans.ts 之后运行：
//   node node_modules/tsx/dist/cli.mjs scripts/gen-native-usage-limits.ts
// src/lib/native-usage-limits-asset.test.ts 会在数值过期时让测试失败。
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { nativeUsageLimits } from "../src/lib/usage-plans";

const target = "mobile/android/app/src/main/assets/usage-limits.json";
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, JSON.stringify(nativeUsageLimits(), null, 2) + "\n");
console.log(`wrote ${target}`);
