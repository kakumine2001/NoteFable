"use client";

import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { useId } from "react";
import { useT } from "@/components/i18n-provider";
import { msg } from "@/lib/i18n/translate";
import { useTheme, type ThemePreference } from "@/lib/theme";

export const THEME_OPTIONS: { value: ThemePreference; label: string; icon: LucideIcon }[] = [
  { value: "system", label: msg("System"), icon: Monitor },
  { value: "light", label: msg("Light"), icon: Sun },
  { value: "dark", label: msg("Dark"), icon: Moon },
];

// 設定 → 一般 の「外観」行（システム / ライト / ダーク）。この端末の localStorage に保存する。
export function ThemeSettings() {
  const t = useT();
  const labelId = useId();
  const { preference, setPreference } = useTheme();

  return (
    <div className="settings-row settings-theme-row">
      <span id={labelId} className="settings-row-title">{t("Appearance")}</span>
      <div role="radiogroup" aria-labelledby={labelId} className="settings-theme-group">
        {THEME_OPTIONS.map(({ value, label, icon: Icon }) => {
          const checked = preference === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={checked}
              className={`settings-theme-option${checked ? " is-selected" : ""}`}
              onClick={() => setPreference(value)}
            >
              <Icon size={14} aria-hidden="true" />
              <span>{t(label)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
