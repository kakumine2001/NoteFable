"use client";

import { Settings } from "lucide-react";
import { signOut } from "next-auth/react";
import { useEffect, useRef, useState } from "react";
import { forgetLocaleChoice, useI18n } from "@/components/i18n-provider";
import { SignInButton } from "@/components/sign-in-dialog";
import { SettingsDialog } from "@/components/settings-dialog";
import { UserAvatar } from "@/components/user-avatar";
import { clearSaveError, saveProfile, settled, useAccount } from "@/lib/account-store";
import type { Locale } from "@/lib/i18n/locale";
import { msg } from "@/lib/i18n/translate";
import { localeSyncAction } from "@/lib/locale-sync";

// ログアウトを始めたら、消した言語の選択をアカウントの言語で書き戻さないように同期を止める（ページはこの後読み直される）。
let signingOut = false;
// ページを開いてから、アカウントの言語が分かった最初の判断を済ませたか。この端末で以前選んだ言語をアカウントへ
// 保存するのはその 1 回だけ（失敗しても繰り返し送らない）。migrated はそのとき保存しようとした言語。
let firstRunDone = false;
let migrated: Locale | null = null;

// 表示言語をアカウントに合わせる（規則は localeSyncAction）。ワークスペースに 1 つだけ置く。
// アカウントの状態が変わったときだけ動く。Cookie は他のタブとも共有なので、Cookie の変化では動かない
// （古い状態のままのタブが、他のタブでの選択やログアウトを書き戻さないように）。
export function AccountLocaleSync() {
  const { account } = useAccount();
  const { preference, locale, target, setPreference } = useI18n();
  // 判断のときに読む今の値（これらの変化では同期を動かさない）。
  const current = useRef({ preference, locale, target });
  useEffect(() => { current.current = { preference, locale, target }; }, [preference, locale, target]);
  const loaded = account !== null;
  const configured = account?.configured ?? false;
  const signedIn = Boolean(account?.user);
  const saved = account?.user ? account.user.locale : null;
  useEffect(() => {
    if (signingOut) return;
    const { preference, locale: active, target } = current.current;
    const known = loaded && configured && signedIn && saved !== undefined;
    const action = localeSyncAction({ loaded, configured, signedIn, saved, preference, active, target, firstRun: known && !firstRunDone, migrated });
    if (known) firstRunDone = true;
    if (action?.kind === "switch") setPreference(action.to);
    else if (action?.kind === "save") {
      migrated = action.locale;
      void saveProfile({ locale: action.locale });
    }
  }, [loaded, configured, signedIn, saved, setPreference]);
  return null;
}

// サイドバー下部のアカウント。ログイン前は「Sign in」（押すと Google / メールを選ぶ窓）、ログイン後は顔と名前と歯車の行で、
// 押すと設定画面（プロフィール・表示言語・カスタム指示・ログアウト）が開く。設定への入口はこの 1 つだけ。
// どのログインも未設定の環境では何も表示しない。状態はページ全体で 1 つ（account-store）。
export function AccountButton() {
  const { t, setPreference } = useI18n();
  const { account } = useAccount();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const user = account?.user ?? null;

  if (!account?.configured) return null;

  if (!user) {
    return (
      <SignInButton />
    );
  }

  const name = user.name ?? user.email ?? t("Account");

  // 失敗したときは理由の文を返す（設定画面に出す）。
  async function handleSignOut() {
    // 直前に編集した名前や写真の保存が終わってからログアウトする（ログアウト後だと 401 で取りこぼす）。
    await settled();
    // ログアウトした後は、選んでいた言語ではなく環境の言語で表示する。
    signingOut = true;
    forgetLocaleChoice();
    try {
      await signOut();
      return "";
    } catch {
      // ログアウトできなかった。消した言語の選択を元に戻す。
      signingOut = false;
      if (user?.locale) setPreference(user.locale);
      return msg("Could not sign out. Please try again.");
    }
  }

  return (
    <>
      <button type="button" className="notion-sidebar-action profile-row" title={user.email ?? undefined}
        aria-haspopup="dialog" aria-expanded={settingsOpen} aria-label={`${name} · ${t("Settings")}`}
        onClick={() => { clearSaveError(); setSettingsOpen(true); }}>
        <UserAvatar user={user} size={22} />
        <span className="truncate">{name}</span>
        <Settings size={15} className="ml-auto shrink-0 text-[var(--notion-faint)]" aria-hidden="true" />
      </button>
      {settingsOpen && <SettingsDialog user={user} onClose={() => setSettingsOpen(false)} onSignOut={handleSignOut} />}
    </>
  );
}
