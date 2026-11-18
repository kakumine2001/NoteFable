// 原生 Android 用的"服务端系统文"词典（mobile/android/app/src/main/assets/system-text.json）的内容。
// 服务端 API 返回英文原句（msg() / fmt() 只做标记），网页显示时用 t() / localizeSystemText 翻译；原生端没有网页的字典，
// 所以把服务端可能发出的句子和它们的中 / 日译文打包进安装包。收录范围：
//   - src/app/api 下的路由文件，以及它们（经 import）用到的 .ts 模块里 msg() / fmt() 的第一个参数；
//   - 服务端字典 zh-server.ts 的全部键；
//   - SYSTEM_TEXT_TEMPLATES（带 {占位符} 的系统文句型，原生端按同样的规则拆开再翻译）。
// 生成：npx tsx scripts/gen-native-system-text.ts；src/lib/native-system-text-asset.test.ts 检查资源是否过期。
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { LOCALES as ALL_LOCALES, type Locale } from "../src/lib/i18n/locale";
import { messagesFor } from "../src/lib/i18n/messages";
import { zhServer } from "../src/lib/i18n/messages/zh-server";
import { SYSTEM_TEXT_TEMPLATES } from "../src/lib/i18n/translate";

export const NATIVE_SYSTEM_TEXT_ASSET = "mobile/android/app/src/main/assets/system-text.json";

// 原生端全部非英文界面语言。英文不需要词典。
type TranslatedLocale = Exclude<Locale, "en">;
const LOCALES = ALL_LOCALES.filter((locale): locale is TranslatedLocale => locale !== "en");

export type NativeSystemText = {
  templates: string[];
  messages: Record<TranslatedLocale, Record<string, string>>;
};

const root = path.resolve(import.meta.dirname, "..");
const src = path.join(root, "src");

function listFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(file) : [file];
  });
}

const isSource = (file: string) => /\.ts$/.test(file) && !/\.(test|spec)\.ts$/.test(file) && !file.endsWith(".d.ts");

function resolveImport(from: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = path.join(src, specifier.slice(2));
  else if (specifier.startsWith(".")) base = path.resolve(path.dirname(from), specifier);
  else return null;
  for (const candidate of [base, `${base}.ts`, path.join(base, "index.ts")]) {
    if (existsSync(candidate) && statSync(candidate).isFile() && isSource(candidate)) return candidate;
  }
  return null;
}

// 从 API 路由出发，沿 import（静态 import / export，以及 await import("...") 这种动态 import）
// 收集服务端会用到的模块里标记过的句子。返回句子和走过的模块（测试用）。
export function crawlServerModules(
  roots: string[] = listFiles(path.join(src, "app", "api")).filter(isSource),
): { keys: Set<string>; modules: Set<string> } {
  const keys = new Set<string>();
  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const target = resolveImport(file, node.moduleSpecifier.text);
        if (target) queue.push(target);
      }
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const specifier = node.arguments[0];
        if (specifier && (ts.isStringLiteral(specifier) || ts.isNoSubstitutionTemplateLiteral(specifier))) {
          const target = resolveImport(file, specifier.text);
          if (target) queue.push(target);
        }
      }
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ["msg", "fmt"].includes(node.expression.text)) {
        const first = node.arguments[0];
        if (first && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))) keys.add(first.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return { keys, modules: seen };
}

export function nativeSystemText(): NativeSystemText {
  const keys = new Set([...crawlServerModules().keys, ...Object.keys(zhServer), ...SYSTEM_TEXT_TEMPLATES]);
  const sorted = [...keys].sort();
  const messages = Object.fromEntries(LOCALES.map((locale) => {
    const dictionary = messagesFor(locale);
    const missing = sorted.filter((key) => !Object.hasOwn(dictionary, key));
    if (missing.length) throw new Error(`${locale} dictionary is missing server texts: ${missing.join(" | ")}`);
    return [locale, Object.fromEntries(sorted.map((key) => [key, dictionary[key]]))];
  })) as NativeSystemText["messages"];
  return { templates: [...SYSTEM_TEXT_TEMPLATES], messages };
}

export function nativeSystemTextJson(): string {
  return JSON.stringify(nativeSystemText(), null, 2) + "\n";
}
