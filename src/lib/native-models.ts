import { publicModels } from "@/lib/model-registry";

// 原生 App 与网页共用的模型一览。服务器决定现在能用哪些（NOTEFABLE_MODELS，没设置就用内置列表）；
// 只投影客户端所需字段，内部限制留在服务端。
export function nativeModelsPayload() {
  return publicModels();
}
