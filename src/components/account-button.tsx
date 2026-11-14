"use client";

import { ChevronsUpDown } from "lucide-react";
import { signOut } from "next-auth/react";
import { useRef, useState } from "react";
import { usePickerBackToClose } from "@/components/emoji-picker";
import { SignInButton } from "@/components/sign-in-dialog";
import { menuPositionFor, ProfileMenu, type MenuPosition } from "@/components/profile-menu";
import { UserAvatar } from "@/components/user-avatar";
import { clearSaveError, saveProfile, settled, uploadPhoto, useAccount } from "@/lib/account-store";
import { useT } from "@/components/i18n-provider";

// サイドバー下部のアカウント。ログイン前は「Sign in」（押すと Google / メールを選ぶ窓）、ログイン後は顔と名前の行で、押すとプロフィールが開く。
// どのログインも未設定の環境では何も表示しない。状態はページ全体で 1 つ（account-store）。
export function AccountButton() {
  const t = useT();
  const { account, saveError } = useAccount();
  const [menu, setMenu] = useState<MenuPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeMenu = () => setMenu(null);
  usePickerBackToClose(menu !== null, closeMenu);

  if (!account?.configured) return null;

  if (!account.user) {
    return (
      <SignInButton />
    );
  }

  const user = account.user;

  return (
    <>
      <button ref={triggerRef} type="button" className="notion-sidebar-action profile-row" title={user.email ?? undefined}
        aria-haspopup="dialog" aria-expanded={menu !== null}
        onClick={() => {
          if (menu) return closeMenu();
          clearSaveError();
          setMenu(menuPositionFor(triggerRef.current!.getBoundingClientRect()));
        }}>
        <UserAvatar user={user} size={22} />
        <span className="truncate">{user.name ?? user.email ?? t("Account")}</span>
        <ChevronsUpDown size={14} className="ml-auto shrink-0 text-[var(--notion-faint)]" />
      </button>
      {menu && (
        <ProfileMenu user={user} position={menu} trigger={triggerRef} error={saveError} onSave={saveProfile} onUpload={uploadPhoto} onClose={closeMenu}
          onSignOut={async () => {
            // 直前に編集した名前や写真の保存が終わってからログアウトする（ログアウト後だと 401 で取りこぼす）。
            await settled();
            await signOut();
          }} />
      )}
    </>
  );
}
