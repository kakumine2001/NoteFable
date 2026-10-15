import { describe, expect, it, vi } from "vitest";
import { listProjectSummaries, MAX_PROJECT_INSTRUCTIONS, MAX_PROJECT_NOTES, readProjectSummary, validProjectInstructions, validProjectNoteIds, validProjectName } from "./chat-project-api";

const status = (action: () => unknown) => { try { action(); } catch (error) { return (error as { status?: number }).status; } };

describe("project limits", () => {
  it("shares the documented limits", () => {
    expect([MAX_PROJECT_INSTRUCTIONS, MAX_PROJECT_NOTES]).toEqual([4000, 5]);
  });
});

describe("project instructions", () => {
  it.each([
    ["  Be brief.  \n", "Be brief."],
    ["a\r\nb\rc", "a\nb\nc"],
    ["tab\there", "tab\there"],
    ["", null],
    ["   \n\t", null],
    [null, null],
    ["日本語で答える。", "日本語で答える。"],
  ])("normalizes %j", (input, expected) => {
    expect(validProjectInstructions(input)).toBe(expected);
  });

  it("allows 4000 characters after trimming and rejects more", () => {
    expect(validProjectInstructions(` ${"x".repeat(4000)} `)).toHaveLength(4000);
    expect(status(() => validProjectInstructions("x".repeat(4001)))).toBe(400);
  });

  it.each([[5], [true], [{}], [["a"]], ["a\u0000b"], ["bell\u0007"], ["del\u007f"]])("rejects %j", (input) => {
    expect(status(() => validProjectInstructions(input))).toBe(400);
  });
});

describe("project note IDs", () => {
  it("keeps the order and trims", () => {
    expect(validProjectNoteIds([" b ", "a"])).toEqual(["b", "a"]);
    expect(validProjectNoteIds([])).toEqual([]);
  });

  it.each([
    [["a", "b", "c", "d", "e", "f"]],
    [["a", "a"]],
    [["a", " a "]],
    [[""]],
    [["a", null]],
    [[1]],
    [["x".repeat(101)]],
    ["a"],
    [{ 0: "a" }],
    [null],
    [undefined],
  ])("rejects %j", (input) => {
    expect(status(() => validProjectNoteIds(input))).toBe(400);
  });
});

describe("project names keep their wording", () => {
  it("talks about projects, not groups", () => {
    expect(() => validProjectName("")).toThrow("Enter a project name.");
  });
});

describe("project summaries", () => {
  const db = (rows: unknown[], flagged: unknown[], one?: unknown) => ({
    chatProject: { findMany: vi.fn().mockResolvedValueOnce(rows).mockResolvedValueOnce(flagged), findFirst: vi.fn().mockResolvedValue(one) },
  }) as never;

  it("counts live notes and flags projects that have instructions", async () => {
    const client = db([{ id: "a", name: "A", _count: { notes: 3 } }, { id: "b", name: "B", _count: { notes: 0 } }], [{ id: "b" }]);
    expect(await listProjectSummaries(client, "mine")).toEqual([
      { id: "a", name: "A", noteCount: 3, hasInstructions: false },
      { id: "b", name: "B", noteCount: 0, hasInstructions: true },
    ]);
  });

  it("reads one summary for the owner only", async () => {
    const client = db([], [], { id: "a", name: "A", instructions: "x", _count: { notes: 1 } });
    expect(await readProjectSummary(client, "mine", "a")).toEqual({ id: "a", name: "A", noteCount: 1, hasInstructions: true });
    expect((client as unknown as { chatProject: { findFirst: { mock: { calls: [{ where: unknown }][] } } } }).chatProject.findFirst.mock.calls[0][0].where).toEqual({ id: "a", userId: "mine" });
    expect(await readProjectSummary(db([], [], null), "mine", "a")).toBeNull();
  });
});
