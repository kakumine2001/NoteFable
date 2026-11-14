import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { USAGE_LIMITS } from "@/lib/usage-plans";

describe("native usage limits asset", () => {
  it("matches src/lib/usage-plans.ts (regenerate with scripts/gen-native-usage-limits.ts)", () => {
    const asset = JSON.parse(readFileSync("mobile/android/app/src/main/assets/usage-limits.json", "utf8"));
    expect(asset).toEqual(USAGE_LIMITS);
  });
});
