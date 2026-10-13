"use client";

import { LogIn, LogOut } from "lucide-react";
import { signIn, signOut } from "next-auth/react";
import { useEffect, useState } from "react";
import { canSignInNatively, signInWithNativeGoogle, signOutOfNativeGoogle } from "@/lib/native-app";

type Account = {
  configured: boolean;
  user: { name: string | null; email: string | null } | null;
  googleClientId?: string | null;
};

// サイドバー下部の Google ログイン / ログアウト。未設定の環境では何も表示しない。
export function AccountButton() {
  const [account, setAccount] = useState<Account | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/account")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: Account | null) => {
        if (active) setAccount(data);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  if (!account?.configured) return null;

  // Android アプリの WebView では Google が Web のログイン画面を拒否するので、端末側のログインを使う。
  async function signInNatively(webClientId: string) {
    setFailed(false);
    try {
      if (await signInWithNativeGoogle(webClientId)) window.location.reload();
    } catch {
      setFailed(true);
    }
  }

  if (!account.user) {
    const clientId = account.googleClientId;
    const native = Boolean(clientId) && canSignInNatively();
    return (
      <button type="button" className="notion-sidebar-action"
        onClick={() => (native && clientId ? signInNatively(clientId) : signIn("google"))}>
        <LogIn size={16} /><span>{failed ? "Sign-in failed. Try again" : "Sign in with Google"}</span>
      </button>
    );
  }

  return (
    <button type="button" className="notion-sidebar-action" title={account.user.email ?? undefined}
      onClick={async () => {
        await signOutOfNativeGoogle();
        await signOut();
      }}>
      <LogOut size={16} /><span>Sign out{account.user.name ? ` (${account.user.name})` : ""}</span>
    </button>
  );
}
