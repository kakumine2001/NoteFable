import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActivityEvent } from "@/lib/chat-activity";
import { PAGES_TRASHED_EVENT, PAGES_WILL_TRASH_EVENT, saveBeforeTrash, syncAutoAppliedProposal, type PagesWillTrashDetail } from "./proposal-sync";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("auto-applied proposals in the chat stream", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("reloads the page once and tells the open editor or the list", async () => {
    const fetchMock = vi.fn<(input: string) => Promise<Response>>(async () => new Response(JSON.stringify({ page: { id: "pg", version: 4 } })));
    const dispatch = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", { dispatchEvent: dispatch });
    vi.stubGlobal("CustomEvent", class { constructor(public type: string, public init: { detail: unknown }) {} });
    const edit: ActivityEvent = { type: "proposal", id: "sync-1", pageId: "pg", pageTitle: "T", baseVersion: 3, changes: [], proposed: { title: "T", blocks: [] }, status: "applied", autoApplied: true };
    syncAutoAppliedProposal(edit);
    syncAutoAppliedProposal(edit);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/pages/pg");
    expect(dispatch.mock.calls[0][0]).toMatchObject({ type: "notefable:page-updated", init: { detail: { id: "pg", version: 4 } } });

    syncAutoAppliedProposal({ type: "create_proposal", id: "sync-2", title: "N", icon: null, content: "", proposed: { title: "N", icon: null, blocks: [] }, status: "applied", autoApplied: true, appliedPageId: "pg" });
    await flush();
    expect(dispatch.mock.calls[1][0]).toMatchObject({ type: "notefable:page-created" });
  });

  it("tries again after a failed read, stops on 404, and never re-adds a page that was moved to the trash meanwhile", async () => {
    vi.useFakeTimers();
    try {
      const listeners = new Map<string, (event: Event) => void>();
      const dispatch = vi.fn();
      vi.stubGlobal("window", { dispatchEvent: dispatch, addEventListener: (type: string, listener: (event: Event) => void) => listeners.set(type, listener) });
      vi.stubGlobal("CustomEvent", class { constructor(public type: string, public init: { detail: unknown }) {} });
      const fetchMock = vi.fn<(input: string) => Promise<Response>>()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValueOnce(new Response(JSON.stringify({ page: { id: "pg5", version: 2 } })));
      vi.stubGlobal("fetch", fetchMock);
      syncAutoAppliedProposal({ type: "proposal", id: "sync-5", pageId: "pg5", pageTitle: "T", baseVersion: 1, changes: [], proposed: { title: "T", blocks: [] }, status: "applied", autoApplied: true });
      await vi.advanceTimersByTimeAsync(1_000);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(dispatch).toHaveBeenCalledTimes(1);

      fetchMock.mockReset();
      fetchMock.mockResolvedValue(new Response("{}", { status: 404 }));
      syncAutoAppliedProposal({ type: "create_proposal", id: "sync-6", title: "N", icon: null, content: "", proposed: { title: "N", icon: null, blocks: [] }, status: "applied", autoApplied: true, appliedPageId: "pg6" });
      await vi.advanceTimersByTimeAsync(20_000);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // 読んでいる間に元に戻した（ゴミ箱へ移した）ページは、届いた結果で一覧に戻さない。
      let respond!: (response: Response) => void;
      fetchMock.mockReset();
      fetchMock.mockReturnValue(new Promise<Response>((resolve) => { respond = resolve; }));
      syncAutoAppliedProposal({ type: "create_proposal", id: "sync-7", title: "N", icon: null, content: "", proposed: { title: "N", icon: null, blocks: [] }, status: "applied", autoApplied: true, appliedPageId: "pg7" });
      listeners.get(PAGES_TRASHED_EVENT)?.({ detail: { ids: ["pg7"] } } as unknown as Event);
      respond(new Response(JSON.stringify({ page: { id: "pg7", version: 1 } })));
      await vi.advanceTimersByTimeAsync(0);
      expect(dispatch).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("saves the open pages before a page is moved to the trash, and reports a page it could not save", async () => {
    const listeners: ((event: Event) => void)[] = [];
    vi.stubGlobal("window", { dispatchEvent: (event: Event) => { for (const listener of listeners) listener(event); return true; } });
    vi.stubGlobal("CustomEvent", class { constructor(public type: string, public init: { detail: unknown }) {} });
    const asked: string[][] = [];
    listeners.push((event) => {
      const { detail } = (event as unknown as { init: { detail: PagesWillTrashDetail } }).init;
      expect((event as unknown as { type: string }).type).toBe(PAGES_WILL_TRASH_EVENT);
      asked.push(detail.ids);
      detail.waits.push(Promise.resolve(true));
    });
    expect(await saveBeforeTrash(["pg"])).toBe(true);
    listeners.push((event) => { (event as unknown as { init: { detail: PagesWillTrashDetail } }).init.detail.waits.push(Promise.resolve(false)); });
    expect(await saveBeforeTrash(["pg"])).toBe(false);
    listeners.push((event) => { (event as unknown as { init: { detail: PagesWillTrashDetail } }).init.detail.waits.push(Promise.reject(new Error("x"))); });
    expect(await saveBeforeTrash(["pg"])).toBe(false);
    expect(asked[0]).toEqual(["pg"]);
  });

  it("ignores proposals that were not applied automatically", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    syncAutoAppliedProposal({ type: "proposal", id: "sync-3", pageId: "pg", pageTitle: "T", baseVersion: 3, changes: [], proposed: { title: "T", blocks: [] }, status: "applied" });
    syncAutoAppliedProposal({ type: "proposal", id: "sync-4", pageId: "pg", pageTitle: "T", baseVersion: 3, changes: [], proposed: { title: "T", blocks: [] }, status: "pending", autoApplied: true });
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
