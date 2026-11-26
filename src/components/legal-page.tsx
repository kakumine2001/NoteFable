import Link from "next/link";
import type { ReactNode } from "react";

export const LEGAL_CONTACT_EMAIL = "kakumine0824@gmail.com";
// 法的文書の最終更新日。どれかの本文を変えたらここを変える（英語の表記と特商法ページの日本語の表記はこれから作る）。
export const LEGAL_UPDATED_ISO = "2026-11-26";
const legalUpdatedDate = new Date(`${LEGAL_UPDATED_ISO}T00:00:00Z`);
export const LEGAL_UPDATED = legalUpdatedDate.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
export const LEGAL_UPDATED_JA = legalUpdatedDate.toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

// プライバシーポリシー・利用規約・特商法表記で共通の見た目。アプリ本体は body がスクロールしない作りなので、ここで自前のスクロール領域を持つ。
export function LegalPage({ title, lang = "en", updatedLabel = `Last updated: ${LEGAL_UPDATED}`, children }: { title: string; lang?: string; updatedLabel?: string; children: ReactNode }) {
  return (
    <main lang={lang} className="h-dvh overflow-y-auto bg-[var(--notion-bg)] text-[var(--notion-text)]" style={{ fontFamily: "var(--font-ui)" }}>
      <article className="mx-auto w-full max-w-[44rem] px-6 pb-24 pt-12 text-[15px] leading-7">
        <Link href="/" className="text-sm text-[var(--notion-muted)] hover:underline">← NoteFable</Link>
        <h1 className="mt-6 text-[2rem] font-bold leading-tight tracking-[-0.02em]">{title}</h1>
        <p className="mt-2 text-sm text-[var(--notion-muted)]">{updatedLabel}</p>
        <div className="mt-8 space-y-8">{children}</div>
        <nav lang="en" className="mt-14 flex flex-wrap gap-x-5 gap-y-2 border-t border-[var(--notion-border)] pt-5 text-sm text-[var(--notion-muted)]" aria-label="Legal">
          <Link href="/privacy" className="hover:underline">Privacy Policy</Link>
          <Link href="/terms" className="hover:underline">Terms of Service</Link>
          <Link href="/delete-account" className="hover:underline">Delete your account</Link>
          <Link href="/legal-notice" lang="ja" className="hover:underline">特定商取引法に基づく表記</Link>
        </nav>
      </article>
    </main>
  );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-xl font-semibold tracking-[-0.01em]">{title}</h2>
      <div className="mt-3 space-y-3 [&_a]:text-[var(--notion-blue)] [&_a]:underline [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-6">{children}</div>
    </section>
  );
}
