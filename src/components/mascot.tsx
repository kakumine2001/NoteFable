"use client";

import { ResolvedCharacterAvatar } from "@/components/character-avatar";
import { useResolvedAppIcon } from "@/lib/app-icon";
import type { CharacterState } from "@/lib/characters";

// 空の会話に出すメインの AI キャラクター（設定で選んだキャラクター、またはカスタム画像；未設定やデコード失敗時は既定の Quill）。
// state が渡されない場合は従来の lookDown 互換（true -> typing, false -> idle）として動く。
export function Mascot({
  size = 64,
  lookDown = false,
  state,
}: {
  size?: number;
  lookDown?: boolean;
  state?: CharacterState;
}) {
  const resolved = useResolvedAppIcon();
  const effectiveState: CharacterState = state ?? (lookDown ? "typing" : "idle");

  return (
    <ResolvedCharacterAvatar
      resolved={resolved}
      size={size}
      state={effectiveState}
      hero
      animated
      className="nf-mascot"
    />
  );
}
