"use client";

import { CreditCard, LoaderCircle, Sparkles } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useI18n } from "@/components/i18n-provider";
import { goToBilling, loadPlan, type PlanInfo } from "@/lib/billing-client";
import { localizeSystemText, msg } from "@/lib/i18n/translate";
import { USAGE_LIMITS } from "@/lib/usage-plans";

// 設定画面の「プラン」。いまのプランとこの期間の使用量、申し込み（無料）か購読の管理（PRO）のボタンを出す。
export function PlanSettings() {
  const { t, tag } = useI18n();
  const labelId = useId();
  const [plan, setPlan] = useState<PlanInfo | null>(null);
  const [loadError, setLoadError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    loadPlan({ signal: controller.signal }).then(setPlan).catch((reason: unknown) => {
      if (!controller.signal.aborted) setLoadError(reason instanceof Error && reason.message ? reason.message : msg("Could not load your plan."));
    });
    return () => controller.abort();
  }, [attempt]);

  async function open(kind: "checkout" | "portal") {
    setBusy(true); setError("");
    try {
      await goToBilling(kind);
    } catch (reason) {
      setError(reason instanceof Error && reason.message ? reason.message : msg("Something went wrong. Please try again."));
      setBusy(false);
    }
  }

  const date = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleDateString(tag, { year: "numeric", month: "short", day: "numeric" }) : "";
  const pro = plan?.plan === "pro";
  const subscription = plan?.subscription;

  return (
    <section className="project-settings-section settings-plan" aria-labelledby={labelId}>
      <h3 id={labelId} className="project-settings-label">
        {t("Plan")}
        {plan && <span className={`settings-plan-badge${pro ? " is-pro" : ""}`}>{pro ? t("Pro") : t("Free")}</span>}
      </h3>
      {!plan && !loadError && <p className="project-settings-empty" role="status"><LoaderCircle size={14} className="mr-1 inline animate-spin" aria-hidden="true" />{t("Loading…")}</p>}
      {loadError && <>
        <p role="alert" className="project-settings-error">{localizeSystemText(loadError, t)}</p>
        <button type="button" className="notion-button mt-2" onClick={() => { setLoadError(""); setAttempt((count) => count + 1); }}>{t("Try again")}</button>
      </>}
      {plan && <>
        {pro && subscription && (subscription.status === "past_due" || subscription.cancelAt || subscription.periodEnd) && (
          <p className="project-settings-help">
            {subscription.status === "past_due"
              ? t("Your last payment failed. Update your payment method to keep Pro.")
              : subscription.cancelAt
                ? t("Pro ends on {date}.", { date: date(subscription.cancelAt) })
                : t("Renews on {date}.", { date: date(subscription.periodEnd) })}
          </p>
        )}
        <dl className="settings-plan-usage">
          {(["chat", "image"] as const).map((kind) => {
            const entry = plan.usage[kind];
            const label = kind === "chat"
              ? (entry.period === "day" ? t("Messages today") : pro ? t("Messages this period") : t("Messages this month"))
              : (entry.period === "day" ? t("Images today") : pro ? t("Images this period") : t("Images this month"));
            const ratio = entry.limit ? Math.min(1, entry.used / entry.limit) : 1;
            return (
              <div key={kind} className="settings-plan-meter">
                <dt>{label}</dt>
                <dd><span className="settings-plan-count">{entry.used} / {entry.limit}</span></dd>
                <span className={`settings-plan-bar${ratio >= 1 ? " is-full" : ""}`} aria-hidden="true"><span style={{ width: `${ratio * 100}%` }} /></span>
              </div>
            );
          })}
        </dl>
        {!pro && plan.billing && (
          <div className="settings-plan-offer">
            <p className="settings-plan-offer-title"><Sparkles size={15} aria-hidden="true" />{t("NoteFable Pro · ¥{price}/month", { price: plan.priceJpy })}</p>
            <p className="project-settings-help">{t("{chat} messages and {image} images a month. Cancel anytime.", { chat: USAGE_LIMITS.pro.chat.toLocaleString(tag), image: USAGE_LIMITS.pro.image })}</p>
            <button type="button" className="signin-open-button settings-plan-upgrade" disabled={busy} onClick={() => void open("checkout")}>
              {busy ? t("Opening…") : t("Upgrade to Pro")}
            </button>
          </div>
        )}
        {plan.manageUrl && (
          <a className="settings-inline-action" href={plan.manageUrl} target="_blank" rel="noreferrer">
            <CreditCard size={14} />{t("Manage subscription on Google Play")}
          </a>
        )}
        {plan.canManage && (pro || subscription) && (
          <button type="button" className="settings-inline-action" disabled={busy} onClick={() => void open("portal")}>
            <CreditCard size={14} />{busy && pro ? t("Opening…") : t("Manage subscription")}
          </button>
        )}
        {error && <p role="alert" className="project-settings-error">{localizeSystemText(error, t)}</p>}
      </>}
    </section>
  );
}
