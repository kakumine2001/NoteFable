import { afterEach, describe, expect, it, vi } from "vitest";
import { NoteSaveError, NoteSaveQueue } from "./note-save-queue";
import type { NotePage } from "@/types/notes";

const page: NotePage = { id: "page", title: "First", icon: null, cover: null, coverPosition: null, blocks: [], version: 0, groupId: null, createdAt: "2026-09-30", updatedAt: "2026-09-30" };
afterEach(() => { vi.useRealTimers(); });

describe("page autosave queue", () => {
  it("serializes edits during a save and acknowledges only the last revision", async () => {
    let resolveFirst!: (value: NotePage) => void;
    const save = vi.fn().mockImplementationOnce(() => new Promise<NotePage>((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(async (content, version) => ({ ...page, ...content, version: version + 1 }));
    const queue = new NoteSaveQueue(page, save, () => {});
    queue.edit({ title: "Second", icon: null, cover: null, coverPosition: null, blocks: [] });
    const first = queue.flush();
    queue.edit({ title: "Third", icon: null, cover: null, coverPosition: null, blocks: [] });
    expect(save).toHaveBeenCalledTimes(1);
    expect(queue.flush()).toBe(first);
    resolveFirst({ ...page, title: "Second", version: 1 });
    expect(await first).toBe(true);
    expect(save.mock.calls[1]).toEqual([{ title: "Third", icon: null, cover: null, coverPosition: null, blocks: [] }, 1]);
    expect(queue.content.title).toBe("Third");
    expect(queue.dirty).toBe(false);
    expect(queue.version).toBe(2);
  });

  it("debounces typing and preserves a failed draft for retry", async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockRejectedValueOnce(new Error("Offline")).mockResolvedValueOnce({ ...page, title: "Second", version: 1 });
    const queue = new NoteSaveQueue(page, save, () => {});
    queue.edit({ title: "S", icon: null, cover: null, coverPosition: null, blocks: [] });
    await vi.advanceTimersByTimeAsync(700);
    queue.edit({ title: "Second", icon: null, cover: null, coverPosition: null, blocks: [] });
    await vi.advanceTimersByTimeAsync(999);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(queue.status).toBe("error");
    expect(queue.draft.title).toBe("Second");
    expect(queue.dirty).toBe(true);
    await queue.flush();
    expect(queue.status).toBe("saved");
  });

  it("marks the queue gone when the note no longer exists and keeps the draft", async () => {
    const save = vi.fn().mockRejectedValue(new NoteSaveError("Not found", 404));
    const queue = new NoteSaveQueue(page, save, () => {});
    queue.edit({ title: "Mine", icon: null, cover: null, coverPosition: null, blocks: [] });
    expect(await queue.flush()).toBe(false);
    expect(queue.status).toBe("error");
    expect(queue.gone).toBe(true);
    expect(queue.draft.title).toBe("Mine");
    expect(queue.dirty).toBe(true);
  });

  it("stops automatic writes after a conflict and can load the latest version", async () => {
    vi.useFakeTimers();
    const latest = { ...page, title: "Other tab", version: 2 };
    const save = vi.fn().mockRejectedValue(new NoteSaveError("Conflict", 409, latest));
    const queue = new NoteSaveQueue(page, save, () => {});
    queue.edit({ title: "Mine", icon: null, cover: null, coverPosition: null, blocks: [] });
    expect(await queue.flush()).toBe(false);
    queue.edit({ title: "Mine again", icon: null, cover: null, coverPosition: null, blocks: [] });
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).toHaveBeenCalledTimes(1);
    expect(queue.content.title).toBe("Mine again");
    queue.loadLatest(latest);
    expect(queue.content.title).toBe("Other tab");
    expect(queue.dirty).toBe(false);
  });

  it("recovers drafts and protects a stale recovered draft", () => {
    const pending = new NoteSaveQueue(page, vi.fn(), () => {}, { title: "Recovered", icon: null, cover: null, coverPosition: null, blocks: [], version: 0 });
    expect(pending.status).toBe("pending");
    const stale = new NoteSaveQueue({ ...page, version: 1 }, vi.fn(), () => {}, { title: "Recovered", icon: null, cover: null, coverPosition: null, blocks: [], version: 0 });
    expect(stale.status).toBe("conflict");
    expect(stale.content.title).toBe("Recovered");
  });

  it("stops a pending autosave once the page was trashed elsewhere", async () => {
    vi.useFakeTimers();
    const save = vi.fn();
    const changed = vi.fn();
    const queue = new NoteSaveQueue(page, save, changed);
    queue.edit({ title: "Second", icon: null, cover: null, coverPosition: null, blocks: [] });
    queue.dispose();
    await vi.advanceTimersByTimeAsync(2000);
    queue.edit({ title: "Third", icon: null, cover: null, coverPosition: null, blocks: [] });
    expect(await queue.flush()).toBe(true);
    expect(save).not.toHaveBeenCalled();
    expect(changed).toHaveBeenCalledTimes(1);
  });
});
