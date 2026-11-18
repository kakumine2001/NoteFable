"use client";

import { CharacterGraphic } from "@/components/character-avatar";
import { resolveAppIcon, useAppIcon } from "@/lib/app-icon";
import type { CharacterState } from "@/lib/characters";

// ワークスペース全体で使う AI アイコン（サイドバー、AI の返答、ノートの AI ボタン、設定の見本）。
// 設定で選んでいればそのキャラクター／カスタム画像を、未設定なら既定キャラクターの Quill を出す。
// icon を明示すると保存値の代わりにその値をそのまま描く（設定画面の見本用）。
export function AppIcon({
  size = 20,
  icon,
  state = "idle",
  animated = false,
}: {
  size?: number;
  icon?: string | null;
  state?: CharacterState;
  animated?: boolean;
}) {
  const saved = useAppIcon();
  const resolved = resolveAppIcon(icon === undefined ? saved : icon);

  if (resolved.kind === "image") {
    // data URL の小さな画像なので、next/image の最適化は通さない。
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="app-icon-image" src={resolved.dataUrl} alt="" width={size} height={size} draggable={false} />;
  }

  return (
    <CharacterGraphic
      characterId={resolved.characterId}
      size={size}
      state={state}
      animated={animated}
    />
  );
}

// ワークスペースのサイドバーに出すロゴ。選んだ AI キャラクター（またはカスタム画像）と NoteFable の文字を並べる。
export function NoteFableLogo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="nf-logo" role="img" aria-label="NoteFable">
      <AppIcon size={20} />
      {!compact && <span aria-hidden="true">NoteFable</span>}
    </div>
  );
}
