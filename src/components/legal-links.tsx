"use client";

import Link from "next/link";
import { useT } from "@/components/i18n-provider";

// アプリのナビゲーションは表示言語に合わせ、法的文書の本文とは独立して訳す。
export function LegalLinks() {
  const t = useT();
  return (
    <div className="flex shrink-0 gap-4 px-4 py-2.5 text-xs text-[var(--notion-muted)]">
      <Link href="/?intro" className="hover:text-[var(--notion-muted)] hover:underline">{t("About")}</Link>
      <Link href="/privacy" className="hover:text-[var(--notion-muted)] hover:underline">{t("Privacy")}</Link>
      <Link href="/terms" className="hover:text-[var(--notion-muted)] hover:underline">{t("Terms")}</Link>
    </div>
  );
}
