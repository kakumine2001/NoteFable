"use client";

import { LoaderCircle, LogOut, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import "@/components/chat-project-settings.css";
import { AppIconSettings } from "@/components/app-icon-settings";
import { forgetLocaleChoice, useI18n } from "@/components/i18n-provider";
import { ProfileSettings } from "@/components/profile-settings";
import { saveProfile, settled, uploadPhoto, useAccount } from "@/lib/account-store";
import { LOCALES, LOCALE_NAMES, type Locale } from "@/lib/i18n/locale";
import { localizeSystemText, msg } from "@/lib/i18n/translate";
import { useBackToClose } from "@/lib/use-back-to-close";
import type { AccountUser } from "@/lib/user-profile";
import { INTRO_HREF } from "@/lib/i18n/routing";
import { MAX_CUSTOM_INSTRUCTIONS } from "@/types/chat";

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const data: unknown = await response.json().catch(() => null);
  return data && typeof data === "object" ? data as Record<string, unknown> : {};
}
const errorOf = (data: Record<string, unknown>, fallback: string) => typeof data.error === "string" && data.error ? data.error : fallback;

// 表示言語。「自動」は置かない。選ぶまでは環境の言語（ブラウザの言語・地域）のまま表示し、選んだらアカウントに保存する。
// 実際の切り替えはワークスペースの AccountLocaleSync（保存された言語に合わせる）が行うので、ここでは保存だけをする。
// 選ぶまでは、いま表示している言語に印を付ける。押せばその言語をアカウントに固定する。
// 矢印キーはフォーカスを動かすだけで、Enter / Space / クリックで選ぶ（1 つ動くたびに保存と切り替えが走らないように）。
function LanguageSettings({ user }: { user: AccountUser }) {
  const { t, locale, switching, changeError, setPreference } = useI18n();
  const labelId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const saved = user.locale ?? null;
  // 印を付ける言語: 選んだ言語。選んでいなければ（null）いま表示している環境の言語。アカウントを読めなかった（undefined）ときはどれも付けない。
  const checked = user.locale === undefined ? null : (saved ?? locale);
  // 矢印キーで最後にフォーカスした項目。
  const [focused, setFocused] = useState<Locale | null>(null);
  // Tab で入ったときにフォーカスする項目: 最後にフォーカスした項目、選んだ言語、いま表示している言語の順。
  const focusable = focused ?? saved ?? locale;

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const items = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("[role=radio]") ?? []);
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const forward = event.key === "ArrowDown" || event.key === "ArrowRight";
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
      : (current + (forward ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  }

  return (
    <section className="project-settings-section">
      <h3 id={labelId} className="project-settings-label">{t("Language")}</h3>
      <div ref={listRef} role="radiogroup" aria-labelledby={labelId} aria-busy={switching}
        className="settings-language-list" onKeyDown={onKeyDown}>
        {LOCALES.map((option) => (
          <button key={option} type="button" role="radio" aria-checked={checked === option} tabIndex={option === focusable ? 0 : -1} onFocus={() => setFocused(option)}
            className={`project-settings-option settings-language-option${checked === option ? " is-selected" : ""}`}
            // 保存だけ。表示の切り替えは AccountLocaleSync がアカウントの言語に合わせて行う。
            // 選んでいないときは印の付いた今の言語を押しても保存する（環境の言語をアカウントに固定する）。
            onClick={() => { if (option !== saved) saveProfile({ locale: option }); }}>
            <span className="settings-language-radio" aria-hidden="true" />
            <span lang={option} className="flex-1 text-left">{LOCALE_NAMES[option]}</span>
            {switching && saved === option && <LoaderCircle size={14} className="animate-spin text-[var(--notion-muted)]" aria-hidden="true" />}
          </button>
        ))}
      </div>
      <span className="sr-only" role="status">{switching ? t("Changing language…") : ""}</span>
      {changeError && <>
        <p role="alert" className="project-settings-error">{t(changeError)}</p>
        {saved && <button type="button" className="notion-button mt-2" onClick={() => setPreference(saved)}>{t("Try again")}</button>}
      </>}
    </section>
  );
}

// アカウントの完全削除（Google Play のアカウント削除要件）。押すとその場で確認を出し、もう一度押したら消す。
// 消えたらログインと端末の Cookie もサーバーが消すので、言語の選択を忘れてトップページから読み直す。
function DeleteAccount({ disabled, onBusyChange }: { disabled: boolean; onBusyChange: (busy: boolean) => void }) {
  const { t } = useI18n();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const warningId = useId();

  async function remove() {
    setDeleting(true); setError(""); onBusyChange(true);
    try {
      // 送信中・待ち行列の名前や言語の保存を先に終わらせる（削除の後に届くと、空のアカウントを作り直してしまう）。
      await settled();
      const response = await fetch("/api/account", { method: "DELETE" });
      const data = await readJson(response);
      if (!response.ok) throw new Error(errorOf(data, msg("Could not delete your account. Please try again.")));
      forgetLocaleChoice();
      window.location.replace(INTRO_HREF);
    } catch (reason) {
      setError(reason instanceof Error && reason.message ? reason.message : msg("Could not delete your account. Please try again."));
      setDeleting(false); onBusyChange(false);
    }
  }

  if (!confirming) {
    return <button type="button" className="settings-inline-action settings-danger-action" disabled={disabled} onClick={() => setConfirming(true)}>
      <Trash2 size={14} />{t("Delete account")}
    </button>;
  }
  return (
    <div className="settings-delete-confirm" role="group" aria-labelledby={warningId}>
      <p id={warningId}>{t("Permanently delete your account and everything in it: chats, notes, files and settings. This can’t be undone.")}</p>
      {error && <p role="alert" className="project-settings-error">{localizeSystemText(error, t)}</p>}
      <div className="settings-delete-actions">
        <button type="button" autoFocus className="notion-button" disabled={deleting} onClick={() => { setConfirming(false); setError(""); }}>{t("Cancel")}</button>
        <button type="button" className="notion-button notes-delete" disabled={deleting} onClick={() => void remove()}>
          {deleting ? t("Deleting…") : t("Delete permanently")}
        </button>
      </div>
    </div>
  );
}

// ログインした利用者の設定。プロフィール（顔・名前）・表示言語・カスタム指示・ログアウトを 1 か所にまとめる。
// プロフィールと言語は変えたその場で保存し、カスタム指示だけ「保存」で送る。見た目はプロジェクト設定のダイアログと同じ部品を使う。
// onSignOut は失敗したときに理由の文を返す（成功したらページが読み直される）。
export function SettingsDialog({ user, onSignOut, onClose }: { user: AccountUser; onSignOut: () => Promise<string>; onClose: () => void }) {
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
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  // 写真を切り抜き中・送信中。その間は「保存」「キャンセル」で閉じない（切り抜いた写真や失敗の知らせが消えないように）。
  const [photoBusy, setPhotoBusy] = useState(false);
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
    if (locked.current || photoBusy) return;
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
    // Esc は useBackToClose が受けて既定の動作を止めるので、ここに来るのはそれ以外の閉じる要求（Android Chrome の「戻る」など）。
    // それでもブラウザが閉じてしまった場合（続けて「戻る」を押したときなど）は、開いている状態を合わせる。
    onCancel={(event) => { event.preventDefault(); close(); }}
    onClose={() => onClose()}
    onClick={(event) => { if (event.target === event.currentTarget) { const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close(); } }}>
    <form className="project-settings-shell" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <div className="project-settings-header">
        <h2 id={titleId}>{t("Settings")}</h2>
      </div>
      <div className="project-settings-body">
        <section className="project-settings-section" aria-label={t("Profile")}>
          <ProfileSettings user={user} onSave={saveProfile} onUpload={uploadPhoto} closeGuardRef={profileGuard} onPhotoBusyChange={setPhotoBusy} />
        </section>
        {saveError && <p role="alert" className="project-settings-error">{localizeSystemText(saveError, t)}</p>}

        <LanguageSettings user={user} />

        <AppIconSettings />

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
          <button type="button" className="settings-inline-action" disabled={busy || signingOut || photoBusy}
            onClick={async () => {
              setSigningOut(true); setSignOutError("");
              const failure = await onSignOut();
              setSigningOut(false); setSignOutError(failure);
            }}><LogOut size={14} />{t("Sign out")}</button>
          {signOutError && <p role="alert" className="project-settings-error">{localizeSystemText(signOutError, t)}</p>}
          <DeleteAccount disabled={busy || signingOut || photoBusy} onBusyChange={(value) => { locked.current = value; }} />
        </section>
      </div>
      <div className="project-settings-footer">
        {/* 「キャンセル」は編集中の写真・絵文字の欄ごと閉じる（Esc・戻るのように 1 段ずつにはしない）。 */}
        <button type="button" disabled={busy || photoBusy} className="notion-button" onClick={() => { if (!locked.current) onClose(); }}>{t("Cancel")}</button>
        <button type="submit" disabled={busy || photoBusy || initial === null} className="notion-button notion-button-primary">{busy ? t("Saving…") : t("Save")}</button>
      </div>
    </form>
  </dialog>, document.body);
}
