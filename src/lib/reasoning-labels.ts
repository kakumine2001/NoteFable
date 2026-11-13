import { msg } from "@/lib/i18n/translate";

// 推論強度の短い表示名。ピルの中、メニュー、スマホのシートで共通利用する。
export const reasoningLabels: Record<string, string> = {
  none: msg("None"),
  low: msg("Low"),
  medium: msg("Medium"),
  high: msg("High"),
  xhigh: msg("XHigh"),
  max: msg("Max"),
};

// 各推論強度の補足説明。スライダーのアクセシブル名、ツールチップ、スマホのシートの説明文に使う。
export const reasoningDescriptions: Record<string, string> = {
  none: msg("No reasoning"),
  low: msg("Light reasoning"),
  medium: msg("Balanced for most tasks"),
  high: msg("Better for complex work"),
  xhigh: msg("Very deep reasoning"),
  max: msg("Maximum reasoning depth"),
};
