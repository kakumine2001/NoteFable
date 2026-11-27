import { describe, expect, it, vi } from "vitest";
import { createLocaleSwitcher } from "./locale-switch";
import type { Locale, LocalePreference } from "./i18n/locale";

function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<unknown>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup() {
  let locale: Locale = "en";
  let preference: LocalePreference = "en";
  const requests: Array<ReturnType<typeof deferred> & { signal: AbortSignal }> = [];
  const error = vi.fn();
  const pending = vi.fn();
  const commit = vi.fn((next: LocalePreference, dictionary?: { locale: Locale }) => {
    preference = next;
    if (dictionary) locale = dictionary.locale;
  });
  const switcher = createLocaleSwitcher({ locale, pending, error, commit }, async (_next, signal) => {
    const request = { ...deferred(), signal }; requests.push(request); return request.promise;
  });
  return { switcher, requests, commit, error, pending, current: () => ({ locale, preference }) };
}
describe("in-place locale switches", () => {
  it("commits Auto only after its dictionary arrives", async () => {
    const s = setup();
    const run = s.switcher.choose("auto");
    expect(s.current()).toEqual({ locale: "en", preference: "en" });
    s.requests[0].resolve({ locale: "ja", messages: {} });
    await expect(run).resolves.toBe(true);
    expect(s.current()).toEqual({ locale: "ja", preference: "auto" });
  });
  it("keeps the old preference and dictionary on failure and supports retry", async () => {
    const s = setup();
    const first = s.switcher.choose("auto");
    s.requests[0].reject(new Error("offline"));
    await expect(first).resolves.toBe(false);
    expect(s.commit).not.toHaveBeenCalled();
    expect(s.error).toHaveBeenLastCalledWith("Could not change language. Please try again.", "auto");
    const retry = s.switcher.choose("auto");
    s.requests[1].resolve({ locale: "zh-Hant", messages: { Language: "語言" } });
    await expect(retry).resolves.toBe(true);
    expect(s.current()).toEqual({ locale: "zh-Hant", preference: "auto" });
    expect(s.error).toHaveBeenLastCalledWith("", null);
  });
  it("gives the latest switch priority even if an aborted request still resolves", async () => {
    const s = setup();
    const older = s.switcher.choose("ja");
    const newer = s.switcher.choose("auto");
    expect(s.requests[0].signal.aborted).toBe(true);
    s.requests[1].resolve({ locale: "zh", messages: {} });
    await newer;
    s.requests[0].resolve({ locale: "ja", messages: {} });
    await expect(older).resolves.toBe(false);
    expect(s.current()).toEqual({ locale: "zh", preference: "auto" });
    expect(s.commit).toHaveBeenCalledTimes(1);
  });
  it("cancels on logout without restoring the cleared cookie later", async () => {
    const s = setup();
    const run = s.switcher.choose("ja");
    s.switcher.cancel();
    s.requests[0].resolve({ locale: "ja", messages: {} });
    await expect(run).resolves.toBe(false);
    expect(s.commit).not.toHaveBeenCalled();
    expect(s.pending).toHaveBeenLastCalledWith(null);
  });
  it.each([null, { locale: "zh", messages: {} }, { locale: "ko", messages: {} }, { locale: "ja", messages: [] }, { locale: "ja", messages: { invalid: 4 } }])("rejects malformed dictionary %j", async (data) => {
    const s = setup();
    const run = s.switcher.choose("ja");
    s.requests[0].resolve(data);
    await expect(run).resolves.toBe(false);
    expect(s.commit).not.toHaveBeenCalled();
  });
  it("pins the current language without refetching and aborts an older switch", async () => {
    const s = setup();
    const old = s.switcher.choose("ja");
    await expect(s.switcher.choose("en")).resolves.toBe(true);
    expect(s.requests).toHaveLength(1);
    s.requests[0].resolve({ locale: "ja", messages: {} });
    await expect(old).resolves.toBe(false);
    expect(s.current()).toEqual({ locale: "en", preference: "en" });
  });
});
