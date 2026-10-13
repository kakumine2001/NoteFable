// 推論強度の短い表示名。ピルの中、メニュー、スマホのシートで共通利用する。
export const reasoningLabels: Record<string, string> = {
  none: "None",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "XHigh",
  max: "Max",
};

// 各推論強度の補足説明。スライダーのアクセシブル名、ツールチップ、スマホのシートの説明文に使う。
export const reasoningDescriptions: Record<string, string> = {
  none: "No reasoning",
  low: "Light reasoning",
  medium: "Balanced for most tasks",
  high: "Better for complex work",
  xhigh: "Very deep reasoning",
  max: "Maximum reasoning depth",
};
