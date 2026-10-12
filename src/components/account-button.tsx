"use client";

import { LogIn, LogOut } from "lucide-react";
import { signIn, signOut } from "next-auth/react";
import { useEffect, useState } from "react";

type Account = { configured: boolean; user: { name: string | null; email: string | null } | null };

// サイドバー下部の Google ログイン / ログアウト。未設定の環境では何も表示しない。
export function AccountButton() {
  const [account, setAccount] = useState<Account | null>(null);

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

  if (!account.user) {
    return (
      <button type="button" className="notion-sidebar-action" onClick={() => signIn("google")}>
        <LogIn size={16} /><span>Sign in with Google</span>
      </button>
    );
  }

  return (
    <button type="button" className="notion-sidebar-action" title={account.user.email ?? undefined}
      onClick={() => signOut()}>
      <LogOut size={16} /><span>Sign out{account.user.name ? ` (${account.user.name})` : ""}</span>
    </button>
  );
}
