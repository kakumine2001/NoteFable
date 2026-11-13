import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { messagesFor } from "./messages";

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
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ["t", "msg"].includes(node.expression.text)) {
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

describe.each(["zh", "ja"] as const)("%s UI dictionary", (locale) => {
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
