import type { Metadata } from "next";
import { ThreadLanding } from "@/components/thread-landing";
import { isLocale, LOCALE_TAGS, LOCALES, type Locale } from "@/lib/i18n/locale";
import { messagesFor } from "@/lib/i18n/messages";
import { landingPath } from "@/lib/i18n/routing";
import { createTranslator, msg } from "@/lib/i18n/translate";
import "./landing.css";

const DESCRIPTION = msg("AI chat and notes in one place: ask a question, keep the answer as a note, and find it again later.");

// 検索エンジンに言語ごとの版を知らせる（hreflang と canonical）。/ は言語を決めていない人向けの版（x-default）。
// 絶対 URL の土台（metadataBase）は、Vercel では Next.js が本番の URL を自動で使う。
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale: value } = await params;
  const locale: Locale = isLocale(value) ? value : "en";
  const t = createTranslator(messagesFor(locale));
  // 英語は文の間を空け、中国語・日本語は詰める。
  const tagline = [t("Ask it."), t("Keep it."), t("Find it again.")].join(locale === "en" ? " " : "");
  return {
    title: `NoteFable — ${tagline}`,
    description: t(DESCRIPTION),
    alternates: {
      canonical: landingPath(locale),
      languages: {
        ...Object.fromEntries(LOCALES.map((option) => [LOCALE_TAGS[option], landingPath(option)])),
        "x-default": "/",
      },
    },
    openGraph: { locale: LOCALE_TAGS[locale].replace("-", "_") },
  };
}

// 古い会話・ノートのリンク（/?chat=… など）のワークスペースへの転送は src/proxy.ts が行う（このページは言語ごとの静的なページ）。
export default function Home() {
  return <ThreadLanding />;
}
