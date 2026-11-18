"use client";

import { Check, ImagePlus, Sparkles, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ChangeEvent, type MutableRefObject } from "react";
import { AppIcon } from "@/components/app-icon";
import { CharacterGraphic } from "@/components/character-avatar";
import { useT } from "@/components/i18n-provider";
import { imageFileToIcon, resolveAppIcon, saveAppIcon, toCharacterIcon, useAppIcon } from "@/lib/app-icon";
import { CHARACTER_DEFINITIONS, type CharacterId } from "@/lib/characters";
import { msg } from "@/lib/i18n/translate";

// 設定画面「一般 → アイコン」。
// プリセットの AI キャラクター（7 種、既定は Quill）を選ぶボタンと、任意の画像をアップロードするボタンを提供する。
// 選んだその場でこのブラウザに保存し、チャット・サイドバー・ノートの AI ボタン全体へ即座に反映する。
export function AppIconSettings({ closeGuardRef }: { closeGuardRef?: MutableRefObject<() => boolean> }) {
  const t = useT();
  const icon = useAppIcon();
  const resolved = resolveAppIcon(icon);
  const selectedCharacterId: CharacterId | null = resolved.kind === "character" ? resolved.characterId : null;
  const labelId = useId();
  const helpId = useId();
  const pickerLabelId = useId();
  const [picking, setPicking] = useState(false);
  const [hoveredId, setHoveredId] = useState<CharacterId | null>(null);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!closeGuardRef) return;
    closeGuardRef.current = () => {
      if (!picking) return true;
      setPicking(false);
      return false;
    };
    return () => {
      closeGuardRef.current = () => true;
    };
  }, [closeGuardRef, picking]);

  function apply(next: string | null) {
    setError(saveAppIcon(next) ? "" : msg("Could not save the icon on this device."));
  }

  function selectCharacter(id: CharacterId) {
    apply(toCharacterIcon(id));
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
          <span id={helpId} className="settings-row-help">{t("Shown in chat, in the sidebar and on the AI button in notes. Saved on this device only.")}</span>
        </div>
        <span className="settings-app-icon-preview"><AppIcon size={24} icon={icon} animated /></span>
      </div>
      <div className="settings-chip-row">
        <button
          type="button"
          className="settings-chip"
          aria-expanded={picking}
          aria-describedby={helpId}
          onClick={() => setPicking((current) => !current)}
        >
          <Sparkles size={14} aria-hidden="true" />{t("Choose a character")}
        </button>
        <button type="button" className="settings-chip" onClick={() => fileInput.current?.click()}>
          <ImagePlus size={14} aria-hidden="true" />{t("Upload an image")}
        </button>
        <input ref={fileInput} type="file" className="sr-only" tabIndex={-1} accept="image/png,image/jpeg,image/webp,image/gif" onChange={chooseImage} />
      </div>
      {error && <div className="settings-row-note"><p role="alert" className="project-settings-error">{t(error)}</p></div>}
      {picking && (
        <div className="settings-character-picker" role="region" aria-labelledby={pickerLabelId}>
          <div className="settings-character-picker-head">
            <span id={pickerLabelId} className="settings-character-picker-title">{t("Choose a character")}</span>
            <button
              type="button"
              className="notion-icon-button settings-character-picker-close grid"
              aria-label={t("Close")}
              onClick={() => setPicking(false)}
            >
              <X size={15} aria-hidden="true" />
            </button>
          </div>
          <div className="settings-character-grid" role="radiogroup" aria-labelledby={pickerLabelId}>
            {CHARACTER_DEFINITIONS.map((character) => {
              const isSelected = selectedCharacterId === character.id;
              const isPreviewAnimated = isSelected || hoveredId === character.id;
              const optionLabel = character.isDefault ? `${character.name} (${t("Default")})` : character.name;
              return (
                <button
                  key={character.id}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  aria-label={optionLabel}
                  className={`settings-character-card${isSelected ? " is-selected" : ""}`}
                  onClick={() => selectCharacter(character.id)}
                  onPointerEnter={() => setHoveredId(character.id)}
                  onPointerLeave={() => setHoveredId((current) => (current === character.id ? null : current))}
                  onFocus={() => setHoveredId(character.id)}
                  onBlur={() => setHoveredId((current) => (current === character.id ? null : current))}
                >
                  {isSelected && (
                    <span className="settings-character-check" aria-hidden="true">
                      <Check size={11} strokeWidth={2.6} />
                    </span>
                  )}
                  <span className="settings-character-stage">
                    <CharacterGraphic characterId={character.id} size={40} state="idle" animated={isPreviewAnimated} />
                  </span>
                  <span className="settings-character-name">{character.name}</span>
                  {character.isDefault && <span className="settings-character-badge">{t("Default")}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
