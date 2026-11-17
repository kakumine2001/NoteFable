"use client";

import { AccountButton } from "@/components/account-button";
import { HelpMenu } from "@/components/help-menu";
import { useAccount } from "@/lib/account-store";

// サイドバーの一番下。アカウント（ログイン、または設定画面への入口）と、その右の「?」（紹介・規約類・未ログイン時の表示言語）。
// 表示言語: ログインしていなければ「?」のメニューで選ぶ（このブラウザに残る）。ログインした人は設定画面で選び、アカウントに保存する。
export function SidebarFooter() {
  const { account } = useAccount();
  // アカウントを読み終えてから言語の項目を出す（ログインした人に一瞬だけ見えないように）。
  const guest = account !== null && (!account.configured || !account.user);
  return (
    <div className="sidebar-footer">
      <div className="sidebar-footer-account"><AccountButton /></div>
      <HelpMenu guest={guest} />
    </div>
  );
}
