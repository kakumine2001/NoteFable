import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {}, databaseSchema: "notefable" }));
import { messagesFor } from "@/lib/i18n/messages";
import { createTranslator } from "@/lib/i18n/translate";
import type { ProposalChange } from "@/lib/page-ai/types";
import { whiteboardAdapter } from "@/lib/page-ai/whiteboard-adapter";
import { applyWhiteboardEdits, buildStructuredWhiteboard } from "@/lib/whiteboard/ai-edit";
import { localizeWhiteboardChange, localizeWhiteboardSummary } from "@/lib/whiteboard/proposal-text";

const zh = createTranslator(messagesFor("zh"));
const en = createTranslator({});

// 訳した後に残ってはいけない、サーバーが作る英語の形。
const SERVER_ENGLISH = /Frame "|\(\d+ (items?|elements?)\)|Move into|Remove from|Arrange \d|(?:Ung|G)roup \d|\(empty\)|\(unnamed\)|color: |style: |size: |\b(rectangle|ellipse|diamond|stickynote)\b|Diagram \(/;

function seqId() {
  let n = 1;
  return () => `id_${n++}`;
}

const op = (value: Record<string, unknown>) => ({
  op: "add_element", ref: null, elementType: null, elementId: null, elementIds: null, text: null, color: null, strokeStyle: null,
  fontSize: null, fromId: null, toId: null, frameId: null, nearId: null, placement: null, layout: null, ungroup: null, ...value,
});

// 改前・改後と、対象の名前（見出しに出る）。
const shown = (change: ProposalChange) => [change.before, change.after, change.target?.type === "elements" ? change.target.name : undefined];

describe("localizing whiteboard proposal descriptions", () => {
  it("translates every description the edit engine writes, keeping the user's text", () => {
    const board = buildStructuredWhiteboard({
      frames: [{ ref: "f", name: "Plan", layout: "row" }],
      items: [
        { ref: "a", type: "rectangle", text: "Research", color: null, frameRef: "f" },
        { ref: "b", type: "ellipse", text: "", color: null, frameRef: null },
        { ref: "c", type: "diamond", text: "Decide", color: null, frameRef: null },
      ],
    }, seqId());
    const idOf = (type: string) => board.data.elements.find((el) => el.type === type)!.id;
    const [research, blank, decide, frame] = [idOf("rectangle"), idOf("ellipse"), idOf("diamond"), idOf("frame")];
    const long = `${"x".repeat(46)}😀 and more words after the cut`;

    const { changes } = applyWhiteboardEdits(board.data, [
      op({ elementType: "stickynote", text: "Interview users", ref: "n1" }),
      op({ elementType: "rectangle", ref: "n2" }),
      op({ elementType: "text", text: long, ref: "n3" }),
      op({ op: "add_frame", text: "Next", elementIds: ["n1", "n3"], ref: "f2" }),
      op({ op: "add_frame", text: "Later" }),
      op({ op: "connect", fromId: research, toId: decide }),
      op({ op: "connect", fromId: blank, toId: "n2", text: "feeds" }),
      op({ op: "update_element", elementId: research, text: "Research · users", color: "Purple", strokeStyle: "dashed", fontSize: "large" }),
      op({ op: "update_element", elementId: blank, color: "#d0ebff" }),
      op({ op: "update_element", elementId: decide, fontSize: "xl" }),
      op({ op: "set_frame", elementIds: [decide], frameId: frame }),
      op({ op: "set_frame", elementIds: [decide, blank], frameId: null }),
      op({ op: "arrange", elementIds: [decide, blank], layout: "cluster", text: "Options" }),
      op({ op: "arrange", elementIds: [research], layout: "column", frameId: frame }),
      op({ op: "arrange", elementIds: [decide, blank], layout: "grid" }),
      op({ op: "group_elements", elementIds: [decide, blank] }),
      op({ op: "group_elements", elementIds: [decide], ungroup: true }),
      op({ op: "delete_elements", elementIds: ["n2"] }),
      op({ op: "delete_elements", elementIds: [research, blank, decide] }),
      op({ op: "update_element", elementId: frame, fontSize: null, text: "Roadmap" }),
    ], seqId());

    expect(changes).toHaveLength(20);
    const translated = changes.map((change) => localizeWhiteboardChange(change, zh));
    for (const [index, change] of translated.entries()) {
      for (const text of shown(change)) expect(text ?? "", `change ${index}: ${JSON.stringify(changes[index])}`).not.toMatch(SERVER_ENGLISH);
    }
    expect(translated[0].after).toBe("便签：Interview users");
    expect(shown(translated[1])).toEqual([undefined, "矩形：（空）", "矩形"]);
    expect(translated[2].after).toBe(`正文：${long}`);
    expect(translated[3].after).toBe("框“Next”（2 个元素）");
    expect(translated[4].after).toBe("框“Later”");
    expect(translated[5].after).toBe("Research -> Decide");
    expect(shown(translated[6])).toEqual([undefined, "椭圆 -> 矩形 (\"feeds\")", "feeds"]);
    expect(shown(translated[7])).toEqual(["Research", "Research · users · 颜色：紫色 · 线型：虚线 · 字号：大", "Research · users"]);
    expect(shown(translated[8])).toEqual([undefined, "颜色：#d0ebff", "椭圆"]);
    expect(shown(translated[9])).toEqual([undefined, "字号：特大", "Decide"]);
    expect(translated[10].after).toBe("移入框“Plan”");
    expect(translated[11].after).toBe("移出框");
    expect(translated[12].after).toBe("将 2 个元素聚成一组，放在框“Options”内");
    expect(translated[13].after).toBe("将 1 个元素排成一列，放在框“Plan”内");
    expect(translated[14].after).toBe("将 2 个元素排成网格");
    expect(translated[15].after).toBe("组合 2 个元素");
    expect(translated[16].after).toBe("取消组合 1 个元素");
    expect(shown(translated[17])).toEqual(["矩形", undefined, "矩形"]);
    expect(translated[18].before).toBe("Research · users, 椭圆, Decide");
    expect(shown(translated[19])).toEqual(["Plan", "Roadmap", "Roadmap"]);
    // 保存した内容は変えない。
    expect(changes[0].after).toBe("stickynote: Interview users");
    // 英語の画面も同じ規則で、読める英語にする。
    expect(localizeWhiteboardChange(changes[0], en).after).toBe("Sticky note: Interview users");
    expect(localizeWhiteboardChange(changes[14], en).after).toBe("Arrange 2 elements in a grid");
    expect(localizeWhiteboardChange(changes[16], en).after).toBe("Ungroup 1 element");
  });

  it("translates the settings of an edit that also writes a text longer than the element's name", () => {
    const board = buildStructuredWhiteboard({ items: [{ ref: "a", type: "rectangle", text: "Research", color: null, frameRef: null }] }, seqId());
    const long = "Interview five users about how they organize their notes · every week";
    const { changes } = applyWhiteboardEdits(board.data, [
      op({ op: "update_element", elementId: board.data.elements[0].id, text: long, color: "red", strokeStyle: "dashed" }),
    ], seqId());

    expect(shown(localizeWhiteboardChange(changes[0], zh))).toEqual([
      "Research", `${long} · 颜色：红色 · 线型：虚线`, `${long.slice(0, 47)}…`,
    ]);
  });

  it("translates the placeholder name of an unnamed frame", () => {
    const board = buildStructuredWhiteboard({
      frames: [{ ref: "f", name: "Plan", layout: null }],
      items: [{ ref: "a", type: "rectangle", text: "Research", color: null, frameRef: null }],
    }, seqId());
    const frame = board.data.elements.find((el) => el.type === "frame")!;
    const research = board.data.elements.find((el) => el.type === "rectangle")!.id;
    frame.name = null;
    const { changes } = applyWhiteboardEdits(board.data, [
      op({ op: "update_element", elementId: frame.id, strokeStyle: "dashed" }),
      op({ op: "set_frame", elementIds: [research], frameId: frame.id }),
      op({ op: "arrange", elementIds: [research], layout: "row", frameId: frame.id }),
      op({ op: "delete_elements", elementIds: [frame.id] }),
    ], seqId());

    const translated = changes.map((change) => localizeWhiteboardChange(change, zh));
    expect(shown(translated[0])[2]).toBe("框");
    expect(translated[1].after).toBe("移入框“框”");
    expect(translated[2].after).toBe("将 1 个元素排成一行，放在框“框”内");
    expect(shown(translated[3])).toEqual(["框", undefined, "框"]);
  });

  it("keeps a frame name with a line break on one summary line, so it is translated", () => {
    const { data, summaryLines } = buildStructuredWhiteboard({ frames: [{ ref: "f", name: "To\r\n\nDo", layout: null }] }, seqId());
    expect(localizeWhiteboardSummary(summaryLines.join("\n"), zh)).toBe("框“To Do”（0 项）");
    // 枠そのものの名前は変えない。
    expect(data.elements[0].name).toBe("To\n\nDo");
  });

  it("translates the new-board summaries of structured items and Mermaid diagrams", async () => {
    const { summaryLines } = buildStructuredWhiteboard({
      frames: [{ ref: "f", name: "To Do", layout: "column" }, { ref: "g", name: "Done", layout: null }],
      items: [
        { ref: "a", type: "stickynote", text: "Ship it", color: null, frameRef: "f" },
        { ref: "b", type: "text", text: "Notes: later", color: null, frameRef: null },
        { ref: "c", type: "rectangle", text: "Box", color: null, frameRef: null },
      ],
    }, seqId());
    expect(localizeWhiteboardSummary(summaryLines.join("\n"), zh)).toBe("框“To Do”（1 项）\n框“Done”（0 项）\n- 正文：Notes: later\n- 矩形：Box");

    const draft = await whiteboardAdapter.create!.propose({ userId: "u", sessionId: "s", excludeMessageIds: [] }, {
      title: "Flow", icon: null, parentId: null, mermaid: "flowchart LR\n  A[User] --> B[App]", frames: null, items: null, connections: null,
    });
    expect(draft.content).toMatch(/^Diagram \(flowchart, \d+ elements\)$/);
    expect(localizeWhiteboardSummary(draft.content, zh)).toMatch(/^图（流程图，\d+ 个元素）$/);
    expect(localizeWhiteboardSummary("Diagram (mindmap, 1 element)", zh)).toBe("图（思维导图，1 个元素）");
    expect(localizeWhiteboardSummary("", zh)).toBe("");
  });

  it("leaves other pages' changes, the user's own words and unknown shapes as they are", () => {
    const slide: ProposalChange = { op: "update", block: 0, target: { type: "slide", number: 2 }, before: "color: red", after: "(empty)" };
    expect(localizeWhiteboardChange(slide, zh)).toEqual(slide);
    const note: ProposalChange = { op: "delete", block: 3, before: "rectangle" };
    expect(localizeWhiteboardChange(note, zh)).toEqual(note);

    // 要素の文字がたまたま種類の名前や記号と同じでも、書いた文字は訳さない。
    const written: ProposalChange = { op: "update", block: 0, target: { type: "elements", count: 1, name: "text" }, before: "(empty)", after: "text" };
    expect(shown(localizeWhiteboardChange(written, zh))).toEqual(["（空）", "text", "text"]);
    const quoted: ProposalChange = { op: "update", block: 0, target: { type: "elements", count: 1, name: "color: red" }, after: "color: red" };
    expect(localizeWhiteboardChange(quoted, zh)).toEqual(quoted);
    // 名前に ", " があって切れ目が分からない一覧は、そのまま。
    const list: ProposalChange = { op: "delete", block: 0, target: { type: "elements", count: 2 }, before: "apples, arrow, pears" };
    expect(localizeWhiteboardChange(list, zh)).toEqual(list);
    const more: ProposalChange = { op: "delete", block: 0, target: { type: "elements", count: 8 }, before: "a, b, c, d, e, arrow (+2)" };
    expect(localizeWhiteboardChange(more, zh).before).toBe("a, b, c, d, e, 箭头 (+2)");
    const unknown: ProposalChange = { op: "add", block: 0, target: { type: "elements", count: 1, name: "x" }, after: "Something new" };
    expect(localizeWhiteboardChange(unknown, zh)).toEqual(unknown);
    expect(localizeWhiteboardSummary("A line the server never wrote", zh)).toBe("A line the server never wrote");
  });
});
