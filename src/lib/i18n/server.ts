import { cookies, headers } from "next/headers";
import { LOCALE_COOKIE, parsePreference, resolveLocale, type Locale, type LocalePreference } from "@/lib/i18n/locale";

export async function getLocaleState(): Promise<{ locale: Locale; preference: LocalePreference }> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const preference = parsePreference(cookieStore.get(LOCALE_COOKIE)?.value);
  const locale = resolveLocale({
    preference,
    acceptLanguage: headerStore.get("accept-language"),
    country: headerStore.get("x-vercel-ip-country"),
  });
  return { locale, preference };
}

