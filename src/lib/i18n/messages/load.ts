import type { Locale } from "@/lib/i18n/locale";
import type { Messages } from "@/lib/i18n/translate";

// Per-locale lazy loader for client-side fallbacks (such as global-error.tsx) so
// client bundles split each language into its own chunk instead of pulling all 17.
const LOADERS: Record<Locale, () => Promise<Messages>> = {
  en: async () => ({}),
  zh: async () => {
    const [{ zh }, { zhServer }] = await Promise.all([import("./zh"), import("./zh-server")]);
    return { ...zh, ...zhServer };
  },
  "zh-Hant": async () => (await import("./zh-hant")).zhHant,
  ja: async () => {
    const [{ ja }, { jaServer }] = await Promise.all([import("./ja"), import("./ja-server")]);
    return { ...ja, ...jaServer };
  },
  ko: async () => {
    const [{ ko }, { koServer }] = await Promise.all([import("./ko"), import("./ko-server")]);
    return { ...ko, ...koServer };
  },
  es: async () => {
    const [{ es }, { esServer }] = await Promise.all([import("./es"), import("./es-server")]);
    return { ...es, ...esServer };
  },
  fr: async () => {
    const [{ fr }, { frServer }] = await Promise.all([import("./fr"), import("./fr-server")]);
    return { ...fr, ...frServer };
  },
  de: async () => {
    const [{ de }, { deServer }] = await Promise.all([import("./de"), import("./de-server")]);
    return { ...de, ...deServer };
  },
  "pt-BR": async () => {
    const [{ ptBR }, { ptBRServer }] = await Promise.all([import("./pt-br"), import("./pt-br-server")]);
    return { ...ptBR, ...ptBRServer };
  },
  it: async () => {
    const [{ it }, { itServer }] = await Promise.all([import("./it"), import("./it-server")]);
    return { ...it, ...itServer };
  },
  id: async () => {
    const [{ id }, { idServer }] = await Promise.all([import("./id"), import("./id-server")]);
    return { ...id, ...idServer };
  },
  vi: async () => {
    const [{ vi }, { viServer }] = await Promise.all([import("./vi"), import("./vi-server")]);
    return { ...vi, ...viServer };
  },
  th: async () => {
    const [{ th }, { thServer }] = await Promise.all([import("./th"), import("./th-server")]);
    return { ...th, ...thServer };
  },
  hi: async () => {
    const [{ hi }, { hiServer }] = await Promise.all([import("./hi"), import("./hi-server")]);
    return { ...hi, ...hiServer };
  },
  ar: async () => {
    const [{ ar }, { arServer }] = await Promise.all([import("./ar"), import("./ar-server")]);
    return { ...ar, ...arServer };
  },
  tr: async () => {
    const [{ tr }, { trServer }] = await Promise.all([import("./tr"), import("./tr-server")]);
    return { ...tr, ...trServer };
  },
  ru: async () => {
    const [{ ru }, { ruServer }] = await Promise.all([import("./ru"), import("./ru-server")]);
    return { ...ru, ...ruServer };
  },
};

export function loadMessages(locale: Locale): Promise<Messages> {
  return LOADERS[locale]();
}
