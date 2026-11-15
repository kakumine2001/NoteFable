import { describe, expect, it, vi } from "vitest";
import type { NotePage } from "@/types/notes";
import { createEmbedApi, installEmbedApi, pageMeta, parseAppIcon, parsePageSettings, parseUpdatedPage, postToNative, readNativeAppIcon, toEmbedSaveState, type NativeMessage } from "./native-bridge";

describe("readNativeAppIcon", () => {
  const postMessage = () => {};

  it("reads the icon chosen in the app", () => {
    expect(readNativeAppIcon({ NoteFableNative: { postMessage, appIcon: () => "🦊" } })).toBe("🦊");
    expect(readNativeAppIcon({ NoteFableNative: { postMessage, appIcon: () => "data:image/png;base64,AAAA" } })).toBe("data:image/png;base64,AAAA");
  });

  it("returns the default logo for an empty or unreadable value", () => {
    expect(readNativeAppIcon({ NoteFableNative: { postMessage, appIcon: () => "" } })).toBeNull();
    expect(readNativeAppIcon({ NoteFableNative: { postMessage, appIcon: () => "not an icon" } })).toBeNull();
  });

  it("leaves the stored icon alone outside the app and in apps that do not pass one", () => {
    expect(readNativeAppIcon(undefined)).toBeUndefined();
    expect(readNativeAppIcon({})).toBeUndefined();
    expect(readNativeAppIcon({ NoteFableNative: { postMessage } })).toBeUndefined();
    expect(readNativeAppIcon({ NoteFableNative: { postMessage, appIcon: () => { throw new Error("gone"); } } })).toBeUndefined();
  });
});

describe("postToNative", () => {
  it("sends the message as a JSON string to the app", () => {
    const postMessage = vi.fn();
    const sent = postToNative({ type: "ready", page: { id: "p1", title: "Plan", icon: "📘" } }, { NoteFableNative: { postMessage } });
    expect(sent).toBe(true);
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(JSON.parse(postMessage.mock.calls[0][0])).toEqual({ type: "ready", page: { id: "p1", title: "Plan", icon: "📘" } });
  });

  it("does nothing outside the app", () => {
    expect(postToNative({ type: "missing" }, {})).toBe(false);
    expect(postToNative({ type: "missing" }, { NoteFableNative: {} })).toBe(false);
    expect(postToNative({ type: "missing" }, undefined)).toBe(false);
  });

  it("swallows errors thrown by the app interface", () => {
    const postMessage = vi.fn(() => { throw new Error("gone"); });
    expect(postToNative({ type: "trashed" }, { NoteFableNative: { postMessage } })).toBe(false);
  });
});

describe("message shaping", () => {
  it("maps save-queue states to the bridge words", () => {
    expect(toEmbedSaveState("saved")).toBe("saved");
    expect(toEmbedSaveState("pending")).toBe("unsaved");
    expect(toEmbedSaveState("saving")).toBe("saving");
    expect(toEmbedSaveState("error")).toBe("error");
    expect(toEmbedSaveState("conflict")).toBe("conflict");
  });

  it("uses Untitled for a blank title and null for no icon", () => {
    expect(pageMeta({ title: "  ", icon: null })).toEqual({ title: "Untitled", icon: null });
    expect(pageMeta({ title: " Notes ", icon: "✏️" })).toEqual({ title: "Notes", icon: "✏️" });
  });
});

describe("embed api", () => {
  function setup(flush: () => Promise<boolean>, draftKept?: () => boolean) {
    const messages: NativeMessage[] = [];
    const openHistory = vi.fn();
    const pageUpdated = vi.fn();
    const api = createEmbedApi({ flush, draftKept, openHistory, pageUpdated, post: (message) => messages.push(message) });
    return { api, messages, openHistory, pageUpdated };
  }

  it("replies with flushed and the request id when everything is saved", async () => {
    const { api, messages } = setup(async () => true);
    await expect(api.flush("r1")).resolves.toBe(true);
    expect(messages).toEqual([{ type: "flushed", requestId: "r1", ok: true }]);
  });

  it("reports ok:false when edits remain unsaved", async () => {
    const { api, messages } = setup(async () => false);
    await expect(api.flush("r2")).resolves.toBe(false);
    expect(messages).toEqual([{ type: "flushed", requestId: "r2", ok: false, kept: false }]);
  });

  it("says whether a failed save left a retryable draft behind", async () => {
    const { api, messages } = setup(async () => false, () => true);
    await api.flush("r4");
    expect(messages).toEqual([{ type: "flushed", requestId: "r4", ok: false, kept: true }]);
  });

  it("reports ok:false when saving throws", async () => {
    const { api, messages } = setup(() => Promise.reject(new Error("offline")));
    await expect(api.flush("r3")).resolves.toBe(false);
    expect(messages).toEqual([{ type: "flushed", requestId: "r3", ok: false, kept: false }]);
  });

  it("normalizes missing or non-string request ids", async () => {
    const { api, messages } = setup(async () => true);
    await api.flush();
    await api.flush(7);
    expect(messages.map((message) => message.type === "flushed" && message.requestId)).toEqual(["", "7"]);
  });

  it("opens the history", () => {
    const { api, openHistory } = setup(async () => true);
    api.openHistory();
    expect(openHistory).toHaveBeenCalledTimes(1);
  });

  const page = { id: "p1", title: "Plan", icon: null, cover: null, coverPosition: null, blocks: [], version: 4, groupId: null, createdAt: "", updatedAt: "" };

  it("forwards a page updated in the app (JSON string or object) to the page-updated path", () => {
    const { api, pageUpdated } = setup(async () => true);
    expect(api.pageUpdated(JSON.stringify(page))).toBe(true);
    expect(api.pageUpdated(page)).toBe(true);
    expect(pageUpdated).toHaveBeenNthCalledWith(1, page);
    expect(pageUpdated).toHaveBeenNthCalledWith(2, page);
  });

  it("forwards page settings changed in the app, normalizing unknown values", () => {
    const pageSettings = vi.fn();
    const api = createEmbedApi({ flush: async () => true, openHistory: () => {}, pageSettings, post: () => {} });
    expect(api.pageSettings(JSON.stringify({ id: "p1", fullWidth: true, font: "mono", locked: true, favoritedAt: "2026-11-16T00:00:00.000Z" }))).toBe(true);
    expect(pageSettings).toHaveBeenLastCalledWith({ id: "p1", fullWidth: true, smallText: false, font: "mono", locked: true, favoritedAt: "2026-11-16T00:00:00.000Z" });
    expect(api.pageSettings({ id: "p1", font: "comic", smallText: "yes" })).toBe(true);
    expect(pageSettings).toHaveBeenLastCalledWith({ id: "p1", fullWidth: false, smallText: false, font: "default", locked: false, favoritedAt: null });
    expect(api.pageSettings({ font: "mono" })).toBe(false);
    expect(api.pageSettings("{bad")).toBe(false);
    expect(parsePageSettings(null)).toBeNull();
  });

  it("forwards the icon chosen in the app, rejecting anything that is not an emoji or an image", () => {
    const appIcon = vi.fn();
    const api = createEmbedApi({ flush: async () => true, openHistory: () => {}, appIcon, post: () => {} });
    expect(api.appIcon("🦊")).toBe(true);
    expect(appIcon).toHaveBeenLastCalledWith("🦊");
    expect(api.appIcon("data:image/png;base64,AAAA")).toBe(true);
    expect(appIcon).toHaveBeenLastCalledWith("data:image/png;base64,AAAA");
    expect(api.appIcon(null)).toBe(true);
    expect(appIcon).toHaveBeenLastCalledWith(null);
    expect(api.appIcon("")).toBe(true);
    expect(appIcon).toHaveBeenLastCalledWith(null);
    expect(api.appIcon("logo")).toBe(false);
    expect(api.appIcon("🦊🦊")).toBe(false);
    expect(api.appIcon(3)).toBe(false);
    expect(api.appIcon(undefined)).toBe(false);
    expect(appIcon).toHaveBeenCalledTimes(4);
    expect(parseAppIcon("https://example.com/a.png")).toBeUndefined();
  });

  it("ignores malformed pages from the app", () => {
    const { api, pageUpdated } = setup(async () => true);
    expect(api.pageUpdated("{not json")).toBe(false);
    expect(api.pageUpdated(null)).toBe(false);
    expect(api.pageUpdated({ ...page, version: "4" })).toBe(false);
    expect(api.pageUpdated({ ...page, id: "" })).toBe(false);
    expect(api.pageUpdated({ ...page, blocks: undefined })).toBe(false);
    expect(pageUpdated).not.toHaveBeenCalled();
    expect(parseUpdatedPage(page)).toEqual(page);
  });

  it("dispatches notefable:page-updated by default", () => {
    const listener = vi.fn();
    const target = new EventTarget();
    vi.stubGlobal("window", target);
    try {
      target.addEventListener("notefable:page-updated", listener);
      const api = createEmbedApi({ flush: async () => true, openHistory: () => {}, post: () => {} });
      expect(api.pageUpdated(JSON.stringify(page))).toBe(true);
      expect(listener).toHaveBeenCalledTimes(1);
      expect((listener.mock.calls[0][0] as CustomEvent<NotePage>).detail).toEqual(page);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("installs on the window and removes only its own api", () => {
    const target: { notefableEmbed?: ReturnType<typeof createEmbedApi> } = {};
    const first = setup(async () => true).api;
    const removeFirst = installEmbedApi(first, target);
    expect(target.notefableEmbed).toBe(first);
    const second = setup(async () => true).api;
    const removeSecond = installEmbedApi(second, target);
    removeFirst();
    expect(target.notefableEmbed).toBe(second);
    removeSecond();
    expect(target.notefableEmbed).toBeUndefined();
  });
});
