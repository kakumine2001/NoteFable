// 原生 Android 的繁体中文文案（res/values-b+zh+Hant/*.xml）的内容。
// 和网页的 zh-hant.ts（scripts/generate-zh-hant.ts）一样，从简体中文用 OpenCC（cn → twp，台湾用字和用语）转换，不手写：
// values-zh 下的每个 XML 文件转换成 values-b+zh+Hant 下的同名文件，只转换标签之间的文字，键、属性和注释原样保留。
// 唯一的例外是 ui_locale（界面实际使用的语言代码），繁体资源里写 "zh-Hant"。
// 生成：npx tsx scripts/gen-native-zh-hant.ts；src/lib/native-zh-hant-asset.test.ts 检查资源是否过期。
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import * as OpenCC from "opencc-js";

const root = path.resolve(import.meta.dirname, "..");
const res = path.join(root, "mobile", "android", "app", "src", "main", "res");
export const NATIVE_ZH_DIR = path.join(res, "values-zh");
export const NATIVE_ZH_HANT_DIR = path.join(res, "values-b+zh+Hant");

const HEADER = "<!-- 这个文件由 scripts/gen-native-zh-hant.ts 从 values-zh 的同名文件生成，不要直接修改。 -->";
const convert = OpenCC.Converter({ from: "cn", to: "twp" });

/** 一个 values-zh 文件的繁体版本。 */
export function toTraditionalXml(xml: string): string {
  const body = xml.replace(/\r\n/g, "\n").replace(/>([^<]+)</g, (_, text: string) => `>${convert(text)}<`)
    .replace(/(<string name="ui_locale"[^>]*>)[^<]*(<\/string>)/, "$1zh-Hant$2");
  // 在 XML 声明后面加上"生成文件"的说明。
  return body.replace(/^(<\?xml[^>]*\?>\n)?/, (declaration) => `${declaration}${HEADER}\n`);
}

/** values-b+zh+Hant 应有的全部文件：文件名 → 内容。 */
export function nativeZhHantFiles(): Map<string, string> {
  const files = readdirSync(NATIVE_ZH_DIR).filter((name) => name.endsWith(".xml")).sort();
  return new Map(files.map((name) => [name, toTraditionalXml(readFileSync(path.join(NATIVE_ZH_DIR, name), "utf8"))]));
}
