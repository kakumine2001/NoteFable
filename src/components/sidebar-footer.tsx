"use client";

import { AccountButton } from "@/components/account-button";
import { LanguageMenu } from "@/components/language-menu";
import { LegalLinks } from "@/components/legal-page";
import { useAccount } from "@/lib/account-store";

// サイドバーの一番下。アカウント（ログイン、または設定画面への入口）と、紹介・プライバシー・利用規約へのリンク。
// 表示言語: ログインしていなければリンクの行の言語メニューで選ぶ（このブラウザに残る）。ログインした人は設定画面で選び、アカウントに保存する。
export function SidebarFooter() {
  const { account } = useAccount();
  // アカウントを読み終えてから出す（ログインした人に一瞬だけ見えないように）。
  const guest = account !== null && (!account.configured || !account.user);
  return (
    <div className="shrink-0 border-t border-[var(--notion-border)]">
      <div className="px-2 pt-2"><AccountButton /></div>
      <LegalLinks>{guest && <LanguageMenu className="language-trigger" />}</LegalLinks>
    </div>
  );
}
