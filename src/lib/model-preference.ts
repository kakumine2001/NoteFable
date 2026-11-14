// 最後に選んだモデルと推論強度を、このブラウザに覚えておく。次に開いたときも同じ選択から始めるため。
// 使えるモデルの一覧はサーバーが決めるので、読み出した値は呼び出し側が今の一覧と照らして確かめる。
const KEY = "studymate:model-preference";

export type ModelPreference = { model: string; reasoning: string };

export function readModelPreference(): ModelPreference | null {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? "null");
    if (!value || typeof value !== "object") return null;
    const { model, reasoning } = value as Partial<ModelPreference>;
    return typeof model === "string" && typeof reasoning === "string" ? { model, reasoning } : null;
  } catch {
    return null;
  }
}

export function saveModelPreference(preference: ModelPreference) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(preference));
  } catch {
    // 保存できなくても（プライベートブラウズなど）選択そのものは今の画面で有効。
  }
}

// 保存値を、いまサーバーが出している一覧に照らす。無いモデルは使わず（null）、そのモデルで選べない強度は標準に置き換える。
export function resolveModelPreference(
  saved: ModelPreference | null,
  options: readonly { id: string; reasoningEfforts: readonly string[]; defaultReasoning: string }[],
): ModelPreference | null {
  const option = saved && options.find((item) => item.id === saved.model);
  if (!saved || !option) return null;
  return { model: option.id, reasoning: option.reasoningEfforts.includes(saved.reasoning) ? saved.reasoning : option.defaultReasoning };
}
