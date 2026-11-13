import { NextResponse } from "next/server";
import { DEFAULT_MODEL, MODEL_OPTIONS } from "@/lib/models";

// 原生 App 启动时读取可选模型。模型、能力和推理强度只在 src/lib/models.ts 维护，这里只做只读投影。
// 不包含任何密钥，也不依赖用户身份，可以被缓存。
export function GET() {
  return NextResponse.json(
    {
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
    },
    { headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=3600" } },
  );
}
