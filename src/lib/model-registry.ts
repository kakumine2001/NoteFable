import {
  BUILTIN_REGISTRY,
  MODEL_OPTIONS,
  REASONING_EFFORTS,
  type ModelOption,
  type ModelProvider,
  type ModelRegistry,
} from "@/lib/models";
import { optionalEnv } from "@/lib/env";

// 「今どのモデルが使えるか」を決めるのはサーバーだけ。ここで環境変数 NOTEFABLE_MODELS を読み、画面（Web・Android）へは
// その結果を渡す。環境変数が無ければ src/lib/models.ts の組み込み一覧をそのまま使う。
//
// NOTEFABLE_MODELS は JSON の配列で、書いたモデルだけが使える（書かなかった組み込みモデルは無効）。順番がそのまま選択肢の順。
//   組み込みと同じ id → 組み込みの設定を土台に、書いた項目だけ上書き。例: {"id":"gpt-6-luna","label":"GPT-6","upstreamModel":"gpt-6-2026-11"}
//   新しい id        → 全項目を書く（provider は openai / anthropic / deepseek のどれか。接続先のコードは provider ごとに決まっている）。
//   "enabled": false で一時的に外せる。先頭の有効なモデルが既定。
// 読めない・不正な内容のときはログに出して組み込みの一覧へ戻る（設定ミスで本番のモデル選択を壊さない）。

const PROVIDERS: readonly ModelProvider[] = ["openai", "anthropic", "deepseek"];

type Entry = Record<string, unknown>;

// 送信コードと保存形式はプロバイダーごとに決まっているので、推論強度は同じプロバイダーの組み込みモデルが
// 使っている値だけを認める（例: "minimal" は保存できず、Claude は "none" を受け付けない）。
function allowedEfforts(provider: ModelProvider) {
  return new Set(MODEL_OPTIONS.filter((option) => option.provider === provider).flatMap((option) => option.reasoningEfforts));
}

function asTokenLimits(value: unknown, id: string): NonNullable<ModelOption["tokenLimits"]> {
  const limits = value as { contextWindow?: unknown; maxOutputTokens?: unknown } | null;
  const valid = (count: unknown) => Number.isSafeInteger(count) && (count as number) > 0;
  if (!limits || typeof limits !== "object" || !valid(limits.contextWindow) || !valid(limits.maxOutputTokens)) {
    throw new Error(`${id}: "tokenLimits" needs positive integers "contextWindow" and "maxOutputTokens"`);
  }
  return { contextWindow: limits.contextWindow as number, maxOutputTokens: limits.maxOutputTokens as number };
}

function asString(value: unknown, field: string, id: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${id}: "${field}" must be a non-empty string`);
  return value.trim();
}

function asBoolean(value: unknown, field: string, id: string) {
  if (typeof value !== "boolean") throw new Error(`${id}: "${field}" must be true or false`);
  return value;
}

function resolveEntry(entry: Entry): ModelOption | null {
  const id = asString(entry.id, "id", String(entry.id));
  if (entry.enabled === false) return null;

  const builtin = MODEL_OPTIONS.find((option) => option.id === id);
  const next: Partial<ModelOption> = builtin ? { ...builtin } : {};

  if ("label" in entry) next.label = asString(entry.label, "label", id);
  if ("upstreamModel" in entry) next.upstreamModel = asString(entry.upstreamModel, "upstreamModel", id);
  if ("provider" in entry) {
    if (!PROVIDERS.includes(entry.provider as ModelProvider)) throw new Error(`${id}: "provider" must be one of ${PROVIDERS.join(", ")}`);
    next.provider = entry.provider as ModelProvider;
  }
  for (const flag of ["supportsImageInput", "supportsWebSearch", "supportsCompaction", "supportsPageTools"] as const) {
    if (flag in entry) next[flag] = asBoolean(entry[flag], flag, id);
  }
  if ("reasoningEfforts" in entry) {
    const efforts = entry.reasoningEfforts;
    if (!Array.isArray(efforts) || !efforts.length || !efforts.every((effort) => REASONING_EFFORTS.includes(effort as never))) {
      throw new Error(`${id}: "reasoningEfforts" must be a non-empty list of ${REASONING_EFFORTS.join(", ")}`);
    }
    next.reasoningEfforts = efforts as ModelOption["reasoningEfforts"];
  }
  if ("defaultReasoning" in entry) {
    if (!REASONING_EFFORTS.includes(entry.defaultReasoning as never)) throw new Error(`${id}: invalid "defaultReasoning"`);
    next.defaultReasoning = entry.defaultReasoning as ModelOption["defaultReasoning"];
  }
  if ("tokenLimits" in entry) next.tokenLimits = asTokenLimits(entry.tokenLimits, id);

  // 新しい id は全項目が必要。組み込みの id でも、推論強度の既定が選べる範囲に入っていなければ不正。
  const required = ["label", "provider", "supportsImageInput", "supportsWebSearch", "supportsCompaction", "supportsPageTools", "reasoningEfforts", "defaultReasoning"] as const;
  for (const field of required) {
    if (next[field] === undefined) throw new Error(`${id}: "${field}" is required for a new model`);
  }
  if (!next.reasoningEfforts!.includes(next.defaultReasoning!)) throw new Error(`${id}: "defaultReasoning" is not in "reasoningEfforts"`);
  const allowed = allowedEfforts(next.provider!);
  const unsupported = next.reasoningEfforts!.filter((effort) => !allowed.has(effort));
  if (unsupported.length) throw new Error(`${id}: ${next.provider} does not support reasoning ${unsupported.join(", ")}`);
  return { ...(next as ModelOption), id };
}

export function parseModelRegistry(raw: string | undefined): ModelRegistry {
  if (!raw?.trim()) return BUILTIN_REGISTRY;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("must be a JSON array");
    const options: ModelOption[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") throw new Error("every entry must be an object");
      const option = resolveEntry(entry as Entry);
      if (option && !options.some((existing) => existing.id === option.id)) options.push(option);
    }
    if (!options.length) throw new Error("no enabled model");
    return { options, defaultModel: options[0].id };
  } catch (error) {
    console.error("NOTEFABLE_MODELS ignored, using the built-in model list:", error instanceof Error ? error.message : error);
    return BUILTIN_REGISTRY;
  }
}

let cached: { raw: string | undefined; registry: ModelRegistry } | null = null;

// サーバー側の唯一の入口。環境変数が変わらない間は同じ結果を返す。
export function getModelRegistry(): ModelRegistry {
  const raw = process.env.NOTEFABLE_MODELS;
  if (!cached || cached.raw !== raw) cached = { raw, registry: parseModelRegistry(raw) };
  return cached.registry;
}

// 画面に渡してよい項目だけ（上流のモデル名やトークン上限はサーバー内部の情報）。
export function publicModels(registry: ModelRegistry = getModelRegistry()) {
  return {
    defaultModel: registry.defaultModel,
    models: registry.options.map((model) => ({
      id: model.id,
      label: model.label,
      provider: model.provider,
      supportsImageInput: model.supportsImageInput,
      supportsWebSearch: model.supportsWebSearch,
      reasoningEfforts: model.reasoningEfforts,
      defaultReasoning: model.defaultReasoning,
    })),
  };
}

export type PublicModels = ReturnType<typeof publicModels>;

// UI 上のモデル ID と、実際に上流 API へ投げるモデル名を分離する。NOTEFABLE_MODELS の upstreamModel が最優先、
// 次に組み込みモデルの従来の環境変数、なければ ID のまま。
export function upstreamModelFor(model: string, options: readonly ModelOption[]) {
  const configured = options.find((option) => option.id === model)?.upstreamModel;
  if (configured) return configured;
  if (model === "gpt-6-luna") return optionalEnv("OPENAI_TEXT_MODEL") || model;
  if (model === "deepseek-flash") return optionalEnv("DEEPSEEK_FLASH_MODEL") || model;
  if (model === "claude-haiku-5-5") return optionalEnv("ANTHROPIC_HAIKU_MODEL") || model;
  return model;
}
