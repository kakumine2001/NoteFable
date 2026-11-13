"use client";

import { Check, ChevronDown, Globe, Loader2 } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Popover, usePickerBackToClose } from "@/components/emoji-picker";
import { useI18n } from "@/components/i18n-provider";
import { LOCALES, LOCALE_NAMES, type LocalePreference } from "@/lib/i18n/locale";

const OPTIONS: LocalePreference[] = ["auto", ...LOCALES];

// 表示言語の切替。OS 標準の選択欄ではなく、アプリの他のメニューと同じ見た目のポップオーバーで選ぶ。
// サイドバー下部では上へ、ホームのナビでは下へ開く。ログイン前でも使える。
export function LanguageSelect({ compact = false }: { compact?: boolean }) {
  const { t, preference, setPreference, switching } = useI18n();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // スマホのサイドバー（ドロワー）の中で開いたとき、Android の戻る・Esc はまずこのメニューだけを閉じる。
  usePickerBackToClose(open, () => setOpen(false));
  // 開いたら選択中の項目へフォーカスする（Popover が自分にフォーカスした後に動かすため次のフレームで）。
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => menuRef.current?.querySelector<HTMLButtonElement>("[aria-checked=true]")?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [open]);
  const label = (option: LocalePreference) => (option === "auto" ? t("Automatic") : LOCALE_NAMES[option]);

  function choose(option: LocalePreference) {
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
    if (option !== preference) setPreference(option);
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role=menuitemradio]") ?? []);
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
      : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  }

  return (
    <div className={`language-select${compact ? " is-compact" : ""}`}>
      <button ref={triggerRef} type="button" className="language-select-trigger" disabled={switching}
        aria-haspopup="menu" aria-expanded={open} aria-label={compact ? `${t("Language")}: ${label(preference)}` : undefined}
        onClick={() => setOpen((value) => !value)}>
        <Globe size={compact ? 15 : 16} aria-hidden="true" />
        {!compact && <span className="language-select-label">{t("Language")}</span>}
        <span className="language-select-value">{label(preference)}</span>
        {switching ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />}
      </button>
      {open && (
        <Popover className="language-menu" label={t("Language")} trigger={triggerRef} onClose={() => setOpen(false)}>
          <div ref={menuRef} role="menu" aria-label={t("Language")} onKeyDown={onMenuKeyDown}>
            {OPTIONS.map((option) => (
              <button key={option} type="button" role="menuitemradio" aria-checked={option === preference}
                lang={option === "auto" ? undefined : option} className="chat-menu-item language-menu-item" onClick={() => choose(option)}>
                <span className="flex-1">{label(option)}</span>
                {option === preference && <Check size={15} aria-hidden="true" />}
              </button>
            ))}
          </div>
        </Popover>
      )}
      <span className="sr-only" role="status">{switching ? t("Changing language…") : ""}</span>
    </div>
  );
}
