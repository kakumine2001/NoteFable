import { describe, expect, it } from "vitest";
import { applyActivityEvent, parseActivityEvent, splitThought, type ActivityStep } from "./chat-activity";

describe("chat activity", () => {
  it("merges reasoning deltas from OpenAI summaries and DeepSeek reasoning text", () => {
    const events = [
      { type: "response.reasoning_summary_text.delta", item_id: "rs", summary_index: 0, delta: "**Plan**\n\n" },
      { type: "response.reasoning_summary_text.delta", item_id: "rs", summary_index: 0, delta: "Check docs." },
      { type: "response.reasoning_text.delta", item_id: "ds", content_index: 0, delta: "嗯，" },
    ].map((event) => parseActivityEvent(event)!);

    const steps = events.reduce(applyActivityEvent, [] as ActivityStep[]);
    expect(steps).toEqual([
      { id: "rs:0", kind: "thought", text: "**Plan**\n\nCheck docs." },
      { id: "ds:0", kind: "thought", text: "嗯，" },
    ]);
    expect(splitThought(steps[0].kind === "thought" ? steps[0].text : "")).toEqual({ title: "Plan", body: "Check docs." });
  });

  it("turns a running web search into its finished action", () => {
    const running = parseActivityEvent({
      type: "response.output_item.added",
      item: { id: "ws", type: "web_search_call", status: "in_progress" },
    })!;
    const done = parseActivityEvent({
      type: "response.output_item.done",
      item: { id: "ws", type: "web_search_call", action: { type: "open_page", url: "https://nextjs.org/docs" } },
    })!;

    expect([running, done].reduce(applyActivityEvent, [] as ActivityStep[])).toEqual([
      { id: "ws", kind: "web", status: "done", action: { kind: "open_page", url: "https://nextjs.org/docs" } },
    ]);
  });

  it("turns a page edit proposal into a step and ignores malformed ones", () => {
    const proposal = { type: "studymate.proposal", id: "pr1", pageId: "p1", pageTitle: "Notes", baseVersion: 2, changes: [{ op: "delete", block: 1, before: "x" }], proposed: { title: "Notes", blocks: [] } };
    const event = parseActivityEvent(proposal)!;
    expect(event.type).toBe("proposal");
    expect([event].reduce(applyActivityEvent, [] as ActivityStep[])).toEqual([
      { kind: "proposal", id: "pr1", pageId: "p1", pageTitle: "Notes", baseVersion: 2, changes: proposal.changes, proposed: proposal.proposed },
    ]);
    expect(parseActivityEvent({ ...proposal, baseVersion: "2" })).toBeNull();
    expect(parseActivityEvent({ ...proposal, proposed: { title: "x" } })).toBeNull();
  });

  it("turns a new page proposal into a step and ignores malformed ones", () => {
    const proposal = { type: "studymate.create_proposal", id: "np1", title: "Plan", icon: null, content: "- a", proposed: { title: "Plan", icon: null, blocks: [] } };
    const event = parseActivityEvent(proposal)!;
    expect(event.type).toBe("create_proposal");
    expect([event].reduce(applyActivityEvent, [] as ActivityStep[])).toEqual([
      { kind: "create_proposal", id: "np1", title: "Plan", icon: null, content: "- a", proposed: proposal.proposed },
    ]);
    expect(parseActivityEvent({ ...proposal, content: 1 })).toBeNull();
    expect(parseActivityEvent({ ...proposal, proposed: { title: "Plan" } })).toBeNull();
  });

  it("tracks a page tool from running to its finished label", () => {
    const running = parseActivityEvent({ type: "studymate.tool", id: "call1", name: "read_page", status: "running" })!;
    const done = parseActivityEvent({ type: "studymate.tool", id: "call1", name: "read_page", status: "done", label: "Read “Notes”" })!;
    expect([running, done].reduce(applyActivityEvent, [] as ActivityStep[])).toEqual([
      { id: "call1", kind: "tool", status: "done", name: "read_page", label: "Read “Notes”" },
    ]);
    expect(parseActivityEvent({ type: "studymate.tool", name: "read_page" })).toBeNull();
  });

  it("keeps only safe, de-duplicated search sources", () => {
    const event = parseActivityEvent({
      type: "response.output_item.done",
      item: {
        id: "ws",
        type: "web_search_call",
        action: {
          type: "search",
          query: "a",
          queries: ["a", "a", "b"],
          sources: [
            { type: "url", url: "https://example.com/x" },
            { type: "url", url: "https://example.com/x" },
            { type: "url", url: "javascript:alert(1)" },
            { type: "api", name: "oai-weather" },
          ],
        },
      },
    });

    expect(event).toEqual({
      type: "web",
      id: "ws",
      status: "done",
      action: { kind: "search", queries: ["a", "b"], sources: ["https://example.com/x"] },
    });
  });

  it("ignores events that are not activity", () => {
    expect(parseActivityEvent({ type: "response.output_text.delta", delta: "hi" })).toBeNull();
    expect(parseActivityEvent({ type: "response.output_item.added", item: { id: "m", type: "message" } })).toBeNull();
    expect(parseActivityEvent({
      type: "response.output_item.done",
      item: { id: "ws", type: "web_search_call", action: { type: "open_page", url: "file:///etc/passwd" } },
    })).toEqual({ type: "web", id: "ws", status: "done", action: undefined });
  });
});
