"use client";

import { Settings } from "lucide-react";
import { useState } from "react";
import { AccountButton } from "@/components/account-button";
import { useT } from "@/components/i18n-provider";
import { SettingsDialog } from "@/components/settings-dialog";
import { useAccount } from "@/lib/account-store";

// サイドバーの一番下。ログイン後はアカウント行（押すと設定画面が開く）のみ。
// 未ログイン時は右端に小さな歯車（設定：一般［言語・外観・アイコン］＋ヘルプ［紹介・規約類］）を置く。
export function SidebarFooter() {
  const t = useT();
  const { account } = useAccount();
  // 未ログイン時・アカウント読込中／読込失敗時も歯車を出し、言語・外観・ヘルプへ必ず届くようにする。
  const signedIn = Boolean(account?.user);
  const [settingsOpen, setSettingsOpen] = useState(false);

  if (signedIn && settingsOpen) setSettingsOpen(false);

  return (
    <div className="sidebar-footer">
      <div className="sidebar-footer-account"><AccountButton /></div>
      {!signedIn && <>
        <button type="button" className="sidebar-settings-trigger" aria-haspopup="dialog" aria-expanded={settingsOpen}
          aria-label={t("Settings")} title={t("Settings")} onClick={() => setSettingsOpen(true)}>
          <Settings size={17} aria-hidden="true" />
        </button>
        {settingsOpen && <SettingsDialog user={null} onClose={() => setSettingsOpen(false)} />}
      </>}
    </div>
  );
}
