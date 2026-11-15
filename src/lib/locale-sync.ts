import type { Locale, LocalePreference } from "@/lib/i18n/locale";

// 表示言語をアカウントに合わせるための判断（画面の部品から切り離して試せるように）。
// - saved: アカウントに保存された言語。null は選んでいない、undefined はアカウントの行を読めなかった（分からない）。
// - preference: このブラウザの Cookie にある選択（"auto" は選択なし）。Cookie は他のタブとも共有。
// - active: このタブでいま表示している言語。target: 切り替え中ならその行き先（なければ null）。
// - firstRun: このページでアカウントの言語が分かってから最初の判断か。
// - migrated: このページで、以前この端末で選んだ言語をアカウントへ保存しようとした（その言語。なければ null）。
export type LocaleSyncInput = {
  loaded: boolean;
  configured: boolean;
  signedIn: boolean;
  saved: Locale | null | undefined;
  preference: LocalePreference;
  active: Locale;
  target: LocalePreference | null;
  firstRun: boolean;
  migrated: Locale | null;
};

export type LocaleSyncAction = { kind: "switch"; to: LocalePreference } | { kind: "save"; locale: Locale } | null;

export function localeSyncAction({ loaded, configured, signedIn, saved, preference, active, target, firstRun, migrated }: LocaleSyncInput): LocaleSyncAction {
  // アカウントを読めていない、またはログインが未設定の環境では何もしない。
  if (!loaded || !configured) return null;
  // ログインしていなければ環境の言語。以前この端末で選んだ言語が残っていれば消す。
  if (!signedIn) return preference === "auto" ? null : { kind: "switch", to: "auto" };
  // 保存された言語が分からないときは、Cookie で上書きしない。
  if (saved === undefined) return null;
  // 保存された言語に、Cookie とこのタブの表示の両方を合わせる（保存に失敗して元に戻ったときも、ここで表示が戻る）。
  if (saved) return preference === saved && (target ?? active) === saved ? null : { kind: "switch", to: saved };
  // このタブの選択（切り替え中ならその行き先）。
  const choice = target ?? preference;
  if (choice === "auto") return null;
  // 未保存で、この端末で以前選んだ言語があれば、ページを開いて最初の 1 回だけアカウントに保存する。
  if (firstRun) return { kind: "save", locale: choice };
  // その保存が失敗したときは、以前の選択のまま表示を続ける（勝手に送り直さない）。
  if (choice === migrated) return null;
  // 設定画面で初めて選んだ言語の保存が失敗した: 選ぶ前の環境の言語に戻す。
  return { kind: "switch", to: "auto" };
}
