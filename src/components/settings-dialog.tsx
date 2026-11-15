"use client";

import { LoaderCircle, LogOut } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "@/components/chat-project-settings.css";
import { useI18n } from "@/components/i18n-provider";
import { ProfileSettings } from "@/components/profile-settings";
import { saveProfile, uploadPhoto, useAccount } from "@/lib/account-store";
import { LOCALES, LOCALE_NAMES } from "@/lib/i18n/locale";
import { localizeSystemText, msg } from "@/lib/i18n/translate";
import { useBackToClose } from "@/lib/use-back-to-close";
import type { AccountUser } from "@/lib/user-profile";
import { MAX_CUSTOM_INSTRUCTIONS } from "@/types/chat";

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const data: unknown = await response.json().catch(() => null);
  return data && typeof data === "object" ? data as Record<string, unknown> : {};
}
const errorOf = (data: Record<string, unknown>, fallback: string) => typeof data.error === "string" && data.error ? data.error : fallback;

// 表示言語。「自動」は置かない。選ぶまでは環境の言語（ブラウザの言語・地域）のまま表示し、選んだらアカウントに保存する。
// 実際の切り替えは AccountButton の同期（保存された言語に合わせる）が行うので、ここでは保存だけをする。
function LanguageSettings({ user }: { user: AccountUser }) {
  const { t, locale, switching, changeError } = useI18n();
  const labelId = useId();
  const helpId = useId();
  const selected = user.locale ?? locale;
  return (
    <section className="project-settings-section">
      <h3 id={labelId} className="project-settings-label">{t("Language")}</h3>
      <p id={helpId} className="project-settings-help">{t("Until you choose a language, NoteFable uses your browser’s language.")}</p>
      <div role="radiogroup" aria-labelledby={labelId} aria-describedby={helpId} aria-busy={switching} className="settings-language-list">
        {LOCALES.map((option) => (
          <label key={option} className={`project-settings-option${selected === option ? " is-selected" : ""}${switching ? " is-disabled" : ""}`}>
            <input type="radio" name={labelId} value={option} checked={selected === option} disabled={switching}
              onChange={() => saveProfile({ locale: option })} />
            <span lang={option} className="flex-1">{LOCALE_NAMES[option]}</span>
            {switching && selected === option && <LoaderCircle size={14} className="animate-spin text-[var(--notion-muted)]" aria-hidden="true" />}
          </label>
        ))}
      </div>
      <span className="sr-only" role="status">{switching ? t("Changing language…") : ""}</span>
      {changeError && <p role="alert" className="project-settings-error">{t(changeError)}</p>}
    </section>
  );
}

// ログインした利用者の設定。プロフィール（顔・名前）・表示言語・カスタム指示・ログアウトを 1 か所にまとめる。
// プロフィールと言語は変えたその場で保存し、カスタム指示だけ「保存」で送る。見た目はプロジェクト設定のダイアログと同じ部品を使う。
export function SettingsDialog({ user, onSignOut, onClose }: { user: AccountUser; onSignOut: () => void; onClose: () => void }) {
  const { t } = useI18n();
  const { saveError } = useAccount();
  const ref = useRef<HTMLDialogElement>(null);
  const locked = useRef(false);
  const profileGuard = useRef(() => true);
  const titleId = useId();
  const helpId = useId();
  const [attempt, setAttempt] = useState(0);
  // 読み込んだ時点の指示（null は読み込み前）。変えていなければ保存を送らない。
  const [initial, setInitial] = useState<string | null>(null);
  const [loadError, setLoadError] = useState("");
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // 保存中は閉じない（Esc・戻る・外側のクリック）。閉じると、保存に失敗しても知らせる場所がなくなる。
  // 写真・絵文字の編集中は、まずその編集だけを閉じる。false を返すと useBackToClose は「戻る」の登録を保つ。
  const close = () => { if (locked.current || !profileGuard.current()) return false; onClose(); };
  useBackToClose(true, close);
  useEffect(() => { ref.current?.showModal(); }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/custom-instructions", { signal: controller.signal, cache: "no-store" }).then(async (response) => {
      const data = await readJson(response);
      if (!response.ok) throw new Error(errorOf(data, msg("Could not load your custom instructions.")));
      const text = typeof data.instructions === "string" ? data.instructions : "";
      setInitial(text);
      setInstructions(text);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setLoadError(reason instanceof Error && reason.message ? reason.message : msg("Could not load your custom instructions."));
    });
    return () => controller.abort();
  }, [attempt]);

  async function save() {
    if (locked.current) return;
    const text = instructions.trim();
    if (initial === null || text === initial) { onClose(); return; }
    locked.current = true; setBusy(true); setError("");
    try {
      const response = await fetch("/api/custom-instructions", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ instructions: text }) });
      const data = await readJson(response);
      if (!response.ok) throw new Error(errorOf(data, msg("Could not save your custom instructions. Please try again.")));
      onClose();
    } catch (reason) {
      setError(reason instanceof Error && reason.message ? reason.message : msg("Could not save your custom instructions. Please try again."));
    } finally { locked.current = false; setBusy(false); }
  }

  // サイドバーは幅によって隠れる（デスクトップ用と抽屉用の 2 つがある）ので、その外（body）に出す。
  return createPortal(<dialog ref={ref} aria-labelledby={titleId} className="notes-dialog chat-project-settings settings-dialog"
    onCancel={(event) => { event.preventDefault(); close(); }}
    onClick={(event) => { if (event.target === event.currentTarget) { const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close(); } }}>
    <form className="project-settings-shell" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <div className="project-settings-header">
        <h2 id={titleId}>{t("Settings")}</h2>
      </div>
      <div className="project-settings-body">
        <section className="project-settings-section" aria-label={t("Profile")}>
          <ProfileSettings user={user} onSave={saveProfile} onUpload={uploadPhoto} closeGuard={profileGuard} />
        </section>
        {saveError && <p role="alert" className="project-settings-error">{localizeSystemText(saveError, t)}</p>}

        <LanguageSettings user={user} />

        <section className="project-settings-section">
          <label htmlFor={`${titleId}-instructions`} className="project-settings-label">
            {t("Custom instructions")}
            {initial !== null && <span className="project-settings-count" aria-live="polite">{instructions.length}/{MAX_CUSTOM_INSTRUCTIONS}</span>}
          </label>
          <p id={helpId} className="project-settings-help">
            {t("Applied to all your chats from the next message. Tell NoteFable about yourself and how you want it to answer. A project’s instructions take priority inside that project.")}
          </p>
          {initial === null && !loadError && <p className="project-settings-empty" role="status"><LoaderCircle size={14} className="mr-1 inline animate-spin" aria-hidden="true" />{t("Loading…")}</p>}
          {loadError && <>
            <p role="alert" className="project-settings-error">{localizeSystemText(loadError, t)}</p>
            <button type="button" className="notion-button mt-2" onClick={() => { setLoadError(""); setAttempt((count) => count + 1); }}>{t("Try again")}</button>
          </>}
          {initial !== null && <textarea id={`${titleId}-instructions`} className="project-settings-textarea" value={instructions} disabled={busy}
            maxLength={MAX_CUSTOM_INSTRUCTIONS} aria-describedby={helpId}
            placeholder={t("Example: I’m preparing for the JLPT N1. Explain grammar with short examples, and keep answers brief.")}
            onChange={(event) => setInstructions(event.target.value)} />}
        </section>
        {error && <p role="alert" className="project-settings-error">{localizeSystemText(error, t)}</p>}

        <section className="project-settings-section settings-account">
          <button type="button" className="settings-inline-action" disabled={busy} onClick={onSignOut}><LogOut size={14} />{t("Sign out")}</button>
        </section>
      </div>
      <div className="project-settings-footer">
        <button type="button" disabled={busy} className="notion-button" onClick={() => close()}>{t("Cancel")}</button>
        <button type="submit" disabled={busy || initial === null} className="notion-button notion-button-primary">{busy ? t("Saving…") : t("Save")}</button>
      </div>
    </form>
  </dialog>, document.body);
}
