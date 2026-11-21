import { describe, expect, it } from "vitest";
import { settingsButtonStep, settingsDismissStep } from "@/lib/settings-navigation";

describe("settings navigation", () => {
  const idle = { locked: false, editorIn: null, onPage: false, dirty: false } as const;

  it("Esc / Back goes one step at a time: page -> home list -> closed", () => {
    expect(settingsDismissStep({ ...idle, onPage: true })).toEqual({ type: "home" });
    expect(settingsDismissStep(idle)).toEqual({ type: "close" });
  });

  it("Esc / Back first closes an open photo or emoji editor and shows its page", () => {
    expect(settingsDismissStep({ ...idle, editorIn: "account" })).toEqual({ type: "show", tab: "account", attention: false });
    expect(settingsDismissStep({ ...idle, onPage: true, editorIn: "general" })).toEqual({ type: "show", tab: "general", attention: false });
  });

  it("unsaved custom instructions keep the user on Personalization, on a page and on the home list", () => {
    const shake = { type: "show", tab: "personalization", attention: true };
    expect(settingsDismissStep({ ...idle, onPage: true, dirty: true })).toEqual(shake);
    expect(settingsDismissStep({ ...idle, dirty: true })).toEqual(shake);
    expect(settingsButtonStep({ locked: false, photoBusy: false, onPage: true, dirty: true })).toEqual(shake);
    expect(settingsButtonStep({ locked: false, photoBusy: false, onPage: false, dirty: true })).toEqual(shake);
  });

  it("does nothing while a save or delete is running", () => {
    expect(settingsDismissStep({ locked: true, editorIn: "account", onPage: true, dirty: true })).toEqual({ type: "stay" });
    expect(settingsButtonStep({ locked: true, photoBusy: true, onPage: true, dirty: true })).toEqual({ type: "stay" });
  });

  it("the bar button goes home from a page and closes from the home list", () => {
    expect(settingsButtonStep({ locked: false, photoBusy: false, onPage: true, dirty: false })).toEqual({ type: "home" });
    expect(settingsButtonStep({ locked: false, photoBusy: false, onPage: false, dirty: false })).toEqual({ type: "close" });
  });

  it("a photo being cropped or uploaded shows the Account page instead of leaving, before the unsaved check", () => {
    const account = { type: "show", tab: "account", attention: false };
    expect(settingsButtonStep({ locked: false, photoBusy: true, onPage: true, dirty: false })).toEqual(account);
    expect(settingsButtonStep({ locked: false, photoBusy: true, onPage: false, dirty: true })).toEqual(account);
  });
});
