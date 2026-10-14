import Link from "next/link";
import type { ReactNode } from "react";

export const LEGAL_CONTACT_EMAIL = "kakumine0824@gmail.com";
export const LEGAL_UPDATED = "October 14, 2026";

// プライバシーポリシーと利用規約で共通の見た目。アプリ本体は body がスクロールしない作りなので、ここで自前のスクロール領域を持つ。
export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="h-dvh overflow-y-auto bg-white text-[var(--notion-text)]" style={{ fontFamily: "var(--font-ui)" }}>
      <article className="mx-auto w-full max-w-[44rem] px-6 pb-24 pt-12 text-[15px] leading-7">
        <Link href="/" className="text-sm text-[var(--notion-muted)] hover:underline">← StudyMate</Link>
        <h1 className="mt-6 text-[2rem] font-bold leading-tight tracking-[-0.02em]">{title}</h1>
        <p className="mt-2 text-sm text-[var(--notion-muted)]">Last updated: {LEGAL_UPDATED}</p>
        <div className="mt-8 space-y-8">{children}</div>
        <nav className="mt-14 flex gap-5 border-t border-[var(--notion-border)] pt-5 text-sm text-[var(--notion-muted)]" aria-label="Legal">
          <Link href="/privacy" className="hover:underline">Privacy Policy</Link>
          <Link href="/terms" className="hover:underline">Terms of Service</Link>
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

// アプリのサイドバー下に置く小さなリンク。
export function LegalLinks() {
  return (
    <div className="flex shrink-0 gap-4 px-4 py-2.5 text-xs text-[var(--notion-muted)]">
      <Link href="/privacy" className="hover:text-[var(--notion-muted)] hover:underline">Privacy</Link>
      <Link href="/terms" className="hover:text-[var(--notion-muted)] hover:underline">Terms</Link>
    </div>
  );
}
