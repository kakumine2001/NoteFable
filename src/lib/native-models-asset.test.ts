import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { nativeModelsPayload } from "@/lib/native-models";

describe("native models asset", () => {
  it("matches src/lib/models.ts (regenerate with scripts/gen-native-models.ts)", () => {
    const asset = JSON.parse(readFileSync("mobile/native/app/src/main/assets/models.json", "utf8"));
    expect(asset).toEqual(nativeModelsPayload());
  });
});
