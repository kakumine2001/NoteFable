// 生成原生 Android 安装包里自带的页面类型功能表（mobile/android/app/src/main/assets/page-kinds.json，iOS 经 project.yml 共用同一份）。
// 内容是 src/lib/page-kinds.ts 的 PAGE_KIND_FEATURES，格式与 GET /api/pages 返回的 kinds 相同。App 读到服务端的 kinds 之前
// （以及旧服务端不发 kinds 时）用它；服务端的表一到就以服务端为准，所以开关在网页部署后三端一起切换。改了表之后运行：
//   npx tsx scripts/gen-native-page-kinds.ts
// src/lib/native-page-kinds-asset.test.ts 会在资源过期时让测试失败。
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { PAGE_KIND_FEATURES } from "../src/lib/page-kinds";

const target = "mobile/android/app/src/main/assets/page-kinds.json";
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, JSON.stringify(PAGE_KIND_FEATURES, null, 2) + "\n");
console.log(`wrote ${target}`);
