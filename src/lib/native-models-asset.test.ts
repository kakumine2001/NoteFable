import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { publicModels } from "@/lib/model-registry";
import { BUILTIN_REGISTRY } from "@/lib/models";

describe("native models asset", () => {
  it("matches src/lib/models.ts (regenerate with scripts/gen-native-models.ts)", () => {
    const asset = JSON.parse(readFileSync("mobile/android/app/src/main/assets/models.json", "utf8"));
    // 打包的后备列表只跟内置模型走，不受部署环境的 STUDYMATE_MODELS 影响。
    expect(asset).toEqual(publicModels(BUILTIN_REGISTRY));
  });
});
