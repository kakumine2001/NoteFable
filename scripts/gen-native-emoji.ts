// 生成原生 Android 表情选择器的数据 assets/emoji.json（内容见 scripts/native-emoji.ts）。
// 升级 emoji-picker-react 之后运行：
//   npx tsx scripts/gen-native-emoji.ts
// src/lib/native-emoji-asset.test.ts 会在资源过期时让测试失败。
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { NATIVE_EMOJI_ASSET, nativeEmojiJson } from "./native-emoji";

void nativeEmojiJson().then((json) => {
  mkdirSync(dirname(NATIVE_EMOJI_ASSET), { recursive: true });
  writeFileSync(NATIVE_EMOJI_ASSET, json);
  console.log(`wrote ${NATIVE_EMOJI_ASSET}`);
});
