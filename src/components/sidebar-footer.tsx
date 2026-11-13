"use client";

import { AccountButton } from "@/components/account-button";
import { LegalLinks } from "@/components/legal-page";
import { LanguageSelect } from "@/components/language-select";

// サイドバーの一番下。表示言語、アカウント、プライバシー・利用規約へのリンク。
export function SidebarFooter() {
  return (
    <div className="shrink-0 border-t border-[var(--notion-border)]">
      <div className="px-2 pt-2"><LanguageSelect /></div>
      <div className="px-2 pt-2"><AccountButton /></div>
      <LegalLinks />
    </div>
  );
}
