import { DEFAULT_MODEL, MODEL_OPTIONS } from "@/lib/models";

// 网页、接口与安装包共用 models.ts；只投影客户端所需字段，内部限制留在服务端。
export function nativeModelsPayload() {
  return {
    defaultModel: DEFAULT_MODEL,
    models: MODEL_OPTIONS.map((model) => ({
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
