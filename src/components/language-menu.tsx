"use client";

import { Check, Languages, Search } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { useI18n } from "@/components/i18n-provider";
import { LOCALE_DIRS, LOCALE_NAMES, LOCALES, LOCALE_TAGS, type Locale, type LocalePreference } from "@/lib/i18n/locale";
import { useBackToClose } from "@/lib/use-back-to-close";

// 言語の一覧を開くボタンの状態（一覧の位置と、閉じたあとのフォーカス）。このメニューと設定画面の「言語」の行が使う。
export function useLanguageMenuAnchor() {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // 閉じたあとにボタンへフォーカスを戻す（開いている間はモーダルの外が操作できず、focus() が効かない）。
  const refocus = useRef(false);
  useEffect(() => {
    if (anchor || !refocus.current) return;
    refocus.current = false;
    triggerRef.current?.focus();
  }, [anchor]);
  return {
    anchor, triggerRef,
    toggle: (event: MouseEvent<HTMLButtonElement>) => setAnchor(anchor ? null : event.currentTarget.getBoundingClientRect()),
    close: () => { refocus.current = true; setAnchor(null); },
  };
}

export type LanguageChoiceHandler = (next: LocalePreference, effective: Locale, isCurrent: () => boolean) => Promise<string> | void;

// Dictionary switches never navigate or remount workspace content. Await a
// successful switch before saving the landing preference and updating its URL.
export function useLanguageChoice(onChoose?: LanguageChoiceHandler) {
  const { locale, preference, target, changeError, setPreference } = useI18n();
  const [saveError, setSaveError] = useState("");
  const request = useRef(0);
  const current = target ?? preference;
  async function choose(next: LocalePreference) {
    const id = ++request.current;
    const previous = preference;
    setSaveError("");
    if (!await setPreference(next) || id !== request.current) return;
    // Auto's effective language is supplied by the provider on the next render;
    // landing URLs use / for Auto so refresh follows the environment again.
    const error = await onChoose?.(next, next === "auto" ? locale : next, () => id === request.current);
    if (error && id === request.current) {
      await setPreference(previous);
      setSaveError(error);
    }
  }
  return { current, choose, failed: saveError || changeError || null };
}

export function LanguageMenu({ className, onChoose }: { className?: string; onChoose?: LanguageChoiceHandler }) {
  const { t, locale, preference, switching } = useI18n();
  const { anchor, triggerRef, toggle, close } = useLanguageMenuAnchor();
  const { current, choose, failed } = useLanguageChoice(onChoose);
  const label = preference === "auto" ? t("Auto (current: {language})", { language: LOCALE_NAMES[locale] }) : LOCALE_NAMES[locale];
  return (
    <>
      <button ref={triggerRef} type="button" className={className} aria-haspopup="dialog" aria-expanded={anchor !== null}
        aria-label={t("Language: {language}", { language: label })} aria-busy={switching} onClick={toggle}>
        <Languages size={14} aria-hidden="true" /><span>{label}</span>
      </button>
      {failed && <span role="alert" className="language-menu-error">{t(failed)}</span>}
      {anchor && <LanguageMenuPanel anchor={anchor} current={current} onChoose={(next) => { close(); void choose(next); }} onClose={close} />}
    </>
  );
}

// A modal dialog contains a search field and a radio group. Native buttons keep
// Enter/Space activation, while arrows/Home/End move focus without choosing.
export function LanguageMenuPanel({ anchor, current, align = "start", onChoose, onClose }: {
  anchor: DOMRect; current: LocalePreference | null; align?: "start" | "end"; onChoose: (next: LocalePreference) => void; onClose: () => void;
}) {
  const { t, locale, dir } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.visualViewport?.height ?? window.innerHeight }));
  useEffect(() => {
    const resize = () => setViewport({ width: window.innerWidth, height: window.visualViewport?.height ?? window.innerHeight });
    window.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("resize", resize);
    return () => { window.removeEventListener("resize", resize); window.visualViewport?.removeEventListener("resize", resize); };
  }, []);
  useBackToClose(true, onClose);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const focusTarget = window.matchMedia("(pointer: coarse)").matches
      ? dialog.querySelector('[role="radio"][aria-checked="true"]') ?? dialog.querySelector('[role="radio"]')
      : searchRef.current;
    // Set the target before showModal() runs its native focus step.
    focusTarget?.setAttribute("autofocus", "");
    dialog.showModal();
  }, []);
  const options: LocalePreference[] = ["auto", ...LOCALES];
  const filtered = options.filter((option) => option === "auto" || `${LOCALE_NAMES[option]} ${option} ${LOCALE_TAGS[option]}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const width = Math.min(320, viewport.width - 16);
  const height = Math.min(368, viewport.height - 16);
  const opensBelow = anchor.bottom + 4 + height <= viewport.height - 8;
  const alignRight = (dir === "ltr") === (align === "end");
  const style = {
    width,
    left: Math.max(8, Math.min(alignRight ? anchor.right - width : anchor.left, viewport.width - width - 8)),
    ...(opensBelow
      ? { top: anchor.bottom + 4, maxHeight: height }
      : { top: "auto", bottom: window.innerHeight - anchor.top + 4, maxHeight: Math.max(0, Math.min(height, anchor.top - 12)) }),
  };
  function keyboard(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.nativeEvent.isComposing) return;
    const searching = event.target === searchRef.current;
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) || (searching && ["Home", "End"].includes(event.key))) return;
    event.preventDefault();
    const items = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? []);
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
      : index < 0 ? (event.key === "ArrowDown" ? 0 : items.length - 1)
      : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
    items[next]?.scrollIntoView({ block: "nearest" });
  }
  return (
    <dialog ref={ref} aria-label={t("Language")} className="chat-actions-menu language-menu" style={style} onKeyDown={keyboard}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const r = event.currentTarget.getBoundingClientRect();
        if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) onClose();
      }}>
      <label className="language-menu-search">
        <Search size={15} aria-hidden="true" />
        <input ref={searchRef} type="search" value={query} onChange={(event) => setQuery(event.target.value)}
          placeholder={t("Search languages")} aria-label={t("Search languages")} />
      </label>
      <div role="radiogroup" aria-label={t("Language")} className="language-menu-options">
        {filtered.map((option) => (
          <button key={option} type="button" role="radio" aria-checked={option === current} className="chat-menu-item" onClick={() => onChoose(option)}>
            <span className="language-menu-name">
              {option === "auto" ? <>{t("Auto detect")}<small>{t("Auto (current: {language})", { language: LOCALE_NAMES[locale] })}</small></>
                : <><span lang={LOCALE_TAGS[option]} dir={LOCALE_DIRS[option]} translate="no">{LOCALE_NAMES[option]}</span>{option === locale && <small>{t("Current language")}</small>}</>}
            </span>
            <Check size={15} aria-hidden="true" className={`language-menu-check${option === current ? "" : " invisible"}`} />
          </button>
        ))}
      </div>
      {filtered.length === 1 && query && <p role="status" className="language-menu-empty">{t("No languages found.")}</p>}
    </dialog>
  );
}
