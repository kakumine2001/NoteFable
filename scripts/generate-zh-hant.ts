// 簡体字の辞書（zh.ts と zh-server.ts）から繁体字の辞書 zh-hant.ts を作る。
// 実行: npx tsx scripts/generate-zh-hant.ts
// 中国語の文を足したり直したりしたら、このスクリプトを実行し直して結果もコミットする（テストが食い違いを検出する）。
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as OpenCC from "opencc-js";
import { zh } from "../src/lib/i18n/messages/zh";
import { zhServer } from "../src/lib/i18n/messages/zh-server";

// 台湾の繁体字（用語も台湾の言い方に寄せる）。香港・マカオの利用者にも同じ辞書を出す。
const convert = OpenCC.Converter({ from: "cn", to: "twp" });
const source = { ...zh, ...zhServer };
const lines = Object.keys(source).sort().map((key) => `  ${JSON.stringify(key)}: ${JSON.stringify(convert(source[key]))},`);
const output = [
  "// このファイルは scripts/generate-zh-hant.ts が zh.ts と zh-server.ts から作る。直接編集しない。",
  "export const zhHant: Record<string, string> = {",
  ...lines,
  "};",
  "",
].join("\n");
writeFileSync(fileURLToPath(new URL("../src/lib/i18n/messages/zh-hant.ts", import.meta.url)), output);
console.log(`zh-hant.ts: ${lines.length} entries`);
