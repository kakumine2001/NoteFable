"use client";

import { ImagePlus, RotateCcw, Smile } from "lucide-react";
import { useId, useRef, useState, type ChangeEvent } from "react";
import { AppIcon } from "@/components/app-icon";
import { EmojiPickerBody } from "@/components/emoji-picker";
import { useT } from "@/components/i18n-provider";
import { imageFileToIcon, isImageIcon, saveAppIcon, useAppIcon } from "@/lib/app-icon";
import { msg } from "@/lib/i18n/translate";

// 設定画面の「アイコン」。サイドバーのロゴ・AI の返答の印・ノートの AI ボタンに出るアイコンを、絵文字か画像に替える。
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
    <section className="project-settings-section settings-app-icon" aria-labelledby={labelId}>
      <h3 id={labelId} className="project-settings-label">{t("Icon")}</h3>
      <p id={helpId} className="project-settings-help">{t("Shown in the sidebar, on AI replies and on the AI button in notes. Saved on this device only.")}</p>
      <div className="settings-app-icon-row">
        <span className="settings-app-icon-preview"><AppIcon size={26} icon={icon} /></span>
        <div className="settings-app-icon-actions">
          <button type="button" className="settings-inline-action" aria-expanded={picking} aria-describedby={helpId} onClick={() => setPicking((current) => !current)}>
            <Smile size={14} />{t("Choose an emoji")}
          </button>
          <button type="button" className="settings-inline-action" onClick={() => fileInput.current?.click()}>
            <ImagePlus size={14} />{t("Upload an image")}
          </button>
          {icon && (
            <button type="button" className="settings-inline-action" onClick={() => { apply(null); setPicking(false); }}>
              <RotateCcw size={14} />{t("Use NoteFable logo")}
            </button>
          )}
        </div>
        <input ref={fileInput} type="file" className="sr-only" tabIndex={-1} accept="image/png,image/jpeg,image/webp,image/gif" onChange={chooseImage} />
      </div>
      {error && <p role="alert" className="project-settings-error">{t(error)}</p>}
      {picking && (
        <div className="profile-editor">
          <div className="profile-emoji">
            <EmojiPickerBody current={icon && !isImageIcon(icon) ? icon : null} removeLabel={t("Use NoteFable logo")}
              onChange={apply} onClose={() => setPicking(false)} />
          </div>
        </div>
      )}
    </section>
  );
}
