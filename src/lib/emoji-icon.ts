// 絵文字 1 つ分（肌色や ZWJ 結合を含む）だけを許可する。Notes とチャットのアイコンで共有する。
export function isEmojiIcon(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 64 || /\s/.test(value)) return false;
  // 書記素クラスタ 1 つだけ（「📚abc」や「📚📚」は不可、国旗や ZWJ 結合は可）。
  const clusters = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)];
  return clusters.length === 1 && /^(\p{Extended_Pictographic}|\p{Regional_Indicator}{2}|[0-9#*]\uFE0F?\u20E3)/u.test(value);
}
