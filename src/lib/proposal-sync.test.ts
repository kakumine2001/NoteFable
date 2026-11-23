import { afterEach, describe, expect, it, vi } from "vitest";
import { syncAutoAppliedProposal } from "./proposal-sync";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("auto-applied proposals in the chat stream", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("reloads the page once and tells the open editor or the list", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ page: { id: "pg", version: 4 } })));
    const dispatch = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", { dispatchEvent: dispatch });
    vi.stubGlobal("CustomEvent", class { constructor(public type: string, public init: { detail: unknown }) {} });
    const edit = { type: "proposal", id: "sync-1", pageId: "pg", pageTitle: "T", baseVersion: 3, changes: [], proposed: { title: "T", blocks: [] }, status: "applied", autoApplied: true } as const;
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

  it("ignores proposals that were not applied automatically", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    syncAutoAppliedProposal({ type: "proposal", id: "sync-3", pageId: "pg", pageTitle: "T", baseVersion: 3, changes: [], proposed: { title: "T", blocks: [] }, status: "applied" });
    syncAutoAppliedProposal({ type: "proposal", id: "sync-4", pageId: "pg", pageTitle: "T", baseVersion: 3, changes: [], proposed: { title: "T", blocks: [] }, status: "pending", autoApplied: true });
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
