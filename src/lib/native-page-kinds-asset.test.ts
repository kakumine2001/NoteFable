import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PAGE_KIND_FEATURES } from "@/lib/page-kinds";

describe("native page kinds asset", () => {
  it("matches PAGE_KIND_FEATURES (regenerate with scripts/gen-native-page-kinds.ts)", () => {
    // Android / iOS は服務端の kinds が届くまでこの表を使う。開関（editor）を変えたら作り直す。
    const asset = JSON.parse(readFileSync("mobile/android/app/src/main/assets/page-kinds.json", "utf8"));
    expect(asset).toEqual(PAGE_KIND_FEATURES);
  });
});
