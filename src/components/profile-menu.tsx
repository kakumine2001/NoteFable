"use client";

import { ImagePlus, LogOut, Pencil, RotateCcw, Settings, Trash2 } from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { AvatarCropper } from "@/components/avatar-cropper";
import { EmojiPickerBody, Popover } from "@/components/emoji-picker";
import { UserAvatar } from "@/components/user-avatar";
import { MAX_DISPLAY_NAME, type AccountUser, type ProfilePatch } from "@/lib/user-profile";
import { useT } from "@/components/i18n-provider";
import { localizeSystemText, msg } from "@/lib/i18n/translate";

export type MenuPosition = { left: number; bottom: number; width: number; maxHeight: number };

// 選んだ写真の上限（切り抜く前の元の写真）。送るのは 512px に切り抜いた画像。
const MAX_PICKED_BYTES = 10 * 1024 * 1024;

// 押した行の真上に出す位置。サイドバーは画面の下端にあるので、行の上へ向けて開く。
export function menuPositionFor(anchor: DOMRect): MenuPosition {
  const margin = 12;
  const width = Math.min(300, window.innerWidth - margin * 2);
  const left = Math.max(margin, Math.min(anchor.left, window.innerWidth - width - margin));
  // 行の上に使える高さに収める。背の低い画面（横向きなど）では、メニューの中を縦にスクロールできる。
  return { left, bottom: window.innerHeight - anchor.top + 6, width, maxHeight: Math.max(160, anchor.top - 6 - margin) };
}

type ProfileMenuProps = {
  user: AccountUser;
  position: MenuPosition;
  trigger: { current: HTMLElement | null };
  error: string;
  onSave: (patch: { displayName?: string | null; icon?: string | null }) => void;
  // 切り抜いた写真を保存する。失敗したときはその理由の文を返し、成功したら空文字を返す。
  onUpload: (photo: Blob) => Promise<string>;
  // 設定ダイアログ（カスタム指示）を開く。メニューは呼び出し側が閉じる。
  onOpenSettings: () => void;
  onSignOut: () => void;
  onClose: () => void;
};

type Editor = "closed" | "photo" | "emoji";

// プロフィール。顔（写真をアップロード・絵文字を選ぶ）・名前（書き換えられる）・メール・Google の表示に戻すボタン・設定・ログアウト。
// スクロールする一覧の外（body）に固定位置で出すので、サイドバーに裁ち切られない。
export function ProfileMenu({ user, position, trigger, error, onSave, onUpload, onOpenSettings, onSignOut, onClose }: ProfileMenuProps) {
  const t = useT();
  // 入力中だけ持つ下書き（null は入力していない）。入力欄には、下書きがなければ今の名前を出す。
  const [draft, setDraft] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor>("closed");
  const [picked, setPicked] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  // OS のファイル選択画面が開いている間は、メニューの外のタップや Esc で閉じない（選択画面を閉じたときの操作がページへ届く環境があるため）。
  const filePickerOpen = useRef(false);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });
  useEffect(() => {
    const input = fileInput.current;
    const release = () => { filePickerOpen.current = false; };
    input?.addEventListener("cancel", release);
    return () => input?.removeEventListener("cancel", release);
  }, [editor, picked]);

  // 位置は開いた時点で決めているので、画面の幅が変わったら閉じる。キーボードやアドレスバーによる高さだけの変化では閉じない
  // （名前を入力しようとしてキーボードが出ただけでメニューが消えないように）。
  useEffect(() => {
    const width = window.innerWidth;
    const close = () => { if (window.innerWidth !== width) closeRef.current(); };
    window.addEventListener("resize", close);
    return () => window.removeEventListener("resize", close);
  }, []);

  const shownName = user.displayName ?? user.googleName ?? "";

  function commitName() {
    if (draft === null) return;
    const next = draft.replace(/\s+/g, " ").trim();
    setDraft(null);
    // 空にした、または Google の名前と同じにした場合は、Google の名前に戻す（null）。
    const value = next === "" || next === (user.googleName ?? "") ? null : next;
    if (value !== user.displayName) onSave({ displayName: value });
  }

  // 入力途中の名前は、どんな閉じ方（外をタップ・Esc・戻るキー）でも保存する。閉じると入力欄ごと消えて blur が起きないため、閉じる時に確定する。
  const flushRef = useRef(commitName);
  useEffect(() => { flushRef.current = commitName; });
  useEffect(() => () => flushRef.current(), []);

  function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    filePickerOpen.current = false;
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) return setUploadError(msg("Choose an image file."));
    if (file.size > MAX_PICKED_BYTES) return setUploadError(msg("Choose a photo under 10 MB."));
    setUploadError("");
    setPicked(file);
  }

  function openFilePicker() {
    filePickerOpen.current = true;
    // 取消は input の cancel、選択は change で解除する。focus は選択画面を開く時にも来る環境がある。
    fileInput.current?.click();
  }

  async function savePhoto(photo: Blob) {
    setUploading(true);
    const message = await onUpload(photo);
    setUploading(false);
    if (message) return setUploadError(message);
    setPicked(null);
    setEditor("closed");
  }

  function switchEditor(next: Editor) {
    setEditor(next);
    setPicked(null);
    setUploadError("");
  }

  // 閉じてよいときだけ閉じる。ファイル選択中と、写真を送っている最中は閉じない（失敗の知らせが消えないように）。
  function closeIfAllowed() {
    if (filePickerOpen.current || uploading) return;
    onClose();
  }

  const customized = Boolean(user.displayName || user.icon || user.avatarUrl);

  return createPortal(
    <Popover className="profile-menu" label={t("Profile")} trigger={trigger} onClose={closeIfAllowed} style={position}>
      <div className="profile-menu-head">
        <button type="button" className="profile-avatar-button" aria-label={t("Change photo or icon")} aria-expanded={editor !== "closed"}
          onClick={() => (editor === "closed" ? switchEditor("photo") : switchEditor("closed"))}>
          <UserAvatar user={user} size={52} />
          <span className="profile-avatar-badge" aria-hidden="true"><Pencil size={11} /></span>
        </button>
        <div className="min-w-0 flex-1">
          <label className="profile-label" htmlFor="profile-name">{t("Name")}</label>
          <input id="profile-name" className="profile-name-input" value={draft ?? shownName} maxLength={MAX_DISPLAY_NAME}
            placeholder={user.googleName ?? t("Your name")} autoComplete="off"
            onChange={(event) => setDraft(event.target.value)} onBlur={commitName}
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commitName(); event.currentTarget.blur(); } }} />
        </div>
      </div>
      {user.email && <div className="profile-email" title={user.email}>{user.email}</div>}

      {editor !== "closed" && (
        <div className="profile-editor">
          <div className="notes-picker-tabs" role="tablist">
            {(["photo", "emoji"] as const).map((tab) => (
              <button key={tab} type="button" role="tab" aria-selected={editor === tab} className={editor === tab ? "is-active" : ""}
                onClick={() => switchEditor(tab)}>{tab === "photo" ? t("Photo") : t("Emoji")}</button>
            ))}
          </div>

          {editor === "photo" && (picked ? (
            <AvatarCropper file={picked} saving={uploading} error={t(uploadError)} onCancel={() => { setPicked(null); setUploadError(""); }} onSave={savePhoto} />
          ) : (
            <div className="profile-photo-pane">
              <button type="button" className="profile-upload-button" onClick={openFilePicker}>
                <ImagePlus size={16} />{t("Upload a photo")}
              </button>
              <p>{t("JPEG, PNG, WebP or GIF. You can crop it next.")}</p>
              {user.avatarUrl && (
                <button type="button" className="profile-remove-photo" onClick={() => onSave({ icon: null })}>
                  <Trash2 size={14} />{t("Remove my photo")}
                </button>
              )}
              {uploadError && <p className="profile-error" role="alert">{t(uploadError)}</p>}
              <input ref={fileInput} type="file" className="sr-only" tabIndex={-1} accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={choosePhoto} />
            </div>
          ))}

          {editor === "emoji" && (
            <div className="profile-emoji">
              <EmojiPickerBody current={user.icon} removeLabel={t("Use Google photo")}
                onChange={(icon) => onSave({ icon })} onClose={() => switchEditor("closed")} />
            </div>
          )}
        </div>
      )}

      {error && <div className="profile-error" role="alert">{localizeSystemText(error, t)}</div>}

      <div className="profile-actions">
        {customized && (
          <button type="button" onClick={() => { setDraft(null); onSave({ displayName: null, icon: null }); }}>
            <RotateCcw size={14} />{t("Use my Google name and photo")}
          </button>
        )}
        <button type="button" aria-haspopup="dialog" onClick={onOpenSettings}><Settings size={14} />{t("Settings")}</button>
        <button type="button" onClick={onSignOut}><LogOut size={14} />{t("Sign out")}</button>
      </div>
    </Popover>,
    document.body,
  );
}

export type { ProfilePatch };
