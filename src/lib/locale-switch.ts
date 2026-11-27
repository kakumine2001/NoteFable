import { isLocale, type Locale, type LocalePreference } from "@/lib/i18n/locale";
import { msg, type Messages } from "@/lib/i18n/translate";

type Dictionary = { locale: Locale; messages: Messages };

// Owns only language state. Workspace content stays mounted while dictionaries
// arrive, fail or get superseded. The same cancel path handles logout/unmount.
export function createLocaleSwitcher(state: {
  locale: Locale;
  pending: (target: LocalePreference | null) => void;
  error: (message: string, failedTarget?: LocalePreference | null) => void;
  commit: (preference: LocalePreference, dictionary?: Dictionary) => void;
}, load = async (next: LocalePreference, signal: AbortSignal): Promise<unknown> => {
  const response = await fetch(`/api/i18n?preference=${encodeURIComponent(next)}`, { cache: "no-store", signal });
  if (!response.ok) throw new Error("Language request failed");
  return response.json();
}) {
  let active: AbortController | null = null;
  let displayed = state.locale;
  function cancel() {
    active?.abort();
    active = null;
    state.pending(null);
  }
  async function choose(next: LocalePreference): Promise<boolean> {
    cancel();
    state.error("", null);
    const controller = new AbortController();
    active = controller;
    try {
      if (next !== "auto" && next === displayed) {
        state.commit(next);
        return true;
      }
      state.pending(next);
      const data = await load(next, controller.signal);
      if (controller.signal.aborted) return false;
      if (!data || typeof data !== "object" || !("locale" in data) || !isLocale(data.locale)
        || (next !== "auto" && data.locale !== next)
        || !("messages" in data) || !data.messages || typeof data.messages !== "object" || Array.isArray(data.messages)
        || Object.values(data.messages).some((value) => typeof value !== "string")) throw new Error("Invalid language response");
      state.commit(next, { locale: data.locale, messages: data.messages as Messages });
      displayed = data.locale;
      return true;
    } catch {
      if (!controller.signal.aborted) state.error(msg("Could not change language. Please try again."), next);
      return false;
    } finally {
      if (active === controller) {
        active = null;
        state.pending(null);
      }
    }
  }
  return { choose, cancel };
}
