"use client";

import { ChevronRight, CircleHelp, FileText, Info, Languages, Scale, Shield } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { LanguageMenuPanel, useLanguageChoice } from "@/components/language-menu";
import { useI18n } from "@/components/i18n-provider";
import { LOCALE_DIRS, LOCALE_NAMES, LOCALE_TAGS } from "@/lib/i18n/locale";
import { siteHref } from "@/lib/hosts";
import { msg } from "@/lib/i18n/translate";
import { INTRO_HREF } from "@/lib/i18n/routing";
import { afterSheetHistory, useBackToClose } from "@/lib/use-back-to-close";

// 紹介サイト（/?intro は回訪者でもワークスペースへ戻されない）と法律のページ。紹介サイトとワークスペースを別ホストにしたときは
// 紹介サイトのホストへの絶対 URL になる（src/lib/hosts.ts）。
// 開いたときのホストで決める（ワークスペースのホストなら紹介サイトへの絶対 URL）。
const links = () => [
  { href: siteHref(INTRO_HREF), label: msg("Visit website"), icon: Info },
  { href: siteHref("/privacy"), label: msg("Privacy"), icon: Shield },
  { href: siteHref("/terms"), label: msg("Terms"), icon: FileText },
  { href: siteHref("/legal-notice"), label: msg("Commercial disclosure"), icon: Scale },
] as const;

// サイドバー下部の「?」。紹介・プライバシー・利用規約・特商法表記（と、ログインしていなければ表示言語）をここにまとめ、
// 普段は小さなボタン 1 つだけを見せる（ChatGPT / Claude のヘルプメニューと同じ置き方）。ログインした人の言語は設定画面で選ぶ。
export function HelpMenu({ guest }: { guest: boolean }) {
  const { t, locale, preference } = useI18n();
  const router = useRouter();
  const language = useLanguageChoice();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState<null | { kind: "help" | "language"; anchor: DOMRect }>(null);
  const refocus = useRef(false);
  useEffect(() => {
    if (open || !refocus.current) return;
    refocus.current = false;
    triggerRef.current?.focus();
  }, [open]);
  const close = () => { refocus.current = true; setOpen(null); };

  return (
    <>
      <button ref={triggerRef} type="button" className="sidebar-help-trigger" aria-haspopup="menu" aria-expanded={open !== null}
        aria-label={t("Help")} title={t("Help")}
        onClick={(event) => setOpen(open ? null : { kind: "help", anchor: event.currentTarget.getBoundingClientRect() })}>
        <CircleHelp size={17} aria-hidden="true" />
      </button>
      {language.failed && <span role="alert" className="language-menu-error">{t(language.failed)}</span>}
      {open?.kind === "help" && (
        <HelpPanel anchor={open.anchor} items={links().length + (guest ? 1 : 0)} onClose={close}>
          {links().map(({ href, label, icon: Icon }) => (
            // メニューを閉じると履歴の目印を外す history.back() が走るので、それが済んでから移る（先に移ると戻されることがある）。
            // 新しいタブで開くなどの修飾付きクリックはブラウザに任せる。
            <Link key={href} href={href} role="menuitem" className="chat-menu-item" onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
              event.preventDefault();
              setOpen(null);
              // 閉じた後片付け（目印を外す予約）が走ってから待ち合わせる。
              // 別ホストへはアプリ内の遷移ではなく、普通のページ移動にする。
              const go = () => (/^https?:/.test(href) ? window.location.assign(href) : router.push(href));
              setTimeout(() => afterSheetHistory(go));
            }}>
              <Icon size={16} aria-hidden="true" className="help-menu-icon" />{t(label)}
            </Link>
          ))}
          {guest && <>
            <hr className="chat-menu-divider" />
            <button type="button" role="menuitem" className="chat-menu-item" aria-haspopup="dialog"
              onClick={() => setOpen({ kind: "language", anchor: open.anchor })}>
              <Languages size={16} aria-hidden="true" className="help-menu-icon" />
              <span className="flex-1">{t("Language")}</span>
              <span lang={LOCALE_TAGS[locale]} dir={preference === "auto" ? undefined : LOCALE_DIRS[locale]} className="help-menu-value">{preference === "auto" ? t("Auto (current: {language})", { language: LOCALE_NAMES[locale] }) : LOCALE_NAMES[locale]}</span>
              <ChevronRight size={15} aria-hidden="true" className="help-menu-icon rtl-mirror" />
            </button>
          </>}
        </HelpPanel>
      )}
      {open?.kind === "language" && (
        <LanguageMenuPanel anchor={open.anchor} current={language.current} align="end"
          onChoose={(next) => { close(); language.choose(next); }} onClose={close} />
      )}
    </>
  );
}

// ボタンの上（入らなければ下）に開く小さなメニュー。右端をボタンに揃える。
function HelpPanel({ anchor, items, onClose, children }: { anchor: DOMRect; items: number; onClose: () => void; children: React.ReactNode }) {
  const { t, dir } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  useBackToClose(true, onClose);
  useEffect(() => {
    ref.current?.showModal();
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, []);
  // 高さは項目がいちばん高いスマホの幅（.chat-menu-item 44px）と区切り線で見積もる。
  const height = items * 44 + 24;
  // ボタンは画面の一番下にあるので上に開く。上に入りきらない低い画面では上端（8px）から出し、
  // .chat-actions-menu の max-height（画面の高さ − 16px）を超える分はメニューの中でスクロールする。
  const above = anchor.top - 4 - height >= 8;
  const style = {
    left: Math.max(8, Math.min(dir === "rtl" ? anchor.left : anchor.right - 228, window.innerWidth - 236)),
    ...(above ? { top: "auto", bottom: window.innerHeight - anchor.top + 4 } : { top: 8 }),
  };

  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
      : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  }

  return (
    <dialog ref={ref} aria-label={t("Help")} className="chat-actions-menu help-menu" style={style}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const r = event.currentTarget.getBoundingClientRect();
        if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) onClose();
      }}>
      <div role="menu" onKeyDown={keyboard}>{children}</div>
    </dialog>
  );
}
