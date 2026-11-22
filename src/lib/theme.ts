"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { THEME_STORAGE_KEY } from "@/lib/theme-init";

export { THEME_STORAGE_KEY } from "@/lib/theme-init";
export const THEME_EVENT = "notefable:theme-changed";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

export function parseThemePreference(value: unknown): ThemePreference | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  return isThemePreference(normalized) ? normalized : undefined;
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): ResolvedTheme {
  if (preference === "dark") return "dark";
  if (preference === "light") return "light";
  return systemDark ? "dark" : "light";
}

// 保存できなかった（容量超過・ストレージ無効）ときに、このタブの間だけ覚えておく設定。保存できたら空に戻す。
let unsavedPreference: ThemePreference | null = null;

export function readThemePreference(
  storage: Pick<Storage, "getItem"> | undefined = typeof localStorage === "undefined" ? undefined : localStorage,
): ThemePreference {
  if (unsavedPreference) return unsavedPreference;
  if (!storage) return "system";
  try {
    return parseThemePreference(storage.getItem(THEME_STORAGE_KEY)) ?? "system";
  } catch {
    return "system";
  }
}

export function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function applyThemeToDocument(preference: ThemePreference, systemDark = systemPrefersDark()): ResolvedTheme {
  const resolved = resolveTheme(preference, systemDark);
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved;
  }
  return resolved;
}

export function saveThemePreference(
  preference: ThemePreference,
  storage: Pick<Storage, "setItem"> | undefined = typeof localStorage === "undefined" ? undefined : localStorage,
): ResolvedTheme {
  unsavedPreference = preference;
  if (storage) {
    try {
      storage.setItem(THEME_STORAGE_KEY, preference);
      unsavedPreference = null;
    } catch {
      // ストレージが使えない環境でも現在タブへの反映は続ける（読み直しても元に戻らないよう unsavedPreference に残す）。
    }
  }
  const resolved = applyThemeToDocument(preference);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<ThemePreference>(THEME_EVENT, { detail: preference }));
  }
  return resolved;
}

function subscribeTheme(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  const media = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  const onChange = () => {
    applyThemeToDocument(readThemePreference());
    onStoreChange();
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== THEME_STORAGE_KEY) return;
    // 別のタブで選び直されたら、そちらに合わせる。
    unsavedPreference = null;
    onChange();
  };
  window.addEventListener(THEME_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  media?.addEventListener?.("change", onChange);
  return () => {
    window.removeEventListener(THEME_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
    media?.removeEventListener?.("change", onChange);
  };
}

function getThemeSnapshot(): string {
  const pref = readThemePreference();
  const resolved = resolveTheme(pref, systemPrefersDark());
  return `${pref}:${resolved}`;
}

export function useTheme(): {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (next: ThemePreference) => void;
} {
  const raw = useSyncExternalStore(subscribeTheme, getThemeSnapshot, () => "system:light");
  const [preference, resolved] = raw.split(":") as [ThemePreference, ResolvedTheme];

  useEffect(() => {
    applyThemeToDocument(preference);
  }, [preference, resolved]);

  const setPreference = useCallback((next: ThemePreference) => {
    saveThemePreference(next);
  }, []);

  return { preference, resolved, setPreference };
}
