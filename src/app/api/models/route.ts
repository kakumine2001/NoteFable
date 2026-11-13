import { NextResponse } from "next/server";
import { nativeModelsPayload } from "@/lib/native-models";

// 原生 App 启动时读取可选模型。模型、能力和推理强度只在 src/lib/models.ts 维护，这里只做只读投影。
// 不包含任何密钥，也不依赖用户身份，可以被缓存。
export function GET() {
  return NextResponse.json(nativeModelsPayload(), {
    headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=3600" },
  });
}
