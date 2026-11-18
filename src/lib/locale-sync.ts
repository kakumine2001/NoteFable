import type { Locale, LocalePreference } from "@/lib/i18n/locale";

// Account null is authoritative Auto, including on a new device. Old null rows
// already meant environment language, so no schema migration or sentinel is needed.
// An absent field is unknown and must never overwrite the account or local choice.
export type LocaleSyncInput = {
  loaded: boolean;
  configured: boolean;
  signedIn: boolean;
  saved: Locale | null | undefined;
  preference: LocalePreference;
  active: Locale;
  target: LocalePreference | null;
};
export type LocaleSyncAction = { kind: "switch"; to: LocalePreference } | null;
export function localeSyncAction({ loaded, configured, signedIn, saved, preference, active, target }: LocaleSyncInput): LocaleSyncAction {
  if (!loaded || !configured || !signedIn || saved === undefined) return null;
  const desired = saved ?? "auto";
  if (desired === "auto") return (target ?? preference) === "auto" ? null : { kind: "switch", to: "auto" };
  return preference === desired && (target ?? active) === desired ? null : { kind: "switch", to: desired };
}
