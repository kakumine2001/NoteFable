// 画面初期表示と不正値フォールバックで使う標準モデル。
export const DEFAULT_MODEL = "gpt-5.6-sol";

// UI と API が受け付ける推論強度の一覧。as const にして型にも利用する。
export const REASONING_EFFORTS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];
// モデルをどの上流 API へ送るかを表す分類。
export type ModelProvider = "openai" | "deepseek";

type ModelOption = {
  // フロントエンドと API 間でやり取りする内部 ID。
  id: string;
  // UI に表示するモデル名。
  label: string;
  // 実際に呼び出すプロバイダー。ストリーム解析の分岐にも使う。
  provider: ModelProvider;
  // 画像添付をモデル入力として扱えるかどうか。
  supportsImageInput: boolean;
  // 画像生成モードを利用できるかどうか。
  supportsImageGeneration: boolean;
  // Web 検索を利用できるかどうか。OpenAIとDeepSeekは各Responses APIの組み込み検索を使う。
  supportsWebSearch: boolean;
  // このモデルで選べる推論強度。
  reasoningEfforts: readonly ReasoningEffort[];
  // 推論強度が未指定または非対応値だった場合の初期値。
  defaultReasoning: ReasoningEffort;
};

// StudyMate で選択可能なモデル定義。UI 表示と API 側の検証で同じ配列を使う。
// 表示名はここに固定で書き、環境変数では上書きしない。
export const MODEL_OPTIONS: readonly ModelOption[] = [
  {
    id: "gpt-5.6-sol",
    label: "GPT-5.6 Sol",
    provider: "openai",
    supportsImageInput: true,
    supportsImageGeneration: true,
    supportsWebSearch: true,
    reasoningEfforts: ["none", "low", "medium", "high", "xhigh", "max"],
    defaultReasoning: "medium",
  },
  {
    // DeepSeek の現行モデル名。上流も同じ名前を受け付ける。
    id: "deepseek-flash",
    label: "DeepSeek-V4.1-Flash",
    provider: "deepseek",
    supportsImageInput: true,
    supportsImageGeneration: false,
    supportsWebSearch: true,
    // 推論強度は low / high / max に対応し、既定値は high。
    reasoningEfforts: ["low", "high", "max"],
    defaultReasoning: "high",
  },
] as const;

// 許可済みモデル ID だけを取り出した一覧。クライアント入力の正規化に使う。
export const AVAILABLE_MODELS = MODEL_OPTIONS.map((model) => model.id);

export type ModelId = (typeof AVAILABLE_MODELS)[number];

export function getModelOption(model: string) {
  // 未知のモデル ID が来た場合は先頭の標準モデルへ倒し、呼び出し側の undefined 分岐を減らす。
  return MODEL_OPTIONS.find((option) => option.id === model) ?? MODEL_OPTIONS[0];
}

export function normalizeModel(value: FormDataEntryValue | null) {
  // FormData から来る値は File の可能性もあるため、文字列だけをモデル ID として扱う。
  const model = typeof value === "string" ? value : DEFAULT_MODEL;
  return AVAILABLE_MODELS.includes(model as ModelId)
    ? model
    : DEFAULT_MODEL;
}

export function normalizeReasoning(value: FormDataEntryValue | null, model = DEFAULT_MODEL) {
  // 推論強度はモデルごとに対応範囲が違うため、先にモデル設定を取得する。
  const option = getModelOption(model);
  // 未指定ならそのモデルのデフォルト推論強度を使う。
  const effort = typeof value === "string" ? value : option.defaultReasoning;
  return option.reasoningEfforts.includes(effort as ReasoningEffort)
    ? (effort as ReasoningEffort)
    : option.defaultReasoning;
}

export function toDbReasoning(effort: ReasoningEffort) {
  // Prisma の enum は大文字なので、UI/API の小文字表現から変換する。
  return effort.toUpperCase() as "NONE" | "LOW" | "MEDIUM" | "HIGH" | "XHIGH" | "MAX";
}
