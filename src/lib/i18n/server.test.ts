import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ preference: undefined as string | undefined, language: null as string | null, country: null as string | null }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => mocks.preference === undefined ? undefined : { value: mocks.preference } }),
  headers: async () => ({ get: (name: string) => name === "accept-language" ? mocks.language : mocks.country }),
}));

import { getLocaleState } from "./server";

beforeEach(() => { mocks.preference = undefined; mocks.language = null; mocks.country = null; });

describe("request language state", () => {
  it("reads the saved cookie before the browser language", async () => {
    mocks.preference = "zh";
    mocks.language = "ja";
    expect(await getLocaleState()).toEqual({ locale: "zh", preference: "zh" });
  });

  it("returns to browser detection after removing the preference cookie", async () => {
    mocks.language = "ja-JP";
    expect(await getLocaleState()).toEqual({ locale: "ja", preference: "auto" });
  });

  it("uses the hosting country when browser languages are unsupported", async () => {
    mocks.preference = "invalid";
    mocks.language = "fr";
    mocks.country = "JP";
    expect(await getLocaleState()).toEqual({ locale: "ja", preference: "auto" });
  });
});
