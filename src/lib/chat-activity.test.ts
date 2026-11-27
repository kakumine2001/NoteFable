import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatActivity } from "@/components/chat-activity";
import { applyActivityEvent, contextActivityEvent, parseActivityEvent, parseStoredActivity, serializeActivity, splitThought, type ActivityStep, type ProgressStep } from "./chat-activity";

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

  it("turns a running web search into its finished action and clears failed page reads", () => {
    const running = parseActivityEvent({
      type: "response.output_item.added",
      item: { id: "ws", type: "web_search_call", status: "in_progress" },
    })!;
    const done = parseActivityEvent({
      type: "response.output_item.done",
      item: { id: "ws", type: "web_search_call", action: { type: "open_page", url: "https://nextjs.org/docs" } },
    })!;
    const failed = parseActivityEvent({
      type: "response.output_item.done",
      item: { id: "ws_fail", type: "web_search_call", status: "failed", action: { type: "open_page", url: "https://nextjs.org/broken" } },
    })!;

    const steps = [running, done, failed].reduce(applyActivityEvent, [] as ActivityStep[]);
    expect(steps).toEqual([
      { id: "ws", kind: "web", status: "done", action: { kind: "open_page", url: "https://nextjs.org/docs" } },
      { id: "ws_fail", kind: "web", status: "done", action: undefined },
    ]);
    expect(serializeActivity(steps)).toBe(JSON.stringify([steps[0]]));
    const summary = renderToStaticMarkup(createElement(ChatActivity, { steps: steps as ProgressStep[], isThinking: false, seconds: 1 }));
    expect(summary).toContain("1 source");
  });

  it("turns a page edit proposal into a step and ignores malformed ones", () => {
    const proposal = { type: "notefable.proposal", id: "pr1", pageId: "p1", pageTitle: "Notes", baseVersion: 2, changes: [{ op: "delete", block: 1, before: "x" }], proposed: { title: "Notes", blocks: [] } };
    const event = parseActivityEvent(proposal)!;
    expect(event.type).toBe("proposal");
    expect([event].reduce(applyActivityEvent, [] as ActivityStep[])).toEqual([
      { kind: "proposal", id: "pr1", pageId: "p1", pageTitle: "Notes", baseVersion: 2, changes: proposal.changes, proposed: proposal.proposed },
    ]);
    expect(parseActivityEvent({ ...proposal, baseVersion: "2" })).toBeNull();
    expect(parseActivityEvent({ ...proposal, proposed: { title: "x" } })).toBeNull();
  });

  it("turns a new page proposal into a step and ignores malformed ones", () => {
    const proposal = { type: "notefable.create_proposal", id: "np1", title: "Plan", icon: null, content: "- a", proposed: { title: "Plan", icon: null, blocks: [] } };
    const event = parseActivityEvent(proposal)!;
    expect(event.type).toBe("create_proposal");
    expect([event].reduce(applyActivityEvent, [] as ActivityStep[])).toEqual([
      { kind: "create_proposal", id: "np1", title: "Plan", icon: null, content: "- a", proposed: proposal.proposed },
    ]);
    expect(parseActivityEvent({ ...proposal, content: 1 })).toBeNull();
    expect(parseActivityEvent({ ...proposal, proposed: { title: "Plan" } })).toBeNull();
  });

  it("tracks a page tool from running to its finished label", () => {
    const running = parseActivityEvent({ type: "notefable.tool", id: "call1", name: "read_note", status: "running" })!;
    const done = parseActivityEvent({ type: "notefable.tool", id: "call1", name: "read_note", status: "done", label: "Read “Notes”" })!;
    expect([running, done].reduce(applyActivityEvent, [] as ActivityStep[])).toEqual([
      { id: "call1", kind: "tool", status: "done", name: "read_note", label: "Read “Notes”" },
    ]);
    expect(parseActivityEvent({ type: "notefable.tool", name: "read_note" })).toBeNull();
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

  it("stores progress steps without proposals and restores them", () => {
    const steps: ActivityStep[] = [
      { id: "rs:0", kind: "thought", text: "**Plan**\n\nCheck docs." },
      { id: "ws", kind: "web", status: "done", action: { kind: "search", queries: ["a"], sources: ["https://example.com/x"] } },
      { id: "call1", kind: "tool", status: "done", name: "read_note", label: "Read “Notes”" },
      { kind: "create_proposal", id: "np1", title: "Plan", icon: null, content: "- a", proposed: { title: "Plan", icon: null, blocks: [] } },
    ];

    const raw = serializeActivity(steps)!;
    expect(raw).not.toContain("np1");
    expect(parseStoredActivity(raw)).toEqual(steps.slice(0, 3));
    expect(serializeActivity([steps[3]])).toBeUndefined();
  });

  it("caps stored reasoning text", () => {
    const stored = parseStoredActivity(serializeActivity([
      { id: "a", kind: "thought", text: "x".repeat(15000) },
      { id: "b", kind: "thought", text: "y".repeat(15000) },
      { id: "c", kind: "thought", text: "z" },
    ]))!;
    expect(stored.map((step) => (step.kind === "thought" ? step.text.length : 0))).toEqual([15000, 5000]);
  });

  it("drops broken or unsafe stored activity", () => {
    expect(parseStoredActivity(null)).toBeUndefined();
    expect(parseStoredActivity("not json")).toBeUndefined();
    expect(parseStoredActivity('{"a":1}')).toBeUndefined();
    expect(parseStoredActivity(JSON.stringify([
      { id: "x", kind: "thought" },
      { kind: "thought", text: "no id" },
      { id: "ws", kind: "web", status: "running", action: { kind: "open_page", url: "javascript:alert(1)" } },
      { id: "t", kind: "tool", status: "running", name: "search_notes" },
    ]))).toEqual([
      { id: "t", kind: "tool", status: "done", name: "search_notes" },
    ]);
  });

  it("does not store a search that never finished", () => {
    expect(serializeActivity([{ id: "ws", kind: "web", status: "running" }])).toBeUndefined();
    expect(parseStoredActivity(JSON.stringify([{ id: "ws", kind: "web", status: "done" }]))).toBeUndefined();
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

describe("project context activity", () => {
  const info = { projectName: "Mail", hasInstructions: true, notes: [{ id: "n1", title: "Style guide" }, { id: "n2", title: "Long note", truncated: true }] };
  const step: ActivityStep = { id: "project-context", kind: "context", ...info };

  it("turns the project context into a step that is saved and restored with the answer", () => {
    const event = contextActivityEvent(info)!;
    expect(event).toEqual({ type: "context", id: "project-context", ...info });
    const steps = [event, ...[{ type: "thought" as const, id: "rs:0", delta: "Plan" }]].reduce(applyActivityEvent, [] as ActivityStep[]);
    expect(steps).toEqual([step, { id: "rs:0", kind: "thought", text: "Plan" }]);
    expect(parseStoredActivity(serializeActivity(steps))).toEqual(steps);
  });

  it("replaces the step when the same context arrives again", () => {
    const steps = [contextActivityEvent(info)!, contextActivityEvent({ ...info, notes: [{ id: "n3", title: "New" }] })!].reduce(applyActivityEvent, [] as ActivityStep[]);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ kind: "context", notes: [{ id: "n3", title: "New" }] });
  });

  it("caps strings and the number of notes, and drops malformed notes", () => {
    const event = contextActivityEvent({
      projectName: "P".repeat(500),
      hasInstructions: false,
      notes: [
        { id: "a", title: "T".repeat(500) },
        { id: "a", title: "duplicate" },
        { id: "", title: "no id" },
        { id: "b", title: 5 as unknown as string },
        { id: "c".repeat(101), title: "long id" },
        { id: "d", title: "", truncated: "yes" as unknown as boolean },
        ...Array.from({ length: 20 }, (_, i) => ({ id: `n${i}`, title: `Note ${i}` })),
      ],
    });
    if (event?.type !== "context") throw new Error("expected a context event");
    expect(event.projectName).toHaveLength(300);
    expect(event.notes).toHaveLength(10);
    expect(event.notes.slice(0, 2)).toEqual([{ id: "a", title: "T".repeat(300) }, { id: "d", title: "Untitled" }]);
  });

  it("ignores a context with nothing to show", () => {
    expect(contextActivityEvent({ projectName: "Mail", hasInstructions: false, notes: [] })).toBeNull();
    expect(contextActivityEvent({ projectName: " ", hasInstructions: true, notes: [] })).toBeNull();
    expect(contextActivityEvent(null as never)).toBeNull();
  });

  it("drops malformed stored context but keeps what is valid", () => {
    expect(parseStoredActivity(JSON.stringify([
      { id: "project-context", kind: "context", projectName: 5, hasInstructions: true, notes: [] },
      { id: "x", kind: "context", projectName: "A", hasInstructions: false, notes: "none" },
      { id: "y", kind: "context", projectName: "B", hasInstructions: true, notes: "none" },
      { id: "z", kind: "context", projectName: "C", hasInstructions: false, notes: [{ id: "n1", title: "Ok", truncated: true }, null, { id: 3 }] },
    ]))).toEqual([
      { id: "y", kind: "context", projectName: "B", hasInstructions: true, notes: [] },
      { id: "z", kind: "context", projectName: "C", hasInstructions: false, notes: [{ id: "n1", title: "Ok", truncated: true }] },
    ]);
  });

  it("shows the used instructions and note chips, and summarizes them once the answer is done", () => {
    const steps = [step] as ProgressStep[];
    const open = renderToStaticMarkup(createElement(ChatActivity, { steps, isThinking: true, seconds: 2 }));
    expect(open).toContain("Used project “Mail”: instructions + 2 reference pages");
    expect(open).toContain("Style guide");
    expect(open).toContain("chat-context-partial");
    // ノートのチップはボタンで、押すとそのノートを開く。
    expect(open.match(/<button[^>]*chat-context-chip/g)).toHaveLength(2);
    const done = renderToStaticMarkup(createElement(ChatActivity, { steps, isThinking: false, seconds: 2 }));
    expect(done).toContain("Thought for 2s · 2 project pages");
    expect(renderToStaticMarkup(createElement(ChatActivity, { steps: [{ ...step, notes: [] } as ProgressStep], isThinking: false, seconds: 2 }))).toContain("project instructions");
  });
});
