// 生成原生 Android 安装包里自带的模型列表（mobile/android/app/src/main/assets/models.json）。
// 内容是 src/lib/models.ts 的内置列表（不受 NOTEFABLE_MODELS 影响），格式与 GET /api/models 相同。线上接口读不到时，App 用它作后备，
// 这样模型切换不依赖线上是否部署了新接口。改了 models.ts 之后运行：
//   node node_modules/tsx/dist/cli.mjs scripts/gen-native-models.ts
// src/lib/native-models-asset.test.ts 会在列表过期时让测试失败。
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { publicModels } from "../src/lib/model-registry";
import { BUILTIN_REGISTRY } from "../src/lib/models";

const target = "mobile/android/app/src/main/assets/models.json";
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, JSON.stringify(publicModels(BUILTIN_REGISTRY), null, 2) + "\n");
console.log(`wrote ${target}`);
