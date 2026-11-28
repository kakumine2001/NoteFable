import type { Metadata } from "next";
import { StudioLanding } from "@/components/studio-landing";
import { isLocale, LOCALE_TAGS, LOCALES, type Locale } from "@/lib/i18n/locale";
import { landingTitle } from "@/lib/i18n/landing-meta";
import { messagesFor } from "@/lib/i18n/messages";
import { landingPath } from "@/lib/i18n/routing";
import { createTranslator, msg } from "@/lib/i18n/translate";
import "./landing.css";

const DESCRIPTION = msg("AI chat with notes, slides and whiteboards in one place: ask a question, keep the answer as a note in your Workspace, and find it all again later.");

// 検索エンジンに言語ごとの版を知らせる（hreflang と canonical）。/ は proxy が言語を選んで /{locale} の中身を出すので、
// その版の canonical（/{locale}）を指す重複として扱われる。x-default は付けない（canonical が別の URL を指す URL は無視されるため）。
// 絶対 URL の土台（metadataBase）はルートのレイアウトで siteOrigin() に設定している。
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale: value } = await params;
  const locale: Locale = isLocale(value) ? value : "en";
  const t = createTranslator(messagesFor(locale));
  return {
    title: landingTitle(),
    description: t(DESCRIPTION),
    alternates: {
      canonical: landingPath(locale),
      languages: Object.fromEntries(LOCALES.map((option) => [LOCALE_TAGS[option], landingPath(option)])),
    },
    openGraph: { locale: LOCALE_TAGS[locale].replace("-", "_") },
  };
}

// 古い会話・ノートのリンク（/?chat=… など）のワークスペースへの転送は src/proxy.ts が行う（このページは言語ごとの静的なページ）。
export default function Home() {
  return <StudioLanding />;
}
