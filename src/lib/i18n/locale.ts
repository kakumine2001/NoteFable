// Enable a language only when its Web and native dictionaries are ready. Names,
// tags, matching and country fallback all come from this registry.
export const LOCALE_DEFINITIONS = [
  { code: "en", name: "English", tag: "en", languages: ["en"], scripts: [], regions: [], countries: ["US", "GB", "AU", "NZ", "IE"] },
  { code: "zh", name: "简体中文", tag: "zh-CN", languages: ["zh"], scripts: ["Hans"], regions: ["CN", "SG"], countries: ["CN", "SG"] },
  { code: "zh-Hant", name: "繁體中文", tag: "zh-TW", languages: ["zh"], scripts: ["Hant"], regions: ["TW", "HK", "MO"], countries: ["TW", "HK", "MO"] },
  { code: "ja", name: "日本語", tag: "ja", languages: ["ja"], scripts: [], regions: [], countries: ["JP"] },
] as const;
export type Locale = (typeof LOCALE_DEFINITIONS)[number]["code"];
export const LOCALES: readonly Locale[] = LOCALE_DEFINITIONS.map(({ code }) => code);
export type LocalePreference = Locale | "auto";
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "notefable-locale";
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const LOCALE_NAMES = Object.fromEntries(LOCALE_DEFINITIONS.map(({ code, name }) => [code, name])) as Record<Locale, string>;
export const LOCALE_TAGS = Object.fromEntries(LOCALE_DEFINITIONS.map(({ code, tag }) => [code, tag])) as Record<Locale, string>;

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}
export function parsePreference(value: string | undefined | null): LocalePreference {
  return isLocale(value) ? value : "auto";
}

// Legacy ISO tags and Android's historical Indonesian tag. These aliases never
// enable an untranslated language; matching below only uses enabled definitions.
const LANGUAGE_ALIASES: Readonly<Record<string, string>> = { eng: "en", jpn: "ja", chi: "zh", zho: "zh", cmn: "zh", in: "id" };
export function localeFromTag(tag: string | null | undefined): Locale | null {
  if (!tag) return null;
  const normalized = tag.trim().replaceAll("_", "-");
  if (!/^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/i.test(normalized)) return null;
  const [primary, ...parts] = normalized.split("-");
  let parsed: Intl.Locale;
  try {
    parsed = new Intl.Locale([(Object.hasOwn(LANGUAGE_ALIASES, primary.toLowerCase()) ? LANGUAGE_ALIASES[primary.toLowerCase()] : primary), ...parts].join("-"));
  } catch { return null; }
  const candidates = LOCALE_DEFINITIONS.filter((entry) => (entry.languages as readonly string[]).includes(parsed.language));
  // Explicit script wins over region, e.g. zh-Hans-HK stays Simplified.
  return candidates.find((entry) => (entry.scripts as readonly string[]).includes(parsed.script ?? ""))?.code
    ?? candidates.find((entry) => (entry.regions as readonly string[]).includes(parsed.region ?? ""))?.code
    ?? candidates[0]?.code ?? null;
}

export function localeFromAcceptLanguage(header: string | null | undefined): Locale | null {
  const ranked = (header ?? "").split(",").map((part, index) => {
    const [tag, ...params] = part.trim().split(";");
    const weights = params.map((param) => param.trim()).filter((param) => /^q\s*=/i.test(param));
    const value = weights[0]?.slice(weights[0].indexOf("=") + 1).trim();
    // HTTP qvalue: at most three fractional digits; reject signs, exponents,
    // empty/duplicate weights and values above one instead of guessing.
    const valid = params.length === weights.length && weights.length <= 1
      && (value === undefined || /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(value));
    return { tag, weight: valid ? Number(value ?? 1) : 0, index };
  }).filter(({ weight }) => weight > 0).sort((a, b) => b.weight - a.weight || a.index - b.index);
  for (const { tag } of ranked) {
    const locale = localeFromTag(tag);
    if (locale) return locale;
  }
  return null;
}
export function localeFromCountry(country: string | null | undefined): Locale | null {
  const normalized = country?.trim().toUpperCase();
  return LOCALE_DEFINITIONS.find((entry) => (entry.countries as readonly string[]).includes(normalized ?? ""))?.code ?? null;
}
export function resolveLocale(input: { preference: LocalePreference; acceptLanguage?: string | null; country?: string | null }): Locale {
  if (input.preference !== "auto") return input.preference;
  return localeFromAcceptLanguage(input.acceptLanguage) ?? localeFromCountry(input.country) ?? DEFAULT_LOCALE;
}
