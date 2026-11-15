"use client";

import { AccountButton } from "@/components/account-button";
import { LegalLinks } from "@/components/legal-page";

// サイドバーの一番下。アカウント（ログイン、または設定画面への入口）と、プライバシー・利用規約へのリンク。
// 表示言語はログインした利用者だけが設定画面で選ぶ。ログインしていなければ環境の言語で表示する。
export function SidebarFooter() {
  return (
    <div className="shrink-0 border-t border-[var(--notion-border)]">
      <div className="px-2 pt-2"><AccountButton /></div>
      <LegalLinks />
    </div>
  );
}
