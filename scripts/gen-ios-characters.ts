// 生成 iOS 端的角色数据 mobile/ios/NoteFable/Core/Support/CharactersData.generated.swift（内容见 scripts/ios-characters.ts）。
// 改了 src/lib/characters.ts 之后和 scripts/gen-native-characters.ts 一起运行：
//   npx tsx scripts/gen-ios-characters.ts
// src/lib/ios-characters.test.ts 会在文件过期时让测试失败。
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { IOS_CHARACTERS_SWIFT, renderIosCharactersSwift } from "./ios-characters";

const target = path.resolve(import.meta.dirname, "..", IOS_CHARACTERS_SWIFT);
mkdirSync(path.dirname(target), { recursive: true });
writeFileSync(target, renderIosCharactersSwift());
console.log(`wrote ${IOS_CHARACTERS_SWIFT}`);
