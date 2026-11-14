import { describe, expect, it, vi } from "vitest";
import { createEmbedApi, installEmbedApi, pageMeta, postToNative, toEmbedSaveState, type NativeMessage } from "./native-bridge";

describe("postToNative", () => {
  it("sends the message as a JSON string to the app", () => {
    const postMessage = vi.fn();
    const sent = postToNative({ type: "ready", page: { id: "p1", title: "Plan", icon: "📘" } }, { StudyMateNative: { postMessage } });
    expect(sent).toBe(true);
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(JSON.parse(postMessage.mock.calls[0][0])).toEqual({ type: "ready", page: { id: "p1", title: "Plan", icon: "📘" } });
  });

  it("does nothing outside the app", () => {
    expect(postToNative({ type: "missing" }, {})).toBe(false);
    expect(postToNative({ type: "missing" }, { StudyMateNative: {} })).toBe(false);
    expect(postToNative({ type: "missing" }, undefined)).toBe(false);
  });

  it("swallows errors thrown by the app interface", () => {
    const postMessage = vi.fn(() => { throw new Error("gone"); });
    expect(postToNative({ type: "trashed" }, { StudyMateNative: { postMessage } })).toBe(false);
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
    const api = createEmbedApi({ flush, draftKept, openHistory, post: (message) => messages.push(message) });
    return { api, messages, openHistory };
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

  it("installs on the window and removes only its own api", () => {
    const target: { studymateEmbed?: ReturnType<typeof createEmbedApi> } = {};
    const first = setup(async () => true).api;
    const removeFirst = installEmbedApi(first, target);
    expect(target.studymateEmbed).toBe(first);
    const second = setup(async () => true).api;
    const removeSecond = installEmbedApi(second, target);
    removeFirst();
    expect(target.studymateEmbed).toBe(second);
    removeSecond();
    expect(target.studymateEmbed).toBeUndefined();
  });
});
