"use client";

import { Sparkles, X } from "lucide-react";
import { useGoogleSignIn } from "@/components/account-button";
import { GoogleLogo } from "@/components/google-logo";
import { useT } from "@/components/i18n-provider";
import { useAccount } from "@/lib/account-store";
import { USAGE_LIMITS, type UsageKind } from "@/lib/usage-plans";

// 未ログインの利用者が 1 日の上限に達したとき、入力欄の上に出すログインの案内。
// Google ログインが使えない環境（未設定）や、すでにログイン済みなら何も出さない。
export function GuestLimitPrompt({ kind, onClose }: { kind: UsageKind; onClose: () => void }) {
  const t = useT();
  const { account } = useAccount();
  const { start, failed } = useGoogleSignIn(account);

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
          {t("Sign in with Google to get {chat} messages and {image} images a day, and find your chats on any device.", { chat: limits.chat, image: limits.image })}
        </p>
        <div className="guest-limit-actions">
          <button type="button" className="google-signin-button guest-limit-signin" onClick={() => void start()}>
            <GoogleLogo size={18} /><span>{failed ? t("Sign-in failed. Try again") : t("Sign in with Google")}</span>
          </button>
          <button type="button" className="guest-limit-later" onClick={onClose}>{t("Not now")}</button>
        </div>
      </div>
      <button type="button" className="guest-limit-close" onClick={onClose} aria-label={t("Close")} title={t("Close")}>
        <X size={16} />
      </button>
    </section>
  );
}
