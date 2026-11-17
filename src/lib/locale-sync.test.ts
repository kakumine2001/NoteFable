import { describe, expect, it } from "vitest";
import { localeSyncAction, type LocaleSyncInput } from "./locale-sync";

const base: LocaleSyncInput = {
  loaded: true, configured: true, signedIn: true, saved: null, preference: "auto", active: "en", target: null,
};

describe("localeSyncAction", () => {
  it("does nothing until the account is known, or when sign-in is not set up", () => {
    expect(localeSyncAction({ ...base, loaded: false, preference: "ja" })).toBeNull();
    expect(localeSyncAction({ ...base, configured: false, signedIn: false, preference: "ja" })).toBeNull();
  });

  it("keeps a signed-out visitor's own choice", () => {
    expect(localeSyncAction({ ...base, signedIn: false, preference: "ja", active: "ja" })).toBeNull();
    expect(localeSyncAction({ ...base, signedIn: false, preference: "auto" })).toBeNull();
  });

  it("follows the language saved on the account", () => {
    expect(localeSyncAction({ ...base, saved: "zh", preference: "auto" })).toEqual({ kind: "switch", to: "zh" });
    expect(localeSyncAction({ ...base, saved: "zh", preference: "ja", active: "ja" })).toEqual({ kind: "switch", to: "zh" });
    expect(localeSyncAction({ ...base, saved: "zh", preference: "zh", active: "zh" })).toBeNull();
    expect(localeSyncAction({ ...base, saved: "zh", preference: "zh", active: "en", target: "zh" })).toBeNull();
  });

  it("corrects this tab when its display differs from the cookie", () => {
    // 他のタブが Cookie を ja にした後、このタブ（zh 表示）のアカウントが ja になった。
    expect(localeSyncAction({ ...base, saved: "ja", preference: "ja", active: "zh" })).toEqual({ kind: "switch", to: "ja" });
  });

  it("goes back when a choice is rejected before its dictionary arrives", () => {
    // zh の利用者が ja を選び、辞書の取得中に保存が失敗して zh に戻った。
    expect(localeSyncAction({ ...base, saved: "zh", preference: "zh", active: "zh", target: "ja" })).toEqual({ kind: "switch", to: "zh" });
    // 初めての選択（ja）が失敗して未選択に戻った。表示は ja になっていても、取得中でも、環境の言語に戻す。
    expect(localeSyncAction({ ...base, preference: "ja", active: "ja" })).toEqual({ kind: "switch", to: "auto" });
    expect(localeSyncAction({ ...base, preference: "auto", target: "ja" })).toEqual({ kind: "switch", to: "auto" });
  });

  it("treats account Auto as authoritative on every device, even with an old local choice", () => {
    expect(localeSyncAction({ ...base, preference: "ja", active: "ja" })).toEqual({ kind: "switch", to: "auto" });
    expect(localeSyncAction({ ...base, preference: "auto", active: "ja" })).toBeNull();
    expect(localeSyncAction({ ...base, preference: "ja", target: "auto" })).toBeNull();
    expect(localeSyncAction({ ...base, preference: "auto", target: "ja" })).toEqual({ kind: "switch", to: "auto" });
  });

  it("never overwrites the account when its saved language could not be read", () => {
    expect(localeSyncAction({ ...base, saved: undefined, preference: "ja" })).toBeNull();
  });
});
