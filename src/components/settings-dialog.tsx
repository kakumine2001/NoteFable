"use client";

import { ArrowLeft, Check, ChevronRight, ChevronsUpDown, CircleUser, CreditCard, LoaderCircle, LogOut, PenLine, SlidersHorizontal, Trash2, X, type LucideIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "@/components/chat-project-settings.css";
import "@/components/settings-dialog.css";
import { AppIconSettings } from "@/components/app-icon-settings";
import { LanguageMenuPanel, useLanguageMenuAnchor } from "@/components/language-menu";
import { PlanSettings } from "@/components/plan-settings";
import { forgetLocaleChoice, useI18n } from "@/components/i18n-provider";
import { ProfileSettings } from "@/components/profile-settings";
import { UserAvatar } from "@/components/user-avatar";
import { saveProfile, settled, uploadPhoto, useAccount } from "@/lib/account-store";
import { settingsButtonStep, settingsDismissStep, type SettingsStep, type SettingsTab } from "@/lib/settings-navigation";
import { LOCALE_NAMES } from "@/lib/i18n/locale";
import { localizeSystemText, msg } from "@/lib/i18n/translate";
import { useBackToClose } from "@/lib/use-back-to-close";
import type { AccountUser } from "@/lib/user-profile";
import { siteHref } from "@/lib/hosts";
import { INTRO_HREF } from "@/lib/i18n/routing";
import { MAX_CUSTOM_INSTRUCTIONS } from "@/types/chat";

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const data: unknown = await response.json().catch(() => null);
  return data && typeof data === "object" ? data as Record<string, unknown> : {};
}
const errorOf = (data: Record<string, unknown>, fallback: string) => typeof data.error === "string" && data.error ? data.error : fallback;

// Save an explicit language or null (Auto); AccountLocaleSync applies it in place.
function LanguageSettings({ user }: { user: AccountUser }) {
  const { t, locale, switching, changeError, setPreference } = useI18n();
  const labelId = useId();
  const { anchor, triggerRef, toggle, close } = useLanguageMenuAnchor();
  const saved = user.locale === undefined ? undefined : user.locale ?? "auto";
  // Null selects Auto; an unknown account preference selects no radio.
  const checked = saved ?? null;

  return (
    <div className="settings-row-block">
      <div className="settings-row">
        <span id={labelId} className="settings-row-title">{t("Language")}</span>
        <button ref={triggerRef} type="button" className="settings-select language-setting" aria-haspopup="dialog" aria-expanded={anchor !== null}
          aria-labelledby={`${labelId} ${labelId}-value`} aria-busy={switching}
          onClick={toggle}>
          {switching && <LoaderCircle size={14} className="animate-spin text-[var(--notion-muted)]" aria-hidden="true" />}
          <span id={`${labelId}-value`}>{saved === "auto" ? t("Auto (current: {language})", { language: LOCALE_NAMES[locale] }) : LOCALE_NAMES[saved ?? locale]}</span>
          <ChevronsUpDown size={14} aria-hidden="true" />
        </button>
      </div>
      {anchor && <LanguageMenuPanel anchor={anchor} current={checked} align="end" onClose={close}
        onChoose={(option) => { close(); if (option !== saved) void saveProfile({ locale: option === "auto" ? null : option }); }} />}
      <span className="sr-only" role="status">{switching ? t("Changing language…") : ""}</span>
      {changeError && <div className="settings-row-note">
        <p role="alert" className="project-settings-error">{t(changeError)}</p>
        {saved !== undefined && <button type="button" className="notion-button mt-2" onClick={() => setPreference(saved)}>{t("Try again")}</button>}
      </div>}
    </div>
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
      window.location.replace(siteHref(INTRO_HREF));
    } catch (reason) {
      setError(reason instanceof Error && reason.message ? reason.message : msg("Could not delete your account. Please try again."));
      setDeleting(false); onBusyChange(false);
    }
  }

  if (!confirming) {
    return <button type="button" className="settings-row settings-row-button is-danger" disabled={disabled} onClick={() => setConfirming(true)}>
      <Trash2 size={16} aria-hidden="true" /><span className="settings-row-title">{t("Delete account")}</span>
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

type Tab = SettingsTab;
// デスクトップ幅の左のナビと、スマホ幅の最初の画面（入口の一覧）に出す順。
const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: "general", label: msg("General"), icon: SlidersHorizontal },
  { id: "personalization", label: msg("Personalization"), icon: PenLine },
  { id: "plan", label: msg("Plan"), icon: CreditCard },
  { id: "account", label: msg("Account"), icon: CircleUser },
];

// スマホ幅かどうか（settings-dialog.css の @media と同じ境目）。
const isPhone = () => window.matchMedia("(max-width: 639px)").matches;

// ログインした利用者の設定。デスクトップ幅は左にナビ・右に選んだ欄。
// スマホ幅は全画面の 2 段: 最初は入口の一覧（アカウントの行と、欄ごとの行）だけを出し、行を押すとその欄の画面に進む。
// プロフィール・言語・アイコンは変えたその場で保存する。カスタム指示だけは「保存」を押すまで送らない:
// 書き換えると下に「未保存の変更」のバーが出て、保存か破棄をするまで閉じない（黙って捨てない）。
// onSignOut は失敗したときに理由の文を返す（成功したらページが読み直される）。
export function SettingsDialog({ user, onSignOut, onClose }: { user: AccountUser; onSignOut: () => Promise<string>; onClose: () => void }) {
  const { t } = useI18n();
  const { saveError } = useAccount();
  const ref = useRef<HTMLDialogElement>(null);
  const locked = useRef(false);
  const profileGuard = useRef<(force?: boolean) => boolean>(() => true);
  const iconGuard = useRef(() => true);
  const nameFlush = useRef(() => {});
  const fieldId = useId();
  const [tab, setTab] = useState<Tab>("general");
  // スマホ幅で入口の一覧を出しているか。デスクトップ幅では使わない（いつも tab の欄を出す）。
  const [home, setHome] = useState(true);
  // 一度でも画面を替えたか。開いた直後の一覧は、画面の切り替えの動きを付けずに出す。
  const [navigated, setNavigated] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  // 直前の操作がキーボードだったか。画面を替えたあとのフォーカスの置き場所を決める（下の useEffect）。
  const byKeyboard = useRef(false);
  // 欄の画面に進むときに押した行。一覧に戻ったらそこへフォーカスを返す。
  const opener = useRef<HTMLElement | null>(null);
  // show / goHome で画面を替えた直後だけ、スクロール位置とフォーカスを合わせる。
  const moved = useRef(false);
  // 欄を出す（スマホ幅ではその欄の画面に進む）。
  // 画面を替える前に、入力中の欄（名前）からフォーカスを外して確定させる。隠すだけでは blur が起きず、入力が保存されない。
  const settleInput = () => {
    nameFlush.current();
    const active = document.activeElement;
    if (active instanceof HTMLElement && bodyRef.current?.contains(active)) active.blur();
  };
  const show = (id: Tab) => {
    // 同じ欄に留まるとき（未保存の指示で引き止めたとき）は、書きかけの入力欄からフォーカスを外さない。
    if (home || id !== tab) settleInput();
    moved.current = true; setNavigated(true); setTab(id); setHome(false);
  };
  const goHome = () => { settleInput(); moved.current = true; setNavigated(true); setHome(true); };
  const [attempt, setAttempt] = useState(0);
  // 読み込んだ時点の指示（null は読み込み前）。変えていなければ保存を送らない。
  const [initial, setInitial] = useState<string | null>(null);
  const [loadError, setLoadError] = useState("");
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // 保存した直後だけ「保存しました」を出す（次に書き換えたら消す）。
  const [justSaved, setJustSaved] = useState(false);
  // 未保存のまま閉じようとした回数。変わるたびにバーを揺らして知らせる。
  const [attention, setAttention] = useState(0);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  // 写真を切り抜き中・送信中。その間は閉じない（切り抜いた写真や失敗の知らせが消えないように）。
  const [photoBusy, setPhotoBusy] = useState(false);
  const dirty = initial !== null && instructions.trim() !== initial;
  // スマホ幅で欄の画面を見ているか（Esc・戻るは、まず一覧に戻す）。
  const onPage = () => !home && isPhone();
  // settings-navigation.ts の決まりで決めたことを行う。設定を閉じたとき以外は false を返す（useBackToClose は「戻る」の登録を保つ）。
  const apply = (step: SettingsStep) => {
    if (step.type === "close") { onClose(); return; }
    if (step.type === "home") goHome();
    // 未保存の指示があるときは、その欄とバーを見せる（バーを揺らして知らせる）。
    if (step.type === "show") { show(step.tab); if (step.attention) setAttention((count) => count + 1); }
    return false;
  };
  // Esc・戻る・外側のクリック。保存中は閉じない（閉じると、保存に失敗しても知らせる場所がなくなる）。
  // 写真・絵文字の編集中は、まずその編集だけを閉じる（別の欄を見ていたら、何が起きたか分かるようその欄を出す）。
  const close = () => {
    if (locked.current) return false;
    const editorIn = !profileGuard.current() ? "account" : !iconGuard.current() ? "general" : null;
    return apply(settingsDismissStep({ locked: false, editorIn, onPage: onPage(), dirty }));
  };
  // 右上の「閉じる」ボタン（スマホ幅では一覧の左上）。編集中の写真・絵文字の欄ごと閉じる（Esc・戻るのように 1 段ずつにはしない）。
  // 切り抜き中・送信中の写真があるときは閉じずに、その欄を出す。ファイル選択画面の取消を知らせないブラウザでも、これで必ず閉じられる。
  const closeAll = () => { apply(settingsButtonStep({ locked: locked.current, photoBusy, onPage: false, dirty })); };
  // スマホ幅の欄の画面の「戻る」ボタン。開いている写真・絵文字の編集は閉じて、一覧に戻る。
  const backHome = () => {
    const step = settingsButtonStep({ locked: locked.current, photoBusy, onPage: true, dirty });
    if (step.type === "home") { profileGuard.current(true); iconGuard.current(); }
    apply(step);
  };
  useBackToClose(true, close);
  // 開いたときのフォーカスは画面そのものに置く。最初のボタンに置くと、タッチの端末でも開いた瞬間にフォーカスの枠が出る。
  useEffect(() => { ref.current?.showModal(); ref.current?.focus(); }, []);
  // 操作がキーボードか指・マウスかを覚える。window の capture で聞く（Esc は useBackToClose が先に受けて止めるため）。
  // 文字の入力は数えない: 名前を打ったあと端末の「戻る」で一覧に戻っても、キーボードの操作とは見なさない。
  // 入力欄の中では、空白・Enter・矢印は文字の入力やカーソルの移動なので、Tab と Esc だけを数える（変換中のキーも数えない）。
  useEffect(() => {
    const keys = new Set(["Tab", "Enter", " ", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
    const typing = (target: EventTarget | null) => target instanceof HTMLTextAreaElement
      || (target instanceof HTMLInputElement && !["button", "checkbox", "radio", "file", "submit", "reset", "range", "color"].includes(target.type))
      || (target instanceof HTMLElement && target.isContentEditable);
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing || !keys.has(event.key)) return;
      if (typing(event.target) && event.key !== "Tab" && event.key !== "Escape") return;
      byKeyboard.current = true;
    };
    const onPointer = () => { byKeyboard.current = false; };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onPointer, true);
    return () => { window.removeEventListener("keydown", onKey, true); window.removeEventListener("pointerdown", onPointer, true); };
  }, []);
  // 画面を替えたら上から見せる。スマホ幅ではフォーカスも移す。
  // キーボードで操作しているときは、欄の画面では「戻る」、一覧では押した行に置く（そこから続けて操作できる）。
  // 指・マウスのときは題に置く: ボタンに置くと、iOS の Safari は触っていないボタンにフォーカスの枠を描く。
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
    if (!isPhone()) return;
    if (!byKeyboard.current) { titleRef.current?.focus(); return; }
    // 押した行が分からないとき（デスクトップ幅で開いてから幅を狭めたときなど）は「閉じる」に置く。
    if (home) (opener.current ?? closeRef.current)?.focus(); else backRef.current?.focus();
  }, [home, tab]);

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
    if (locked.current || !dirty) return;
    const text = instructions.trim();
    locked.current = true; setBusy(true); setError("");
    try {
      const response = await fetch("/api/custom-instructions", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ instructions: text }) });
      const data = await readJson(response);
      if (!response.ok) throw new Error(errorOf(data, msg("Could not save your custom instructions. Please try again.")));
      setInitial(text);
      setJustSaved(true);
      setAttention(0);
    } catch (reason) {
      setError(reason instanceof Error && reason.message ? reason.message : msg("Could not save your custom instructions. Please try again."));
      // 失敗の理由はカスタム指示の欄に出る。別の欄からバーの「保存」を押したときも見えるようにする。
      show("personalization");
    } finally { locked.current = false; setBusy(false); }
  }

  const accountBusy = busy || signingOut || photoBusy;
  const tabLabel = t(TABS.find((entry) => entry.id === tab)!.label);
  const name = user.name ?? user.email ?? t("Account");
  // デスクトップ幅では、ナビで選んだ欄（is-active）だけを出す。
  const group = (id: Tab) => `settings-group${tab === id ? " is-active" : ""}`;
  // サイドバーは幅によって隠れる（デスクトップ用と抽屉用の 2 つがある）ので、その外（body）に出す。
  return createPortal(<dialog ref={ref} tabIndex={-1} aria-label={t("Settings")} className="notes-dialog settings-dialog"
    // Esc は useBackToClose が受けて既定の動作を止めるので、ここに来るのはそれ以外の閉じる要求（Android Chrome の「戻る」など）。
    // それでもブラウザが閉じてしまった場合（続けて「戻る」を押したときなど）は、開いている状態を合わせる。
    // React は cancel / close を子から親へ伝えるので、中で開いた言語の一覧（これも <dialog>）のものは無視する。
    onCancel={(event) => { if (event.target !== event.currentTarget) return; event.preventDefault(); close(); }}
    onClose={(event) => { if (event.target === event.currentTarget) onClose(); }}
    onClick={(event) => { if (event.target === event.currentTarget) { const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close(); } }}>
    <div className="settings-shell" data-home={home} data-navigated={navigated}>
      <nav className="settings-nav" aria-label={t("Settings")}>
        <p className="settings-nav-title" aria-hidden="true">{t("Settings")}</p>
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" className="settings-nav-item" aria-current={tab === id ? "page" : undefined} onClick={() => setTab(id)}>
            <Icon size={16} aria-hidden="true" />{t(label)}
          </button>
        ))}
      </nav>
      <div className="settings-main">
        <header className="settings-header">
          <button ref={backRef} type="button" className="notion-icon-button settings-back grid" aria-label={t("Back")} onClick={backHome}><ArrowLeft size={20} /></button>
          <h2 ref={titleRef} tabIndex={-1} className="settings-title">
            <span className="settings-title-mobile">{home ? t("Settings") : tabLabel}</span>
            <span className="settings-title-desktop">{tabLabel}</span>
          </h2>
          <button ref={closeRef} type="button" className="notion-icon-button settings-close grid" aria-label={t("Close")} onClick={closeAll}><X size={18} /></button>
        </header>
        <div ref={bodyRef} className={`settings-body${dirty ? " has-unsaved" : ""}`}>
          {/* 名前・写真・言語の保存に失敗したときの知らせ。どの欄を見ていても出るよう、欄の外（いちばん上）に置く。 */}
          {saveError && <p role="alert" className="project-settings-error settings-save-error">{localizeSystemText(saveError, t)}</p>}
          {/* スマホ幅の最初の画面: アカウントの行と、欄ごとの入口の行。押すとその欄の画面に進む（デスクトップ幅では出さない）。 */}
          <div className="settings-home">
            <button type="button" className="settings-card settings-identity" onClick={(event) => { opener.current = event.currentTarget; show("account"); }}>
              <UserAvatar user={user} size={44} />
              <span className="settings-row-text">
                <span className="settings-identity-name">{name}</span>
                {user.email && user.email !== name && <span className="settings-row-help">{user.email}</span>}
              </span>
              <ChevronRight size={18} className="settings-home-chevron" aria-hidden="true" />
            </button>
            <div className="settings-card settings-home-list">
              {TABS.map(({ id, label, icon: Icon }) => (
                <button key={id} type="button" className="settings-row settings-row-button settings-home-row" onClick={(event) => { opener.current = event.currentTarget; show(id); }}>
                  <Icon size={20} aria-hidden="true" /><span className="settings-row-title">{t(label)}</span>
                  <ChevronRight size={18} className="settings-home-chevron" aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>
          <section className={group("account")} aria-label={t("Profile")}>
            <div className="settings-card settings-card-padded">
              <ProfileSettings user={user} onSave={saveProfile} onUpload={uploadPhoto} closeGuardRef={profileGuard} nameFlushRef={nameFlush} onPhotoBusyChange={setPhotoBusy} />
            </div>
          </section>

          <section className={group("plan")} aria-label={t("Plan")}>
            <h3 className="settings-group-label">{t("Plan")}</h3>
            <div className="settings-card settings-card-padded"><PlanSettings /></div>
          </section>

          <section className={group("general")} aria-label={t("General")}>
            <h3 className="settings-group-label">{t("General")}</h3>
            <div className="settings-card">
              <LanguageSettings user={user} />
              <AppIconSettings closeGuardRef={iconGuard} />
            </div>
          </section>

          <section className={group("personalization")} aria-label={t("Personalization")}>
            <h3 className="settings-group-label">{t("Personalization")}</h3>
            <div className="settings-card settings-card-padded">
              <label htmlFor={fieldId} className="project-settings-label">
                {t("Custom instructions")}
                {justSaved && !dirty
                  ? <span className="settings-saved" role="status"><Check size={13} aria-hidden="true" />{t("Saved")}</span>
                  : initial !== null && <span className="project-settings-count" aria-live="polite">{instructions.length}/{MAX_CUSTOM_INSTRUCTIONS}</span>}
              </label>
              {initial === null && !loadError && <p className="project-settings-empty" role="status"><LoaderCircle size={14} className="mr-1 inline animate-spin" aria-hidden="true" />{t("Loading…")}</p>}
              {loadError && <>
                <p role="alert" className="project-settings-error">{localizeSystemText(loadError, t)}</p>
                <button type="button" className="notion-button mt-2" onClick={() => { setLoadError(""); setAttempt((count) => count + 1); }}>{t("Try again")}</button>
              </>}
              {initial !== null && <textarea id={fieldId} className="settings-textarea" value={instructions} disabled={busy}
                maxLength={MAX_CUSTOM_INSTRUCTIONS}
                placeholder={t("For example:\n- Answer in plain, casual language\n- Lead with the conclusion and keep it short\n- If you’re not sure, say so instead of guessing")}
                onChange={(event) => { setInstructions(event.target.value); setJustSaved(false); }} />}
              {error && <p role="alert" className="project-settings-error">{localizeSystemText(error, t)}</p>}
            </div>
          </section>

          <section className={group("account")} aria-label={t("Account")}>
            <h3 className="settings-group-label">{t("Account")}</h3>
            <div className="settings-card">
              <button type="button" className="settings-row settings-row-button" disabled={accountBusy}
                onClick={async () => {
                  setSigningOut(true); setSignOutError("");
                  const failure = await onSignOut();
                  setSigningOut(false); setSignOutError(failure);
                }}><LogOut size={16} aria-hidden="true" /><span className="settings-row-title">{t("Sign out")}</span></button>
              {signOutError && <div className="settings-row-note"><p role="alert" className="project-settings-error">{localizeSystemText(signOutError, t)}</p></div>}
              <DeleteAccount disabled={accountBusy} onBusyChange={(value) => { locked.current = value; }} />
            </div>
          </section>
        </div>
        {/* カスタム指示を書き換えた間だけ出すバー。閉じようとすると揺れて知らせる（key を変えてアニメーションをやり直す）。 */}
        {dirty && (
          <div key={attention} className={`settings-unsaved${attention ? " is-attention" : ""}`} role="group" aria-label={t("Unsaved changes")}>
            <span className="settings-unsaved-text" role={attention ? "alert" : undefined}>{t("Unsaved changes")}</span>
            <button type="button" className="settings-unsaved-discard" disabled={busy} onClick={() => { setInstructions(initial ?? ""); setError(""); setAttention(0); }}>{t("Discard")}</button>
            <button type="button" className="settings-unsaved-save" disabled={busy} onClick={() => void save()}>{busy ? t("Saving…") : t("Save")}</button>
          </div>
        )}
      </div>
    </div>
  </dialog>, document.body);
}
