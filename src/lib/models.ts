export const DEFAULT_MODEL = "gpt-5.5";

export const REASONING_EFFORTS = [
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];
export type ModelProvider = "openai" | "deepseek";

type ModelOption = {
  id: string;
  label: string;
  provider: ModelProvider;
  supportsImageInput: boolean;
  supportsImageGeneration: boolean;
  reasoningEfforts: readonly ReasoningEffort[];
  defaultReasoning: ReasoningEffort;
};

export const MODEL_OPTIONS: readonly ModelOption[] = [
  {
    id: "gpt-5.5",
    label: "GPT-5.5",
    provider: "openai",
    supportsImageInput: true,
    supportsImageGeneration: true,
    reasoningEfforts: ["low", "medium", "high", "xhigh"],
    defaultReasoning: "medium",
  },
  {
    id: "deepseek-v4-flash",
    label: "DeepSeek-V4-Flash",
    provider: "deepseek",
    supportsImageInput: false,
    supportsImageGeneration: false,
    reasoningEfforts: ["high", "xhigh"],
    defaultReasoning: "high",
  },
  {
    id: "deepseek-v4-pro",
    label: "DeepSeek-V4-Pro",
    provider: "deepseek",
    supportsImageInput: false,
    supportsImageGeneration: false,
    reasoningEfforts: ["high", "xhigh"],
    defaultReasoning: "high",
  },
] as const;

export const AVAILABLE_MODELS = MODEL_OPTIONS.map((model) => model.id);

export type ModelId = (typeof AVAILABLE_MODELS)[number];

export function getModelOption(model: string) {
  return MODEL_OPTIONS.find((option) => option.id === model) ?? MODEL_OPTIONS[0];
}

export function normalizeModel(value: FormDataEntryValue | null) {
  const model = typeof value === "string" ? value : DEFAULT_MODEL;
  return AVAILABLE_MODELS.includes(model as ModelId)
    ? model
    : DEFAULT_MODEL;
}

export function normalizeReasoning(value: FormDataEntryValue | null, model = DEFAULT_MODEL) {
  const option = getModelOption(model);
  const effort = typeof value === "string" ? value : "xhigh";
  return option.reasoningEfforts.includes(effort as ReasoningEffort)
    ? (effort as ReasoningEffort)
    : option.defaultReasoning;
}

export function toDbReasoning(effort: ReasoningEffort) {
  return effort.toUpperCase() as "LOW" | "MEDIUM" | "HIGH" | "XHIGH";
}
