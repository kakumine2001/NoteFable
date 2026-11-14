"use client";

import { ArrowLeft, X } from "lucide-react";
import { signIn } from "next-auth/react";
import { useEffect, useRef, useState } from "react";
import { GoogleLogo } from "@/components/google-logo";
import { useI18n, useT } from "@/components/i18n-provider";
import { localizeSystemText, msg } from "@/lib/i18n/translate";
import { useBackToClose } from "@/lib/use-back-to-close";
import { useAccount } from "@/lib/account-store";

// Google ログインを始める。登録窓の Google ボタンで使う。
export function useGoogleSignIn() {
  const [failed, setFailed] = useState(false);

  async function start() {
    setFailed(false);
    try {
      await signIn("google");
    } catch {
      setFailed(true);
    }
  }

  return { start, failed };
}

// 「ログイン」ボタン。押すとログイン方法を選ぶ窓が開く（主流のサービスと同じ: Google で続ける / メールで続ける）。
// onBeforeSignIn: ログインのためにページを離れる・読み直す直前に呼ぶ（送れなかった本文を預けるなど）。
export function SignInButton({ className = "", onBeforeSignIn }: { className?: string; onBeforeSignIn?: () => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={`signin-open-button ${className}`} onClick={() => setOpen(true)}>{t("Sign in")}</button>
      {open && <SignInDialog onClose={() => setOpen(false)} onBeforeSignIn={onBeforeSignIn} />}
    </>
  );
}

async function post(url: string, body: unknown): Promise<string | null> {
  try {
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (response.ok) return null;
    const data = (await response.json().catch(() => null)) as { error?: unknown } | null;
    return typeof data?.error === "string" ? data.error : msg("Something went wrong. Try again.");
  } catch {
    return msg("Check your connection and try again.");
  }
}

// ログインの窓。1 画面目: Google で続ける / （区切り「または」）/ メールアドレス → メールで続ける。
// 2 画面目: メールに届いた 6 桁のコードを入れる。使えない方法（未設定）は出さない。
export function SignInDialog({ onClose, onBeforeSignIn }: { onClose: () => void; onBeforeSignIn?: () => void }) {
  const t = useT();
  const { locale } = useI18n();
  const { account } = useAccount();
  const google = useGoogleSignIn();
  const ref = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState<"choose" | "code">("choose");
  const [email, setEmail] = useState("");
  // コードを送ったアドレス。送信中に入力欄を書き換えても、コードの画面と照合はこのアドレスで行う。
  const [sentTo, setSentTo] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const close = () => { if (!busy) onClose(); };
  useBackToClose(true, close);
  useEffect(() => { ref.current?.showModal(); }, []);

  const showGoogle = account?.google !== false;
  const showEmail = Boolean(account?.email);

  async function sendCode(again = false) {
    const address = again ? sentTo : email;
    setBusy(true); setError(""); setNotice("");
    const failed = await post("/api/auth/email/start", { email: address, locale });
    setBusy(false);
    if (failed) return setError(failed);
    setSentTo(address);
    setStep("code");
    setCode("");
    if (again) setNotice(msg("We sent a new code."));
  }

  async function verify() {
    setBusy(true); setError(""); setNotice("");
    const failed = await post("/api/auth/email/verify", { email: sentTo, code });
    if (failed) {
      setBusy(false);
      return setError(failed);
    }
    // Google ログインと同じく、ログイン後はページを読み直して新しいアカウントのデータで表示し直す。
    onBeforeSignIn?.();
    window.location.reload();
  }

  const feedback = <>
    {error && <p role="alert" className="signin-error">{localizeSystemText(error, t)}</p>}
    {notice && <p role="status" className="signin-notice">{t(notice)}</p>}
  </>;

  return (
    <dialog ref={ref} aria-label={t("Sign in")} className="notes-dialog signin-dialog"
      onCancel={(event) => { event.preventDefault(); close(); }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const r = event.currentTarget.getBoundingClientRect();
        if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close();
      }}>
      <button type="button" className="signin-close" onClick={close} aria-label={t("Close")} title={t("Close")}><X size={18} /></button>
      {step === "choose" ? (
        <>
          <h2 className="signin-title">{t("Sign in to StudyMate")}</h2>
          <p className="signin-subtitle">{t("Keep your chats and notes, and open them on any device.")}</p>
          {showGoogle && (
            <button type="button" className="google-signin-button signin-option" disabled={busy}
              onClick={() => { onBeforeSignIn?.(); void google.start(); }}>
              <GoogleLogo size={18} /><span>{google.failed ? t("Sign-in failed. Try again") : t("Continue with Google")}</span>
            </button>
          )}
          {showGoogle && showEmail && <div className="signin-divider" role="separator"><span>{t("or")}</span></div>}
          {showEmail && (
            <form onSubmit={(event) => { event.preventDefault(); void sendCode(); }}>
              <input type="email" inputMode="email" autoComplete="email" value={email} maxLength={254} readOnly={busy}
                onChange={(event) => setEmail(event.target.value)} placeholder={t("Email address")}
                className="notes-dialog-input signin-input" aria-label={t("Email address")} autoFocus={!showGoogle} />
              {feedback}
              <button type="submit" disabled={busy || !email.trim()} className="notion-button notion-button-primary signin-submit">
                {busy ? t("Sending…") : t("Continue with email")}
              </button>
              <p className="signin-hint">{t("We'll email you a 6-digit code. No password needed.")}</p>
            </form>
          )}
        </>
      ) : (
        <form onSubmit={(event) => { event.preventDefault(); void verify(); }}>
          <button type="button" className="signin-back" disabled={busy}
            onClick={() => { setStep("choose"); setError(""); setNotice(""); }}>
            <ArrowLeft size={16} /><span>{t("Back")}</span>
          </button>
          <h2 className="signin-title">{t("Check your email")}</h2>
          <p className="signin-subtitle break-words">{t("We sent a 6-digit code to {email}. It expires in 10 minutes.", { email: sentTo })}</p>
          <input autoFocus inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6} value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            className="notes-dialog-input signin-input signin-code" aria-label={t("6-digit code")} placeholder="000000" />
          {feedback}
          <button type="submit" disabled={busy || code.length !== 6} className="notion-button notion-button-primary signin-submit">
            {busy ? t("Signing in…") : t("Sign in")}
          </button>
          <p className="signin-hint">
            {t("Didn't get it?")}{" "}
            <button type="button" className="signin-link" disabled={busy} onClick={() => void sendCode(true)}>{t("Send a new code")}</button>
          </p>
        </form>
      )}
    </dialog>
  );
}
