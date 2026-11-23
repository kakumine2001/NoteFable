import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";
import { en as blockNoteEn } from "@blocknote/core/locales";
import { describe, expect, it } from "vitest";
import { toTraditional } from "../../../scripts/zh-hant-terms";
import { BLOCKNOTE_LOCALES_DIR, renderUpstreamBlockNoteLocale, UPSTREAM_BLOCKNOTE_LOCALES } from "../../../scripts/gen-blocknote-locales";
import { cachedBlockNoteDictionary, loadBlockNoteDictionary } from "./blocknote-locales";
import { LOCALES, type Locale } from "./locale";
import { messagesFor } from "./messages";
import { loadMessages } from "./messages/load";
import { zh } from "./messages/zh";
import { zhHant } from "./messages/zh-hant";
import { zhServer } from "./messages/zh-server";
import { SYSTEM_TEXT_TEMPLATES } from "./translate";

// Scan real call sites and marked constant tables so a new UI sentence cannot
// silently fall back to English in any translated interface.
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

const keys = new Set([...sourceKeys(fileURLToPath(new URL("../../", import.meta.url))), ...SYSTEM_TEXT_TEMPLATES]);
const slotCounts = (text: string) => {
  const counts: Record<string, number> = {};
  for (const slot of text.match(/\{\w+\}/g) ?? []) counts[slot] = (counts[slot] ?? 0) + 1;
  return Object.entries(counts).sort(([a], [b]) => a.localeCompare(b));
};

const TRANSLATED_LOCALES = LOCALES.filter((code): code is Exclude<Locale, "en"> => code !== "en");

// Terms legitimately identical to English in some Latin-script languages.
const IDENTICAL_SENTENCE_ALLOWLIST = new Set([
  "NoteFable: ",
  "Ctrl K",
  "Use Google photo",
  // 提案カードの見出し（操作と要素の名前）。言語によっては引用符もそのまま。
  "{op} · “{name}”",
]);

describe.each(TRANSLATED_LOCALES)("%s UI and server dictionary", (locale) => {
  it("translates every marked UI and server sentence without empty values", () => {
    const dictionary = messagesFor(locale);
    expect(keys.size).toBeGreaterThan(800);
    const missing = [...keys].filter((key) => !Object.hasOwn(dictionary, key) || !dictionary[key].trim());
    expect(missing).toEqual([]);
  });

  it("preserves exact interpolation slot names and occurrence counts", () => {
    const mismatches = Object.entries(messagesFor(locale)).filter(([source, translated]) =>
      JSON.stringify(slotCounts(source)) !== JSON.stringify(slotCounts(translated)));
    expect(mismatches).toEqual([]);
  });

  it("preserves markdown emphasis markers and leaves no untranslated multi-word English sentences", () => {
    const dictionary = messagesFor(locale);
    expect(dictionary["_This version has no text._"]).toMatch(/^_.+_$/);
    const untranslated = Object.entries(dictionary)
      .filter(([source, translated]) =>
        source === translated &&
        source.trim().split(/\s+/).length >= 3 &&
        !IDENTICAL_SENTENCE_ALLOWLIST.has(source))
      .map(([source]) => source);
    expect(untranslated).toEqual([]);
  });
});

describe("Traditional Chinese dictionary", () => {
  it("is regenerated from the Simplified Chinese dictionaries (npx tsx scripts/generate-zh-hant.ts)", () => {
    const expected = Object.fromEntries(Object.entries({ ...zh, ...zhServer }).map(([key, value]) => [key, toTraditional(value)]));
    expect(zhHant).toEqual(expected);
  });
});

describe("enabled dictionaries, lazy loader, and BlockNote locales", () => {
  it("ships all 17 languages and translates the Auto and search controls", () => {
    expect(LOCALES).toEqual([
      "en", "zh", "zh-Hant", "ja",
      "ko", "es", "fr", "de", "pt-BR", "it",
      "id", "vi", "th", "hi", "ar", "tr", "ru",
    ]);
    for (const locale of TRANSLATED_LOCALES) {
      for (const key of ["Auto detect", "Auto (current: {language})", "Search languages", "Current language", "No languages found."]) {
        expect(messagesFor(locale)[key], `${locale}: ${key}`).toBeTruthy();
      }
    }
  });

  it("lazy loadMessages returns the exact same dictionary as messagesFor for every locale", async () => {
    for (const locale of LOCALES) {
      expect(await loadMessages(locale), locale).toEqual(messagesFor(locale));
    }
  });

  it("lazy-loads per-locale BlockNote dictionaries matching the English schema while keeping English synchronous", async () => {
    function checkShape(ref: unknown, candidate: unknown, pathLabel: string): string[] {
      if (typeof ref === "string") {
        return typeof candidate === "string" ? [] : [`${pathLabel}: expected string`];
      }
      if (typeof ref === "function") {
        return typeof candidate === "function" ? [] : [`${pathLabel}: expected function`];
      }
      if (Array.isArray(ref)) {
        return Array.isArray(candidate) && candidate.length > 0 ? [] : [`${pathLabel}: expected non-empty array`];
      }
      if (ref && typeof ref === "object") {
        if (!candidate || typeof candidate !== "object") return [`${pathLabel}: expected object`];
        const errors: string[] = [];
        for (const [k, v] of Object.entries(ref)) {
          errors.push(...checkShape(v, (candidate as Record<string, unknown>)[k], `${pathLabel}.${k}`));
        }
        return errors;
      }
      return [];
    }

    // English is ready synchronously for first render; non-English locales are not eagerly bundled.
    expect(cachedBlockNoteDictionary("en")).toBe(blockNoteEn);
    expect(cachedBlockNoteDictionary("ar")).toBeNull();

    const staticSource = readFileSync(fileURLToPath(new URL("./blocknote-locales.ts", import.meta.url)), "utf8");
    expect(staticSource).not.toMatch(/blocknote-custom-locales/);
    expect(staticSource).toContain('await import("./blocknote-locales/ar")');

    for (const locale of LOCALES) {
      const dict = await loadBlockNoteDictionary(locale);
      expect(cachedBlockNoteDictionary(locale)).toBe(dict);
      expect(checkShape(blockNoteEn, dict, locale)).toEqual([]);
    }
  });

  it("keeps generated upstream BlockNote locale modules in sync with @blocknote/core (npx tsx scripts/gen-blocknote-locales.ts)", () => {
    for (const entry of UPSTREAM_BLOCKNOTE_LOCALES) {
      const actual = readFileSync(path.join(BLOCKNOTE_LOCALES_DIR, entry.file), "utf8").replace(/\r\n/g, "\n");
      expect(actual, entry.file).toBe(renderUpstreamBlockNoteLocale(entry.upstream, entry.exportName));
    }
  });
});

describe("API user-facing error marking", () => {
  // Endpoints consumed only by server-to-server webhooks or internal native token plumbing whose error text is never shown to users.
  const NON_USER_FACING_API_PATHS = [
    "app/api/billing/webhook/",
    "app/api/billing/google/notify/",
    "app/api/native-auth/",
    "app/api/uploads/local/",
  ];

  it("marks every literal error response in user-facing API routes and proposal handlers with msg() or fmt()", () => {
    const srcRoot = fileURLToPath(new URL("../../", import.meta.url));
    const listFiles = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        return entry.isDirectory() ? listFiles(full) : [full];
      });

    const targets = [
      ...listFiles(path.join(srcRoot, "app", "api")),
      path.join(srcRoot, "lib", "page-ai", "proposals.ts"),
    ].filter((file) => {
      const rel = path.relative(srcRoot, file).replaceAll("\\", "/");
      return /\.ts$/.test(rel) && !/\.(test|spec)\.ts$/.test(rel) && !NON_USER_FACING_API_PATHS.some((skip) => rel.startsWith(skip));
    });

    const unmarked: string[] = [];
    const isBareString = (node: ts.Node) =>
      ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node);

    for (const file of targets) {
      const rel = path.relative(srcRoot, file).replaceAll("\\", "/");
      const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node) => {
        if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === "error" && isBareString(node.initializer)) {
          const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
          unmarked.push(`${rel}:${line} -> ${node.initializer.getText()}`);
        }
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "fail") {
          for (const arg of node.arguments) {
            if (isBareString(arg)) {
              const line = sf.getLineAndCharacterOfPosition(arg.getStart()).line + 1;
              unmarked.push(`${rel}:${line} -> ${arg.getText()}`);
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }

    expect(unmarked).toEqual([]);
  });
});
