"use client";

import { HardDrive, X } from "lucide-react";
import { useEffect, useState } from "react";
import { AppIcon } from "@/components/app-icon";
import { SignInButton } from "@/components/sign-in-dialog";
import { useI18n, useT } from "@/components/i18n-provider";
import { useAccount } from "@/lib/account-store";
import { goToBilling, loadPlan } from "@/lib/billing-client";
import { localizeSystemText, msg } from "@/lib/i18n/translate";
import { PRO_PRICE_JPY, STORAGE_LIMITS, USAGE_LIMITS, formatStorageSize, type UsageKind, type UsageTier } from "@/lib/usage-plans";

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
      <span className="guest-limit-icon is-mascot" aria-hidden="true"><AppIcon size={22} /></span>
      <div className="min-w-0 flex-1">
        <p className="guest-limit-title">
          {kind === "image" ? t("You've used your free images") : t("You've used today's free messages")}
        </p>
        <p className="guest-limit-body">
          {t("Sign in to get {chat} messages a day and {image} images a month, and find your chats on any device.", { chat: limits.chat, image: limits.image })}
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

// ログイン済みの無料の利用者が上限に達したとき、入力欄の上に出す有料プランの案内。
// 申し込みが使えない（Stripe 未設定）か、ログインしていなければ何も出さない。
// onBeforeUpgrade: 決済画面へ移る直前に、送れなかった本文を預ける（戻ってきたら入力欄に戻す）。
// attachmentsLost: 決済画面へ移るとページを離れるので、添付は戻らない。そのときは注意を出す。
export function UpgradePrompt({ kind, onClose, onBeforeUpgrade, attachmentsLost = false }: {
  kind: UsageKind;
  onClose: () => void;
  onBeforeUpgrade?: () => void;
  attachmentsLost?: boolean;
}) {
  const { t, tag } = useI18n();
  const { account } = useAccount();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!account?.billing || !account.user) return null;

  async function upgrade() {
    setBusy(true); setError("");
    onBeforeUpgrade?.();
    try {
      await goToBilling("checkout");
    } catch (reason) {
      setError(reason instanceof Error && reason.message ? reason.message : msg("Could not open the payment page. Please try again."));
      setBusy(false);
    }
  }

  const limits = USAGE_LIMITS.pro;
  const trialDays = account.trialDays ?? 0;
  return (
    <section className="guest-limit-prompt notion-page-column mb-3" role="status" aria-live="polite">
      <span className="guest-limit-icon is-mascot" aria-hidden="true"><AppIcon size={22} /></span>
      <div className="min-w-0 flex-1">
        <p className="guest-limit-title">
          {kind === "image" ? t("You've used your free images") : t("You've used today's free messages")}
        </p>
        <p className="guest-limit-body">
          {t("Get {chat} messages and {image} images a month with Pro for ¥{price}/month.", { chat: limits.chat.toLocaleString(tag), image: limits.image, price: PRO_PRICE_JPY })}
        </p>
        {trialDays > 0 && <p className="guest-limit-body">{t("Free for {days} days, then ¥{price}/month. Cancel before the trial ends and you won't be charged.", { days: trialDays, price: PRO_PRICE_JPY })}</p>}
        {attachmentsLost && <p className="guest-limit-body">{t("Attachments aren't kept when you go to the payment page. Add them again afterward.")}</p>}
        {error && <p role="alert" className="guest-limit-body guest-limit-error">{localizeSystemText(error, t)}</p>}
        <div className="guest-limit-actions">
          <button type="button" className="signin-open-button guest-limit-signin" disabled={busy} onClick={() => void upgrade()}>
            {busy ? t("Opening…") : trialDays > 0 ? t("Start {days}-day free trial", { days: trialDays }) : t("Upgrade to Pro")}
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

// ファイル置き場の容量が足りず、アップロード（または画像の生成）が断られたときの案内。どの段階でも理由と使用量を出し、
// 未ログインならログイン、ログイン済みの無料ならアップグレード（申し込みが使えるとき）を勧める。Pro は不要なファイルを消すよう伝える。
// actions: false はログイン・アップグレードのボタンを出さない（アプリに埋め込んだノートの編集画面。ログインや購入はアプリ側で行う）。
export function StorageLimitPrompt({ limit, onClose, onBeforeSignIn, onBeforeUpgrade, attachmentsLost = false, actions = true, className = "notion-page-column mb-3" }: {
  limit: { tier: UsageTier; used: number; limit: number };
  onClose: () => void;
  onBeforeSignIn?: () => void;
  onBeforeUpgrade?: () => void;
  attachmentsLost?: boolean;
  actions?: boolean;
  className?: string;
}) {
  const { t, tag } = useI18n();
  const { account } = useAccount();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // 案内を出した後にログイン・ログアウトしたら、別の人（別の上限）の話なので出さない。
  if (account && (limit.tier === "guest") === Boolean(account.user)) return null;
  const canSignIn = actions && limit.tier === "guest" && Boolean(account?.configured) && !account?.user;
  const canUpgrade = actions && limit.tier === "member" && Boolean(account?.billing) && Boolean(account?.user);
  const trialDays = account?.trialDays ?? 0;

  async function startUpgrade() {
    setBusy(true); setError("");
    onBeforeUpgrade?.();
    try {
      await goToBilling("checkout");
    } catch (reason) {
      setError(reason instanceof Error && reason.message ? reason.message : msg("Could not open the payment page. Please try again."));
      setBusy(false);
    }
  }

  return (
    <section className={`guest-limit-prompt ${className}`} role="status" aria-live="polite">
      <span className="guest-limit-icon" aria-hidden="true"><HardDrive size={18} strokeWidth={2.1} /></span>
      <div className="min-w-0 flex-1">
        <p className="guest-limit-title">{t("Not enough storage space")}</p>
        <p className="guest-limit-body">{t("You've used {used} of {limit}.", { used: formatStorageSize(limit.used, tag), limit: formatStorageSize(limit.limit, tag) })}</p>
        {canSignIn && <p className="guest-limit-body">{t("Sign in to get {storage} of storage.", { storage: formatStorageSize(STORAGE_LIMITS.member, tag) })}</p>}
        {canUpgrade && <p className="guest-limit-body">{t("Get {storage} of storage with Pro for ¥{price}/month.", { storage: formatStorageSize(STORAGE_LIMITS.pro, tag), price: PRO_PRICE_JPY })}</p>}
        {canUpgrade && trialDays > 0 && <p className="guest-limit-body">{t("Free for {days} days, then ¥{price}/month. Cancel before the trial ends and you won't be charged.", { days: trialDays, price: PRO_PRICE_JPY })}</p>}
        <p className="guest-limit-body">{t("Delete files you no longer need to free up space.")}</p>
        {attachmentsLost && canSignIn && <p className="guest-limit-body">{t("Attachments aren't kept when you sign in. Add them again afterward.")}</p>}
        {attachmentsLost && canUpgrade && <p className="guest-limit-body">{t("Attachments aren't kept when you go to the payment page. Add them again afterward.")}</p>}
        {error && <p role="alert" className="guest-limit-body guest-limit-error">{localizeSystemText(error, t)}</p>}
        {(canSignIn || canUpgrade) && (
          <div className="guest-limit-actions">
            {canSignIn && <SignInButton className="guest-limit-signin" onBeforeSignIn={onBeforeSignIn} />}
            {canUpgrade && (
              <button type="button" className="signin-open-button guest-limit-signin" disabled={busy} onClick={() => void startUpgrade()}>
                {busy ? t("Opening…") : trialDays > 0 ? t("Start {days}-day free trial", { days: trialDays }) : t("Upgrade to Pro")}
              </button>
            )}
            <button type="button" className="guest-limit-later" onClick={onClose}>{t("Not now")}</button>
          </div>
        )}
      </div>
      <button type="button" className="guest-limit-close" onClick={onClose} aria-label={t("Close")} title={t("Close")}>
        <X size={16} />
      </button>
    </section>
  );
}

// Stripe の画面から /app?billing=… で戻ってきたときの知らせ。申し込みが済んだら、Webhook を待たずにプランを取り直して出す。
// 表示したら地址から billing を消す（再読み込みで何度も出さない）。
export function BillingReturnNotice() {
  const { t, tag } = useI18n();
  const [state, setState] = useState<"none" | "checking" | "pro" | "pending">("none");

  useEffect(() => {
    // 開発時の StrictMode は effect を 2 回走らせる。1 回目の片付けで取り消されたら何もしない（地址の billing を消すのは本番の 1 回だけ）。
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      const url = new URL(window.location.href);
      const result = url.searchParams.get("billing");
      if (!result) return;
      url.searchParams.delete("billing");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
      if (result !== "success") return;
      setState("checking");
      loadPlan({ refresh: true })
        .then((plan) => setState(plan.plan === "pro" ? "pro" : "pending"))
        .catch(() => setState("pending"));
    });
    return () => { cancelled = true; };
  }, []);

  if (state === "none" || state === "checking") return null;
  const limits = USAGE_LIMITS.pro;
  return (
    <section className="guest-limit-prompt notion-page-column mb-3" role="status" aria-live="polite">
      <span className="guest-limit-icon is-mascot" aria-hidden="true"><AppIcon size={22} /></span>
      <div className="min-w-0 flex-1">
        <p className="guest-limit-title">{state === "pro" ? t("Welcome to NoteFable Pro") : t("Thanks for subscribing")}</p>
        <p className="guest-limit-body">
          {state === "pro"
            ? t("You now have {chat} messages and {image} images a month.", { chat: limits.chat.toLocaleString(tag), image: limits.image })
            : t("Your payment is being confirmed. Pro will turn on in a moment.")}
        </p>
      </div>
      <button type="button" className="guest-limit-close" onClick={() => setState("none")} aria-label={t("Close")} title={t("Close")}>
        <X size={16} />
      </button>
    </section>
  );
}
