// 画面の表示言語。英語の文をそのままキーにし、中国語と日本語の辞書で引く（訳がなければ英語のまま出す）。
export const LOCALES = ["en", "zh", "ja"] as const;
export type Locale = (typeof LOCALES)[number];
// 利用者の選択。"auto" はブラウザの言語（なければ接続元の地域）から決める。
export type LocalePreference = Locale | "auto";

export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "studymate-locale";
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

// 設定画面で、その言語自身の書き方で出す名前。
export const LOCALE_NAMES: Record<Locale, string> = { en: "English", zh: "简体中文", ja: "日本語" };
// <html lang> と日付の書式に使う BCP 47 タグ。
export const LOCALE_TAGS: Record<Locale, string> = { en: "en", zh: "zh-CN", ja: "ja" };

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

export function parsePreference(value: string | undefined | null): LocalePreference {
  return isLocale(value) ? value : "auto";
}

// 言語タグ（zh-Hant-TW、ja-JP、en-GB など）を対応する言語に寄せる。
function localeFromTag(tag: string): Locale | null {
  const primary = tag.trim().toLowerCase().split(/[-_]/)[0];
  return isLocale(primary) ? primary : null;
}

// Accept-Language を q 値の高い順に見て、最初に対応している言語を返す。
export function localeFromAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  const ranked = header.split(",").map((part, index) => {
    const [tag, ...params] = part.trim().split(";");
    const q = params.map((param) => param.trim()).find((param) => param.startsWith("q="));
    const weight = q ? Number(q.slice(2)) : 1;
    return { tag, weight: Number.isFinite(weight) ? weight : 0, index };
  }).filter((entry) => entry.tag && entry.tag !== "*" && entry.weight > 0 && entry.weight <= 1)
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  for (const entry of ranked) {
    const locale = localeFromTag(entry.tag);
    if (locale) return locale;
  }
  return null;
}

// 接続元の国（Vercel の x-vercel-ip-country）。ブラウザの言語が対応外のときだけ使う。
const COUNTRY_LOCALES: Record<string, Locale> = { CN: "zh", TW: "zh", HK: "zh", MO: "zh", SG: "zh", JP: "ja" };

export function localeFromCountry(country: string | null | undefined): Locale | null {
  return country ? COUNTRY_LOCALES[country.trim().toUpperCase()] ?? null : null;
}

// 選択 > ブラウザの言語 > 接続元の地域 > 英語 の順に決める。
export function resolveLocale(input: { preference: LocalePreference; acceptLanguage?: string | null; country?: string | null }): Locale {
  if (input.preference !== "auto") return input.preference;
  return localeFromAcceptLanguage(input.acceptLanguage) ?? localeFromCountry(input.country) ?? DEFAULT_LOCALE;
}
