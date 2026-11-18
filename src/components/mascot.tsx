"use client";

import { CharacterGraphic } from "@/components/character-avatar";
import { useResolvedAppIcon } from "@/lib/app-icon";
import type { CharacterState } from "@/lib/characters";

// 空の会話に出すメインの AI キャラクター（設定で選んだキャラクター、またはカスタム画像；未設定なら既定の Quill）。
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

  if (resolved.kind === "image") {
    return (
      <span className="nf-mascot-custom-wrap" style={{ width: size, height: size * 1.0625 }} aria-hidden="true">
        {/* data URL のカスタムアイコンなので next/image の最適化は通さない。カスタム画像は静止表示。 */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="nf-mascot-custom" src={resolved.dataUrl} alt="" width={size} height={size} draggable={false} />
      </span>
    );
  }

  return (
    <CharacterGraphic
      characterId={resolved.characterId}
      size={size}
      state={effectiveState}
      hero
      animated
      className="nf-mascot"
    />
  );
}
