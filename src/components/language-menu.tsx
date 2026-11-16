"use client";

import { Check, Languages } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useI18n } from "@/components/i18n-provider";
import { LOCALE_NAMES, LOCALES, type Locale } from "@/lib/i18n/locale";
import { useBackToClose } from "@/lib/use-back-to-close";

// 表示言語のメニュー（ログインしていない人のサイドバー下部と、紹介ページのフッター）。ボタンとメニューの印は今の表示言語。
// 選んでいなければ環境の言語（src/lib/i18n/locale.ts の順）で表示していて、それに印が付く。
// 選ぶとその場で切り替わり、このブラウザ（Cookie）に残る。ログインした人の言語はアカウントに保存し、設定画面で選ぶ。
// onChoose は呼び出し側の追加の処理（紹介ページ: アカウントへの保存と URL の言語）。
export function LanguageMenu({ className, onChoose }: { className?: string; onChoose?: (next: Locale) => void }) {
  const { t, locale, target, setPreference } = useI18n();
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // 切り替え中ならその行き先に印を付ける。
  const current = target && target !== "auto" ? target : locale;

  function choose(next: Locale) {
    setAnchor(null);
    triggerRef.current?.focus();
    if (next === current) return;
    setPreference(next);
    onChoose?.(next);
  }

  return (
    <>
      <button ref={triggerRef} type="button" className={className} aria-haspopup="menu" aria-expanded={anchor !== null}
        aria-label={t("Language: {language}", { language: LOCALE_NAMES[locale] })}
        onClick={(event) => setAnchor(anchor ? null : event.currentTarget.getBoundingClientRect())}>
        <Languages size={14} aria-hidden="true" />
        <span lang={locale}>{LOCALE_NAMES[locale]}</span>
      </button>
      {anchor && <LanguageMenuPanel anchor={anchor} current={current} onChoose={choose}
        onClose={() => { setAnchor(null); triggerRef.current?.focus(); }} />}
    </>
  );
}

function LanguageMenuPanel({ anchor, current, onChoose, onClose }: {
  anchor: DOMRect; current: Locale; onChoose: (next: Locale) => void; onClose: () => void;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  useBackToClose(true, onClose);
  useEffect(() => {
    ref.current?.showModal();
    ref.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
  }, []);

  // ボタンは画面の下の方にあるので、下に入らなければ上に開く。横はボタンの左端に揃え、画面からはみ出さない。
  const height = LOCALES.length * 40 + 12;
  const below = anchor.bottom + 4 + height <= window.innerHeight - 8;
  const style = {
    left: Math.max(8, Math.min(anchor.left, window.innerWidth - 236)),
    // 上に開くときは top を外す（モーダルの <dialog> は既定で top: 0 を持っていて、bottom だけでは効かない）。
    ...(below ? { top: anchor.bottom + 4 } : { top: "auto", bottom: Math.max(8, window.innerHeight - anchor.top + 4) }),
  };

  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
      : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  }

  return (
    <dialog ref={ref} aria-label={t("Language")} className="chat-actions-menu language-menu" style={style} translate="no"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const r = event.currentTarget.getBoundingClientRect();
        if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) onClose();
      }}>
      <div role="menu" onKeyDown={keyboard}>
        {LOCALES.map((option) => (
          <button key={option} type="button" role="menuitemradio" aria-checked={option === current} className="chat-menu-item"
            onClick={() => onChoose(option)}>
            <span lang={option} className="language-menu-name">{LOCALE_NAMES[option]}</span>
            <Check size={15} aria-hidden="true" className={`language-menu-check${option === current ? "" : " invisible"}`} />
          </button>
        ))}
      </div>
    </dialog>
  );
}
