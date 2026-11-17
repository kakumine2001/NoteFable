// NoteFable のキャラクター：角を折ったノートに目が二つ。ロゴ・アプリアイコン・空の会話の絵はすべてこの形を使う
// （Android は ui/Lucide.kt の BrandMark、public/icon.svg も同じパス）。
export const MASCOT_BODY = "M21 9h13.5a1.5 1.5 0 0 1 1.5 1.5v12a4 4 0 0 0 4 4h11.5a1.5 1.5 0 0 1 1.5 1.5V46a9 9 0 0 1-9 9H20a9 9 0 0 1-9-9V19A10 10 0 0 1 21 9Z";
export const MASCOT_FLAP = "M39.5 12.4c0-1.3 1.6-2 2.6-1.1l9.6 9.6c.9 1 .3 2.6-1.1 2.6H42a2.5 2.5 0 0 1-2.5-2.5Z";
// 目は幅 5・高さ 9 の丸い縦長。ロゴでは体からくり抜く。
export const MASCOT_EYES = [22.5, 36.5] as const;
const EYE_HOLES = MASCOT_EYES.map((x) => `M${x} 35.5a2.5 2.5 0 0 1 5 0v4a2.5 2.5 0 0 1-5 0Z`).join("");

// ロゴマーク。一色（currentColor）で、紹介ページ・ワークスペース・回答のラベルに使う。
export function BrandMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="8 6 48 52" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d={MASCOT_BODY + EYE_HOLES} />
      <path d={MASCOT_FLAP} />
    </svg>
  );
}
