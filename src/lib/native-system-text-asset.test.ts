import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { crawlServerModules, NATIVE_SYSTEM_TEXT_ASSET, nativeSystemText, nativeSystemTextJson } from "../../scripts/native-system-text";
import { LOCALES } from "./i18n/locale";

// 生成时要用 TypeScript 编译器沿 import 爬一遍服务端代码，机器忙时会超过默认的 5 秒。
describe("native system text asset", { timeout: 60_000 }, () => {
  it("is up to date (regenerate with npx tsx scripts/gen-native-system-text.ts)", () => {
    expect(readFileSync(NATIVE_SYSTEM_TEXT_ASSET, "utf8").replace(/\r\n/g, "\n")).toBe(nativeSystemTextJson());
  });

  it("covers server-emitted errors, usage-limit texts and the system templates across all 16 non-English languages", () => {
    const { templates, messages } = nativeSystemText();
    const translatedLocales = LOCALES.filter((l): l is Exclude<(typeof LOCALES)[number], "en"> => l !== "en");
    expect(Object.keys(messages)).toEqual(translatedLocales);
    for (const key of [
      "Request failed: {detail}",
      "Note not found.",
      "Invalid purchase.",
      "This proposal was discarded.",
      "This note changed after the proposal was made. Ask again to get a fresh proposal.",
      "Upload up to {max} files at a time.",
      "You've used today's free messages. Sign in for more, or try again tomorrow.",
      "Searched notes for “{query}”",
      "Could not save the chat. Please try again.",
    ]) {
      for (const locale of translatedLocales) {
        expect(messages[locale][key], `${locale}: ${key}`).toBeTruthy();
      }
    }
    expect(templates).toContain("Read “{title}”");
    expect(messages.zh["Request failed: {detail}"]).toBe("请求失败：{detail}");
  });

  it("follows dynamic imports (await import(\"...\")) as well as static ones", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "native-system-text-"));
    try {
      writeFileSync(path.join(dir, "route.ts"), 'export async function GET() { const { f } = await import("./lazy"); return f(); }\n');
      writeFileSync(path.join(dir, "lazy.ts"), 'export function f() { throw new Error(msg("Only reached lazily.")); }\n');
      const { keys, modules } = crawlServerModules([path.join(dir, "route.ts")]);
      expect(modules).toContain(path.join(dir, "lazy.ts"));
      expect(keys).toContain("Only reached lazily.");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
