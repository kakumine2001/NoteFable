import { describe, expect, it, vi } from "vitest";
vi.mock("@/components/answer-actions", () => ({ ReportDialog: () => null }));
import { changeLabel, initialState, resolveProposalState, type ProposalCardState } from "./page-proposal";
import { createTranslator } from "@/lib/i18n/translate";
import { restoreNoteChatMessages } from "./page-assistant";
import type { Message } from "@/types/chat";

const t = createTranslator({});
const state = (status: ProposalCardState["status"], extra: Partial<ProposalCardState> = {}): ProposalCardState => ({ status, error: "", ...extra });

describe("proposal card state", () => {
  it("lets the server's settled state win over an old local state, except an undo started here", () => {
    expect(resolveProposalState(state("discarded"), state("idle", { error: "x" }))).toEqual(state("discarded"));
    expect(resolveProposalState(state("undone"), state("applied"))).toEqual(state("undone"));
    // 別のタブで適用された：手元の失敗した適用（idle）は使わない。そうしないと「元に戻す」が効かない。
    expect(resolveProposalState(state("applied", { undoable: true }), state("idle", { error: "conflict" }))).toEqual(state("applied", { undoable: true }));
    expect(resolveProposalState(state("applied"), state("undoing"))).toEqual(state("undoing"));
    expect(resolveProposalState(state("applied"), state("undone"))).toEqual(state("undone"));
    expect(resolveProposalState(state("idle"), state("applying"))).toEqual(state("applying"));
    expect(resolveProposalState(state("idle"), undefined)).toEqual(state("idle"));
  });

  it("starts from the saved status and the page to open", () => {
    expect(initialState({ kind: "proposal", id: "p", pageId: "pg", pageTitle: "T", baseVersion: 1, changes: [], proposed: { title: "T", blocks: [] }, status: "applied", undoable: true }))
      .toEqual({ status: "applied", error: "", pageId: "pg", undoable: true });
    expect(initialState({ kind: "create_proposal", id: "p", title: "T", icon: null, content: "", proposed: { title: "T", icon: null, blocks: [] }, status: "undone", appliedPageId: "new" }))
      .toEqual({ status: "undone", error: "", pageId: "new", undoable: false });
  });

  it("labels changes by block, slide or elements", () => {
    expect(changeLabel({ op: "replace", block: 3 }, t, "note")).toBe("Replace · block 3");
    expect(changeLabel({ op: "insert_after", block: 0 }, t, "note")).toBe("Insert · start of note");
    expect(changeLabel({ op: "update", block: 0, target: { type: "slide", number: 2 } }, t, "slides")).toBe("Update · slide 2");
    expect(changeLabel({ op: "add", block: 0, target: { type: "elements", count: 3 } }, t, "whiteboard")).toBe("Add · 3 elements");
    expect(changeLabel({ op: "move", block: 0, target: { type: "elements", count: 1, name: "Idea" } }, t, "whiteboard")).toBe("Move · “Idea”");
    expect(changeLabel({ op: "reorder", block: 0 }, t, "slides")).toBe("Reorder");
    expect(changeLabel({ op: "nonsense" as never, block: 0 }, t, "slides")).toBe("Update");
  });
});

describe("restoring quick-action labels", () => {
  it("also restores the labels of actions an editor passed in", () => {
    const messages = [{ id: "m", role: "USER", content: "Tidy the layout of this board." } as Message];
    expect(restoreNoteChatMessages(messages, t)[0].content).toBe("Tidy the layout of this board.");
    expect(restoreNoteChatMessages(messages, t, [{ label: "Tidy up", prompt: "Tidy the layout of this board." }])[0].content).toBe("Tidy up");
  });
});
