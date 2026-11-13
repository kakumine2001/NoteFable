import { I18nProvider } from "@/components/i18n-provider";
import { LOCALE_TAGS } from "@/lib/i18n/locale";
import { messagesFor } from "@/lib/i18n/messages";
import { getLocaleState } from "@/lib/i18n/server";

// 表示言語を切り替える画面（紹介ページと /app）だけがここで Cookie と要求ヘッダーを読む。
// ルートのレイアウトは読まないので、英語だけのプライバシーポリシーと利用規約は静的なまま配信できる。
// lang は中身の要素に付けてサーバー描画の時点から正しい字形で出し、<html lang> は I18nProvider が合わせる。
export default async function LocalizedLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const { locale, preference } = await getLocaleState();
  return (
    <div lang={LOCALE_TAGS[locale]} className="contents">
      <I18nProvider locale={locale} preference={preference} messages={messagesFor(locale)}>{children}</I18nProvider>
    </div>
  );
}
