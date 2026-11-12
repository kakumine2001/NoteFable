import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  effects: [] as (() => void)[],
  isNativeApp: vi.fn(),
}));

vi.mock("react", () => ({
  useEffect: (effect: () => void) => { mocks.effects.push(effect); },
}));
vi.mock("@/lib/native-app", () => ({ isNativeApp: mocks.isNativeApp }));

import { LandingNativeRedirect } from "./landing-native-redirect";

beforeEach(() => {
  mocks.effects.length = 0;
  mocks.isNativeApp.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("landing native entry", () => {
  it("leaves an ordinary browser on the introduction page", () => {
    const replace = vi.fn();
    vi.stubGlobal("window", { location: { search: "?utm_source=bookmark", hash: "#tour", replace } });
    mocks.isNativeApp.mockReturnValue(false);

    expect(LandingNativeRedirect()).toBeNull();
    expect(mocks.isNativeApp).not.toHaveBeenCalled();
    expect(mocks.effects).toHaveLength(1);
    mocks.effects[0]();

    expect(replace).not.toHaveBeenCalled();
  });

  it.each([
    { search: "?source=android&label=%E4%B8%AD%E6%96%87", hash: "#keep", expected: "/app?source=android&label=%E4%B8%AD%E6%96%87#keep" },
    { search: "", hash: "", expected: "/app" },
  ])("replaces native startup history while retaining $search$hash", ({ search, hash, expected }) => {
    const replace = vi.fn();
    vi.stubGlobal("window", { location: { search, hash, replace } });
    mocks.isNativeApp.mockReturnValue(true);

    expect(LandingNativeRedirect()).toBeNull();
    expect(replace).not.toHaveBeenCalled();
    mocks.effects[0]();

    expect(replace).toHaveBeenCalledExactlyOnceWith(expected);
  });
});
