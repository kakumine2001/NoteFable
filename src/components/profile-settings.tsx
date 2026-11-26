"use client";

import { ImagePlus, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent, type RefObject } from "react";
import { AvatarCropper } from "@/components/avatar-cropper";
import { EmojiPickerBody } from "@/components/emoji-picker";
import { UserAvatar } from "@/components/user-avatar";
import { MAX_DISPLAY_NAME, type AccountUser, type ProfileEdit } from "@/lib/user-profile";
import { useT } from "@/components/i18n-provider";
import { msg } from "@/lib/i18n/translate";
import { isImeKeyEvent } from "@/lib/ime";

// 選んだ写真の上限（切り抜く前の元の写真）。送るのは 512px に切り抜いた画像。
const MAX_PICKED_BYTES = 10 * 1024 * 1024;

type Editor = "closed" | "photo" | "emoji";

// 設定画面が閉じてよいかを尋ねる。写真・絵文字の編集中は、まずその編集だけを閉じて false を返す。
// ファイル選択中と写真の送信中も false（閉じると失敗の知らせを出す場所がなくなる）。
// force は、設定の「戻る」ボタン（スマホ幅で一覧に戻る）から。ファイル選択画面が開いたままだと思い込んでいても編集を閉じる
// （選択画面の取消を知らせないブラウザでは、その印が残り続ける）。
export type ProfileCloseGuard = RefObject<(force?: boolean) => boolean>;

// 設定画面の「プロフィール」。顔（写真をアップロード・絵文字を選ぶ）・名前・メール・Google の表示に戻すボタン。
// 名前・写真・絵文字は変えたその場で保存する（account-store が順番に送る）。
export function ProfileSettings({ user, onSave, onUpload, closeGuardRef, nameFlushRef, onPhotoBusyChange }: {
  user: AccountUser;
  onSave: (patch: ProfileEdit) => void;
  // 切り抜いた写真を保存する。失敗したときはその理由の文を返し、成功したら空文字を返す。
  onUpload: (photo: Blob) => Promise<string>;
  closeGuardRef: ProfileCloseGuard;
  // 入力途中の名前を今すぐ確定する関数を入れる。スマホ幅で欄の画面を離れるとき、設定画面が呼ぶ
  // （欄は隠れるだけで消えないので、アンマウント時の確定も blur も当てにできない）。
  nameFlushRef?: RefObject<() => void>;
  // 写真を切り抜いている間（まだ保存していない）と送っている間は true。
  onPhotoBusyChange: (busy: boolean) => void;
}) {
  const t = useT();
  // 入力中だけ持つ下書き（null は入力していない）。入力欄には、下書きがなければ今の名前を出す。
  const [draft, setDraft] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor>("closed");
  const [picked, setPicked] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  // OS のファイル選択画面が開いている間は、Esc や外側のクリックで設定を閉じない（選択画面を閉じたときの操作がページへ届く環境があるため）。
  const filePickerOpen = useRef(false);
  useEffect(() => {
    const input = fileInput.current;
    const release = () => { filePickerOpen.current = false; };
    input?.addEventListener("cancel", release);
    return () => input?.removeEventListener("cancel", release);
  }, [editor, picked]);

  const photoBusy = Boolean(picked) || uploading;
  useEffect(() => { onPhotoBusyChange(photoBusy); }, [photoBusy, onPhotoBusyChange]);

  const shownName = user.displayName ?? user.googleName ?? "";

  // 同じ下書きを 2 回確定しない（一覧に戻るときは、確定の呼び出しと入力欄の blur が続けて来る）。
  const committed = useRef<string | null>(null);
  useEffect(() => { committed.current = null; }, [draft]);
  function commitName() {
    if (draft === null || committed.current === draft) return;
    committed.current = draft;
    const next = draft.replace(/\s+/g, " ").trim();
    setDraft(null);
    // 空にした、または Google の名前と同じにした場合は、Google の名前に戻す（null）。
    const value = next === "" || next === (user.googleName ?? "") ? null : next;
    if (value !== user.displayName) onSave({ displayName: value });
  }

  // 入力途中の名前は、どんな閉じ方（Esc・戻るキー・ボタン）でも保存する。閉じると入力欄ごと消えて blur が起きないため、閉じる時に確定する。
  const flushRef = useRef(commitName);
  useEffect(() => { flushRef.current = commitName; if (nameFlushRef) nameFlushRef.current = commitName; });
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

  useEffect(() => {
    closeGuardRef.current = (force = false) => {
      if (uploading || (filePickerOpen.current && !force)) return false;
      filePickerOpen.current = false;
      if (editor !== "closed") { switchEditor("closed"); return false; }
      return true;
    };
  });

  const customized = Boolean(user.displayName || user.icon || user.avatarUrl);
  // メールでログインした人には Google の名前・写真が無い。「Google に戻す」系の文言は Google のプロフィールがあるときだけ。
  const hasGoogleProfile = !user.appleProfile && Boolean(user.googleName || user.image);

  return (
    <div className="settings-profile">
      <div className="profile-menu-head">
        <button type="button" className="profile-avatar-button" aria-label={t("Change photo or icon")} aria-expanded={editor !== "closed"}
          onClick={() => (editor === "closed" ? switchEditor("photo") : switchEditor("closed"))}>
          <UserAvatar user={user} size={56} />
          <span className="profile-avatar-badge" aria-hidden="true"><Pencil size={11} /></span>
        </button>
        <div className="min-w-0 flex-1">
          <label className="profile-label" htmlFor="profile-name">{t("Name")}</label>
          <input id="profile-name" className="profile-name-input" value={draft ?? shownName} maxLength={MAX_DISPLAY_NAME}
            placeholder={user.googleName ?? t("Your name")} autoComplete="off"
            onChange={(event) => setDraft(event.target.value)} onBlur={commitName}
            // 変換を確定する Enter では名前を確定しない。
            onKeyDown={(event) => { if (event.key === "Enter" && !isImeKeyEvent(event.nativeEvent)) { event.preventDefault(); commitName(); event.currentTarget.blur(); } }} />
          {user.email && <div className="profile-email" title={user.email}>{user.email}</div>}
        </div>
      </div>

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
              <EmojiPickerBody current={user.icon} removeLabel={hasGoogleProfile ? t("Use Google photo") : undefined}
                onChange={(icon) => onSave({ icon })} onClose={() => switchEditor("closed")} />
            </div>
          )}
        </div>
      )}

      {customized && hasGoogleProfile && (
        <button type="button" className="settings-chip settings-profile-reset" onClick={() => { setDraft(null); onSave({ displayName: null, icon: null }); }}>
          <RotateCcw size={14} aria-hidden="true" />{t("Use my Google name and photo")}
        </button>
      )}
    </div>
  );
}
