"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { INTRO_HREF } from "@/lib/i18n/routing";
import { useT } from "@/components/i18n-provider";

// アプリのナビゲーションは表示言語に合わせ、法的文書の本文とは独立して訳す。children は行の右端に置く（言語メニュー）。
export function LegalLinks({ children }: { children?: ReactNode }) {
  const t = useT();
  return (
    <div className="flex shrink-0 flex-wrap gap-x-4 gap-y-1 px-4 py-2.5 text-xs text-[var(--notion-muted)]">
      <Link href={INTRO_HREF} className="hover:text-[var(--notion-muted)] hover:underline">{t("About")}</Link>
      <Link href="/privacy" className="hover:text-[var(--notion-muted)] hover:underline">{t("Privacy")}</Link>
      <Link href="/terms" className="hover:text-[var(--notion-muted)] hover:underline">{t("Terms")}</Link>
      <Link href="/legal-notice" className="hover:text-[var(--notion-muted)] hover:underline">{t("Commercial disclosure")}</Link>
      {children}
    </div>
  );
}
