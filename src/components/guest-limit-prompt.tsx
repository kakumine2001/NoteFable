"use client";

import { Sparkles, X } from "lucide-react";
import { SignInButton } from "@/components/sign-in-dialog";
import { useT } from "@/components/i18n-provider";
import { useAccount } from "@/lib/account-store";
import { USAGE_LIMITS, type UsageKind } from "@/lib/usage-plans";

// 未ログインの利用者が 1 日の上限に達したとき、入力欄の上に出すログインの案内。
// どのログインも使えない環境（未設定）や、すでにログイン済みなら何も出さない。
// onBeforeSignIn: ログイン画面へ移る直前に、送れなかった本文を預ける。attachmentsLost: 預けられない添付があるとき注意を出す。
export function GuestLimitPrompt({ kind, onClose, onBeforeSignIn, attachmentsLost = false }: {
  kind: UsageKind;
  onClose: () => void;
  onBeforeSignIn?: () => void;
  attachmentsLost?: boolean;
}) {
  const t = useT();
  const { account } = useAccount();

  if (!account?.configured || account.user) return null;

  const limits = USAGE_LIMITS.member;
  return (
    <section className="guest-limit-prompt notion-page-column mb-3" role="status" aria-live="polite">
      <span className="guest-limit-icon" aria-hidden="true"><Sparkles size={18} strokeWidth={2.1} /></span>
      <div className="min-w-0 flex-1">
        <p className="guest-limit-title">
          {kind === "image" ? t("You've used today's free image generations") : t("You've used today's free messages")}
        </p>
        <p className="guest-limit-body">
          {t("Sign in to get {chat} messages and {image} images a day, and find your chats on any device.", { chat: limits.chat, image: limits.image })}
        </p>
        {attachmentsLost && <p className="guest-limit-body">{t("Attachments aren't kept when you sign in. Add them again afterward.")}</p>}
        <div className="guest-limit-actions">
          <SignInButton className="guest-limit-signin" onBeforeSignIn={onBeforeSignIn} />
          <button type="button" className="guest-limit-later" onClick={onClose}>{t("Not now")}</button>
        </div>
      </div>
      <button type="button" className="guest-limit-close" onClick={onClose} aria-label={t("Close")} title={t("Close")}>
        <X size={16} />
      </button>
    </section>
  );
}
