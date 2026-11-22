import { describe, expect, it } from "vitest";
import { isThemePreference, parseThemePreference, readThemePreference, resolveTheme, saveThemePreference, THEME_STORAGE_KEY } from "./theme";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
  };
}

describe("theme preference helpers", () => {
  it("validates and resolves system/light/dark preferences", () => {
    expect(isThemePreference("system")).toBe(true);
    expect(isThemePreference("light")).toBe(true);
    expect(isThemePreference("dark")).toBe(true);
    expect(isThemePreference("sepia")).toBe(false);

    expect(parseThemePreference(" DARK ")).toBe("dark");
    expect(parseThemePreference("invalid")).toBeUndefined();

    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("persists and restores theme preference with safe fallback", () => {
    const storage = memoryStorage();
    expect(readThemePreference(storage)).toBe("system");

    saveThemePreference("dark", storage);
    expect(storage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(readThemePreference(storage)).toBe("dark");

    storage.setItem(THEME_STORAGE_KEY, "garbage");
    expect(readThemePreference(storage)).toBe("system");
  });

  it("keeps the chosen theme for this tab when storage refuses the write", () => {
    const full = { getItem: () => "light", setItem: () => { throw new Error("QuotaExceededError"); } };
    saveThemePreference("dark", full);
    // 保存できなくても、読み直したときに古い保存値へ戻らない。
    expect(readThemePreference(full)).toBe("dark");
    // 次に保存できたら、保存値に従う。
    const storage = memoryStorage();
    saveThemePreference("light", storage);
    expect(readThemePreference(storage)).toBe("light");
    expect(readThemePreference(full)).toBe("light");
  });
});
