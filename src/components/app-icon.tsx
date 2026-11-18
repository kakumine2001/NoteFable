"use client";

import { ResolvedCharacterAvatar } from "@/components/character-avatar";
import { resolveAppIcon, useAppIcon } from "@/lib/app-icon";
import type { CharacterState } from "@/lib/characters";

// ワークスペース全体で使う AI アイコン（サイドバー、AI の返答、ノートの AI ボタン、設定の見本）。
// 設定で選んでいればそのキャラクター／カスタム画像を、未設定やデコード失敗時は既定キャラクターの Quill を出す。
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

  return (
    <ResolvedCharacterAvatar
      resolved={resolved}
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
