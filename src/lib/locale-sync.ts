import type { Locale, LocalePreference } from "@/lib/i18n/locale";

// 表示言語をアカウントに合わせるための判断（画面の部品から切り離して試せるように）。
// - saved: アカウントに保存された言語。null は選んでいない、undefined はアカウントの行を読めなかった（分からない）。
// - preference: このブラウザの Cookie にある選択（"auto" は選択なし）。
export type LocaleSyncInput = {
  loaded: boolean;
  configured: boolean;
  signedIn: boolean;
  saved: Locale | null | undefined;
  preference: LocalePreference;
};

export type LocaleSyncAction = { kind: "switch"; to: LocalePreference } | { kind: "save"; locale: Locale } | null;

export function localeSyncAction({ loaded, configured, signedIn, saved, preference }: LocaleSyncInput): LocaleSyncAction {
  // アカウントを読めていない、またはログインが未設定の環境では何もしない。
  if (!loaded || !configured) return null;
  // ログインしていなければ環境の言語。以前この端末で選んだ言語が残っていれば消す。
  if (!signedIn) return preference === "auto" ? null : { kind: "switch", to: "auto" };
  // 保存された言語が分からないときは、Cookie で上書きしない。
  if (saved === undefined) return null;
  if (saved) return preference === saved ? null : { kind: "switch", to: saved };
  // 未保存で、この端末で以前選んだ言語があれば、それをアカウントに保存する。
  return preference === "auto" ? null : { kind: "save", locale: preference };
}
