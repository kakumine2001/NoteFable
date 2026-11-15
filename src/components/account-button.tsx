"use client";

import { Settings } from "lucide-react";
import { signOut } from "next-auth/react";
import { useEffect, useState } from "react";
import { forgetLocaleChoice, useI18n } from "@/components/i18n-provider";
import { SignInButton } from "@/components/sign-in-dialog";
import { SettingsDialog } from "@/components/settings-dialog";
import { UserAvatar } from "@/components/user-avatar";
import { clearSaveError, saveProfile, settled, useAccount, type Account } from "@/lib/account-store";

// 表示言語をアカウントに合わせる。言語を選べるのはログインした利用者だけ（設定画面）で、選んだ言語はアカウントに保存される。
// - ログインしていない: 環境の言語（ブラウザの言語・地域）で表示する。以前この端末で選んだ言語が残っていれば消す。
// - ログインしていて言語を保存している: その言語に切り替える（別の端末で選んだ言語もここで反映される）。
// - ログインしていて未保存: この端末で以前選んだ言語があれば、それをアカウントに保存する（保存後は上の規則で揃う）。
// アカウントの取得に失敗しているとき（account が null）や、ログインが未設定の環境では何もしない。
// ログアウトを始めたら、消した言語の選択をアカウントの言語で書き戻さないように同期を止める（ページはこの後読み直される）。
let signingOut = false;

function useAccountLocaleSync(account: Account | null) {
  const { preference, setPreference } = useI18n();
  const loaded = account !== null;
  const configured = account?.configured ?? false;
  const signedIn = Boolean(account?.user);
  const saved = account?.user?.locale ?? null;
  useEffect(() => {
    if (!loaded || !configured || signingOut) return;
    if (!signedIn) {
      if (preference !== "auto") setPreference("auto");
    } else if (saved) {
      if (preference !== saved) setPreference(saved);
    } else if (preference !== "auto") {
      saveProfile({ locale: preference });
    }
  }, [loaded, configured, signedIn, saved, preference, setPreference]);
}

// サイドバー下部のアカウント。ログイン前は「Sign in」（押すと Google / メールを選ぶ窓）、ログイン後は顔と名前と歯車の行で、
// 押すと設定画面（プロフィール・表示言語・カスタム指示・ログアウト）が開く。設定への入口はこの 1 つだけ。
// どのログインも未設定の環境では何も表示しない。状態はページ全体で 1 つ（account-store）。
export function AccountButton() {
  const { t } = useI18n();
  const { account } = useAccount();
  const [settingsOpen, setSettingsOpen] = useState(false);
  useAccountLocaleSync(account);
  const user = account?.user ?? null;

  if (!account?.configured) return null;

  if (!user) {
    return (
      <SignInButton />
    );
  }

  const name = user.name ?? user.email ?? t("Account");

  return (
    <>
      <button type="button" className="notion-sidebar-action profile-row" title={user.email ?? undefined}
        aria-haspopup="dialog" aria-expanded={settingsOpen} aria-label={`${name} · ${t("Settings")}`}
        onClick={() => { clearSaveError(); setSettingsOpen(true); }}>
        <UserAvatar user={user} size={22} />
        <span className="truncate">{name}</span>
        <Settings size={15} className="ml-auto shrink-0 text-[var(--notion-faint)]" aria-hidden="true" />
      </button>
      {settingsOpen && (
        <SettingsDialog user={user} onClose={() => setSettingsOpen(false)}
          onSignOut={async () => {
            // 直前に編集した名前や写真の保存が終わってからログアウトする（ログアウト後だと 401 で取りこぼす）。
            await settled();
            // ログアウトした後は、選んでいた言語ではなく環境の言語で表示する。
            signingOut = true;
            forgetLocaleChoice();
            try {
              await signOut();
            } catch {
              signingOut = false;
            }
          }} />
      )}
    </>
  );
}
