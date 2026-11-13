import { notFound } from "next/navigation";
import { I18nProvider } from "@/components/i18n-provider";
import { isLocale, LOCALES } from "@/lib/i18n/locale";
import { messagesFor } from "@/lib/i18n/messages";

// 紹介ページと /app を言語ごとに作り置く（静的）。どの言語のページを出すかは src/proxy.ts が要求ごとに決め、
// URL は / と /app のまま中身だけ差し替える。ここでは Cookie も要求ヘッダーも読まない。
// lang は中身の要素に付けてサーバー描画の時点から正しい字形で出し、<html lang> は I18nProvider が合わせる。
export const dynamicParams = false;

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export default async function LocalizedLayout({ children, params }: Readonly<{ children: React.ReactNode; params: Promise<{ locale: string }> }>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <I18nProvider locale={locale} messages={messagesFor(locale)}>{children}</I18nProvider>
  );
}
