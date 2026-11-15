import { describe, expect, it } from "vitest";
import { localeSyncAction, type LocaleSyncInput } from "./locale-sync";

const base: LocaleSyncInput = { loaded: true, configured: true, signedIn: true, saved: null, preference: "auto" };

describe("localeSyncAction", () => {
  it("does nothing until the account is known, or when sign-in is not set up", () => {
    expect(localeSyncAction({ ...base, loaded: false, preference: "ja" })).toBeNull();
    expect(localeSyncAction({ ...base, configured: false, signedIn: false, preference: "ja" })).toBeNull();
  });

  it("shows the environment language to signed-out visitors and drops an old choice", () => {
    expect(localeSyncAction({ ...base, signedIn: false, preference: "ja" })).toEqual({ kind: "switch", to: "auto" });
    expect(localeSyncAction({ ...base, signedIn: false, preference: "auto" })).toBeNull();
  });

  it("follows the language saved on the account", () => {
    expect(localeSyncAction({ ...base, saved: "zh", preference: "auto" })).toEqual({ kind: "switch", to: "zh" });
    expect(localeSyncAction({ ...base, saved: "zh", preference: "ja" })).toEqual({ kind: "switch", to: "zh" });
    expect(localeSyncAction({ ...base, saved: "zh", preference: "zh" })).toBeNull();
  });

  it("saves this browser's earlier choice when the account has none", () => {
    expect(localeSyncAction({ ...base, saved: null, preference: "ja" })).toEqual({ kind: "save", locale: "ja" });
    expect(localeSyncAction({ ...base, saved: null, preference: "auto" })).toBeNull();
  });

  it("never overwrites the account when its saved language could not be read", () => {
    expect(localeSyncAction({ ...base, saved: undefined, preference: "ja" })).toBeNull();
  });
});
