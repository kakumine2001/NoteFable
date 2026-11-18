import type { Dictionary } from "@blocknote/core";
import { en } from "@blocknote/core/locales";
import type { Locale } from "@/lib/i18n/locale";

// Per-locale lazy loader following src/lib/i18n/messages/load.ts so opening a note
// only downloads the active language's BlockNote dictionary (~2-3 kB gz) instead of
// bundling all 17 dictionaries (~35 kB gz) into the editor chunk.
// English is already part of @blocknote/core, so it is cached synchronously with zero extra weight.
const cache = new Map<Locale, Dictionary>([["en", en]]);
const pending = new Map<Locale, Promise<Dictionary>>();

const LOADERS: Record<Locale, () => Promise<Dictionary>> = {
  en: async () => en,
  zh: async () => (await import("./blocknote-locales/zh")).dictionary,
  "zh-Hant": async () => (await import("./blocknote-locales/zh-hant")).dictionary,
  ja: async () => (await import("./blocknote-locales/ja")).dictionary,
  ko: async () => (await import("./blocknote-locales/ko")).dictionary,
  es: async () => (await import("./blocknote-locales/es")).dictionary,
  fr: async () => (await import("./blocknote-locales/fr")).dictionary,
  de: async () => (await import("./blocknote-locales/de")).dictionary,
  "pt-BR": async () => (await import("./blocknote-locales/pt-br")).dictionary,
  it: async () => (await import("./blocknote-locales/it")).dictionary,
  id: async () => (await import("./blocknote-locales/id")).dictionary,
  vi: async () => (await import("./blocknote-locales/vi")).dictionary,
  th: async () => (await import("./blocknote-locales/th")).dictionary,
  hi: async () => (await import("./blocknote-locales/hi")).dictionary,
  ar: async () => (await import("./blocknote-locales/ar")).dictionary,
  tr: async () => (await import("./blocknote-locales/tr")).dictionary,
  ru: async () => (await import("./blocknote-locales/ru")).dictionary,
};

export function cachedBlockNoteDictionary(locale: Locale): Dictionary | null {
  return cache.get(locale) ?? null;
}

export function fallbackBlockNoteDictionary(): Dictionary {
  return en;
}

export function loadBlockNoteDictionary(locale: Locale): Promise<Dictionary> {
  const hit = cache.get(locale);
  if (hit) return Promise.resolve(hit);
  let inflight = pending.get(locale);
  if (!inflight) {
    inflight = LOADERS[locale]()
      .then((dictionary) => {
        cache.set(locale, dictionary);
        pending.delete(locale);
        return dictionary;
      })
      .catch((error) => {
        pending.delete(locale);
        throw error;
      });
    pending.set(locale, inflight);
  }
  return inflight;
}
