import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";
import { Converter } from "opencc-js";
import { describe, expect, it } from "vitest";
import { messagesFor } from "./messages";
import { zh } from "./messages/zh";
import { zhHant } from "./messages/zh-hant";
import { zhServer } from "./messages/zh-server";

// Scan real call sites and marked constant tables so a new UI sentence cannot
// silently fall back to English in either translated interface.
function sourceKeys(directory: string): Set<string> {
  const keys = new Set<string>();
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      for (const key of sourceKeys(file)) keys.add(key);
    } else if (/\.tsx?$/.test(file) && !/\.(test|spec)\.tsx?$/.test(file)) {
      const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ["t", "msg", "fmt"].includes(node.expression.text)) {
          const first = node.arguments[0];
          if (first && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))) keys.add(first.text);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  }
  return keys;
}

const keys = sourceKeys(fileURLToPath(new URL("../../", import.meta.url)));
const slots = (text: string) => [...new Set(text.match(/\{\w+\}/g) ?? [])].sort();

describe.each(["zh", "zh-Hant", "ja"] as const)("%s UI dictionary", (locale) => {
  it("translates every marked UI sentence", () => {
    const dictionary = messagesFor(locale);
    expect(keys.size).toBeGreaterThan(400);
    const missing = [...keys].filter((key) => !Object.hasOwn(dictionary, key) || !dictionary[key].trim());
    expect(missing).toEqual([]);
  });

  it("preserves interpolation slots, including rich-text markers", () => {
    const mismatches = Object.entries(messagesFor(locale)).filter(([source, translated]) =>
      JSON.stringify(slots(source)) !== JSON.stringify(slots(translated)));
    expect(mismatches).toEqual([]);
  });
});

describe("Traditional Chinese dictionary", () => {
  it("is regenerated from the Simplified Chinese dictionaries (npx tsx scripts/generate-zh-hant.ts)", () => {
    const convert = Converter({ from: "cn", to: "twp" });
    const expected = Object.fromEntries(Object.entries({ ...zh, ...zhServer }).map(([key, value]) => [key, convert(value)]));
    expect(zhHant).toEqual(expected);
  });
});
