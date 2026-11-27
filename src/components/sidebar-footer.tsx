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
  // アカウントを読み終えるまで出さない（ログインした人に一瞬だけ歯車が見えないように）。
  const guest = account !== null && (!account.configured || !account.user);
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div className="sidebar-footer">
      <div className="sidebar-footer-account"><AccountButton /></div>
      {guest && <>
        <button type="button" className="sidebar-settings-trigger" aria-haspopup="dialog" aria-expanded={settingsOpen}
          aria-label={t("Settings")} title={t("Settings")} onClick={() => setSettingsOpen(true)}>
          <Settings size={17} aria-hidden="true" />
        </button>
        {settingsOpen && <SettingsDialog user={null} onClose={() => setSettingsOpen(false)} />}
      </>}
    </div>
  );
}
