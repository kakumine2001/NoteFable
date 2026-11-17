"use client";

import { ImagePlus, RotateCcw, Smile } from "lucide-react";
import { useId, useRef, useState, type ChangeEvent } from "react";
import { AppIcon } from "@/components/app-icon";
import { EmojiPickerBody } from "@/components/emoji-picker";
import { useT } from "@/components/i18n-provider";
import { imageFileToIcon, isImageIcon, saveAppIcon, useAppIcon } from "@/lib/app-icon";
import { msg } from "@/lib/i18n/translate";

// 設定画面の「アイコン」の行。サイドバーのロゴ・AI の返答の印・ノートの AI ボタンに出るアイコンを、絵文字か画像に替える。
// 既定は NoteFable のロゴ。選んだその場でこのブラウザに保存する（アカウントには保存しない）。
export function AppIconSettings() {
  const t = useT();
  const icon = useAppIcon();
  const labelId = useId();
  const helpId = useId();
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  function apply(next: string | null) {
    setError(saveAppIcon(next) ? "" : msg("Could not save the icon on this device."));
  }

  async function chooseImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) return setError(msg("Choose an image file."));
    try {
      apply(await imageFileToIcon(file));
      setPicking(false);
    } catch {
      setError(msg("Choose an image file."));
    }
  }

  return (
    <div className="settings-row-block settings-app-icon" role="group" aria-labelledby={labelId}>
      <div className="settings-row">
        <div className="settings-row-text">
          <span id={labelId} className="settings-row-title">{t("Icon")}</span>
          <span id={helpId} className="settings-row-help">{t("Shown in the sidebar, on AI replies and on the AI button in notes. Saved on this device only.")}</span>
        </div>
        <span className="settings-app-icon-preview"><AppIcon size={22} icon={icon} /></span>
      </div>
      <div className="settings-chip-row">
        <button type="button" className="settings-chip" aria-expanded={picking} aria-describedby={helpId} onClick={() => setPicking((current) => !current)}>
          <Smile size={14} aria-hidden="true" />{t("Choose an emoji")}
        </button>
        <button type="button" className="settings-chip" onClick={() => fileInput.current?.click()}>
          <ImagePlus size={14} aria-hidden="true" />{t("Upload an image")}
        </button>
        {icon && (
          <button type="button" className="settings-chip" onClick={() => { apply(null); setPicking(false); }}>
            <RotateCcw size={14} aria-hidden="true" />{t("Use NoteFable logo")}
          </button>
        )}
        <input ref={fileInput} type="file" className="sr-only" tabIndex={-1} accept="image/png,image/jpeg,image/webp,image/gif" onChange={chooseImage} />
      </div>
      {error && <div className="settings-row-note"><p role="alert" className="project-settings-error">{t(error)}</p></div>}
      {picking && (
        <div className="profile-editor">
          <div className="profile-emoji">
            <EmojiPickerBody current={icon && !isImageIcon(icon) ? icon : null} removeLabel={t("Use NoteFable logo")}
              onChange={apply} onClose={() => setPicking(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
