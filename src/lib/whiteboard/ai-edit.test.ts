import { describe, expect, it } from "vitest";
import { MAX_WHITEBOARD_ELEMENTS, validateCanvasData } from "@/lib/canvas-document";
import { diagramToWhiteboard } from "@/lib/whiteboard/diagram";
import {
  applyWhiteboardEdits,
  buildStructuredWhiteboard,
  elementBounds,
  MAX_AI_WHITEBOARD_OPS,
  WhiteboardEditError,
} from "@/lib/whiteboard/ai-edit";

function seqId() {
  let n = 1;
  return () => `id_${n++}`;
}

function overlaps(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

describe("buildStructuredWhiteboard", () => {
  it("lays out frames, shapes, sticky notes, and bound arrows deterministically without overlaps", () => {
    const { data, summaryLines, focusIds } = buildStructuredWhiteboard(
      {
        frames: [{ ref: "f1", name: "Phase 1", layout: "row" }],
        items: [
          { ref: "a", type: "rectangle", text: "Research", color: "blue", frameRef: "f1" },
          { ref: "b", type: "stickynote", text: "Interview users", color: "yellow", frameRef: "f1" },
          { ref: "c", type: "diamond", text: "Go / No-Go?", color: "orange", frameRef: null },
          { ref: "d", type: "ellipse", text: "Launch", color: "green", frameRef: null },
        ],
        connections: [
          { fromRef: "a", toRef: "b", label: "feeds", color: "blue" },
          { fromRef: "b", toRef: "c", label: null, color: null },
          { fromRef: "c", toRef: "d", label: "Yes", color: "green" },
        ],
      },
      seqId(),
    );

    expect(() => validateCanvasData("whiteboard", data)).not.toThrow();
    expect(summaryLines.length).toBeGreaterThan(0);
    expect(focusIds.length).toBeGreaterThanOrEqual(8);

    const frame = data.elements.find((el) => el.type === "frame");
    expect(frame).toBeTruthy();
    expect(frame!.name).toBe("Phase 1");

    const rect = data.elements.find((el) => el.type === "rectangle")!;
    const sticky = data.elements.find((el) => el.type === "stickynote")!;
    const diamond = data.elements.find((el) => el.type === "diamond")!;
    const ellipse = data.elements.find((el) => el.type === "ellipse")!;
    expect(rect.frameId).toBe(frame!.id);
    expect(sticky.frameId).toBe(frame!.id);
    expect(overlaps(elementBounds(rect), elementBounds(sticky))).toBe(false);
    expect(overlaps(elementBounds(diamond), elementBounds(ellipse))).toBe(false);

    // Every arrow is bound on both ends and endpoints record boundElements.
    const arrows = data.elements.filter((el) => el.type === "arrow");
    expect(arrows).toHaveLength(3);
    for (const arrow of arrows) {
      expect((arrow.startBinding as { elementId?: string })?.elementId).toBeTruthy();
      expect((arrow.endBinding as { elementId?: string })?.elementId).toBeTruthy();
    }
    const rectBound = (rect.boundElements as { id: string; type: string }[]) ?? [];
    expect(rectBound.some((b) => b.type === "arrow")).toBe(true);
    expect(rectBound.some((b) => b.type === "text")).toBe(true);
  });

  it("rejects duplicate refs, unknown frameRef, and self-connections", () => {
    expect(() =>
      buildStructuredWhiteboard({
        items: [
          { ref: "x", type: "rectangle", text: "A", color: null, frameRef: null },
          { ref: "x", type: "rectangle", text: "B", color: null, frameRef: null },
        ],
      }),
    ).toThrow(WhiteboardEditError);

    expect(() =>
      buildStructuredWhiteboard({
        items: [{ ref: "x", type: "rectangle", text: "A", color: null, frameRef: "missing" }],
      }),
    ).toThrow(WhiteboardEditError);

    expect(() =>
      buildStructuredWhiteboard({
        items: [{ ref: "x", type: "rectangle", text: "A", color: null, frameRef: null }],
        connections: [{ fromRef: "x", toRef: "x", label: null, color: null }],
      }),
    ).toThrow(WhiteboardEditError);
  });
});

describe("applyWhiteboardEdits", () => {
  it("supports add_element, add_frame, connect, update_element, set_frame, arrange, group_elements, and preserves customData", () => {
    const initial = buildStructuredWhiteboard(
      {
        items: [
          { ref: "n1", type: "rectangle", text: "API", color: "blue", frameRef: null },
          { ref: "n2", type: "rectangle", text: "DB", color: "green", frameRef: null },
        ],
        connections: [{ fromRef: "n1", toRef: "n2", label: "SQL", color: null }],
      },
      seqId(),
    ).data;

    const apiEl = initial.elements.find((el) => el.type === "rectangle")!;
    const dbEl = initial.elements.filter((el) => el.type === "rectangle")[1]!;
    apiEl.customData = { notefablePage: { id: "page_99", kind: "note" } };

    const edited = applyWhiteboardEdits(
      initial,
      [
        {
          op: "add_frame",
          ref: "fr_backend",
          elementType: null,
          elementId: null,
          elementIds: [apiEl.id, dbEl.id],
          text: "Backend",
          color: null,
          strokeStyle: null,
          fontSize: null,
          fromId: null,
          toId: null,
          frameId: null,
          nearId: null,
          placement: null,
          layout: null,
          ungroup: null,
        },
        {
          op: "add_element",
          ref: "cache",
          elementType: "stickynote",
          elementId: null,
          elementIds: null,
          text: "Add Redis cache",
          color: "yellow",
          strokeStyle: null,
          fontSize: "medium",
          fromId: null,
          toId: null,
          frameId: "fr_backend",
          nearId: apiEl.id,
          placement: "below",
          layout: null,
          ungroup: null,
        },
        {
          op: "connect",
          ref: null,
          elementType: null,
          elementId: null,
          elementIds: null,
          text: "reads",
          color: "orange",
          strokeStyle: "dashed",
          fontSize: null,
          fromId: apiEl.id,
          toId: "cache",
          frameId: null,
          nearId: null,
          placement: null,
          layout: null,
          ungroup: null,
        },
        {
          op: "update_element",
          ref: null,
          elementType: null,
          elementId: apiEl.id,
          elementIds: null,
          text: "API Gateway",
          color: "purple",
          strokeStyle: "solid",
          fontSize: "large",
          fromId: null,
          toId: null,
          frameId: null,
          nearId: null,
          placement: null,
          layout: null,
          ungroup: null,
        },
        {
          op: "arrange",
          ref: null,
          elementType: null,
          elementId: null,
          elementIds: [apiEl.id, dbEl.id, "cache"],
          text: null,
          color: null,
          strokeStyle: null,
          fontSize: null,
          fromId: null,
          toId: null,
          frameId: "fr_backend",
          nearId: null,
          placement: null,
          layout: "row",
          ungroup: null,
        },
        {
          op: "group_elements",
          ref: null,
          elementType: null,
          elementId: null,
          elementIds: [apiEl.id, dbEl.id],
          text: null,
          color: null,
          strokeStyle: null,
          fontSize: null,
          fromId: null,
          toId: null,
          frameId: null,
          nearId: null,
          placement: null,
          layout: null,
          ungroup: false,
        },
      ],
      seqId(),
    );

    expect(edited.unchanged).toBe(false);
    expect(() => validateCanvasData("whiteboard", edited.data)).not.toThrow();
    expect(edited.changes.length).toBe(6);

    const nextApi = edited.data.elements.find((el) => el.id === apiEl.id)!;
    const nextDb = edited.data.elements.find((el) => el.id === dbEl.id)!;
    const nextCache = edited.data.elements.find((el) => el.type === "stickynote")!;
    const frame = edited.data.elements.find((el) => el.type === "frame")!;

    // customData preserved!
    expect(nextApi.customData).toEqual({ notefablePage: { id: "page_99", kind: "note" } });
    // Updated text reflected on bound text element.
    const apiText = edited.data.elements.find((el) => el.type === "text" && el.containerId === apiEl.id)!;
    expect(apiText.originalText).toBe("API Gateway");
    expect(nextApi.strokeColor).toBe("#9c36b5");
    // All three in the frame and arranged in a non-overlapping row.
    expect(nextApi.frameId).toBe(frame.id);
    expect(nextDb.frameId).toBe(frame.id);
    expect(nextCache.frameId).toBe(frame.id);
    expect(overlaps(elementBounds(nextApi), elementBounds(nextDb))).toBe(false);
    expect(overlaps(elementBounds(nextDb), elementBounds(nextCache))).toBe(false);
    expect((nextApi.x as number)).toBeLessThan(nextDb.x as number);
    expect((nextDb.x as number)).toBeLessThan(nextCache.x as number);
    // Grouped together.
    expect((nextApi.groupIds as string[]).length).toBe(1);
    expect(nextDb.groupIds).toEqual(nextApi.groupIds);
    // Arrow between api and cache exists and is bound.
    const cacheArrow = edited.data.elements.find(
      (el) => el.type === "arrow" && (el.endBinding as { elementId?: string })?.elementId === nextCache.id,
    );
    expect(cacheArrow).toBeTruthy();
    expect(cacheArrow!.strokeStyle).toBe("dashed");
  });

  it("deletes shapes with bound text and clears dangling arrow bindings, and cascades mindmap node deletions", async () => {
    const mm = await diagramToWhiteboard("mindmap\n  root((Study))\n    Math\n      Algebra\n      Calculus\n    Physics");
    const mathText = mm.data.elements.find((el) => el.type === "text" && el.originalText === "Math")!;
    const mathNodeId = mathText.containerId as string;
    const physicsText = mm.data.elements.find((el) => el.type === "text" && el.originalText === "Physics")!;
    const physicsNodeId = physicsText.containerId as string;

    const deleted = applyWhiteboardEdits(
      mm.data,
      [{
        op: "delete_elements",
        ref: null, elementType: null, elementId: null, elementIds: [mathNodeId],
        text: null, color: null, strokeStyle: null, fontSize: null,
        fromId: null, toId: null, frameId: null, nearId: null, placement: null, layout: null, ungroup: null,
      }],
      seqId(),
    );

    expect(() => validateCanvasData("whiteboard", deleted.data)).not.toThrow();
    const texts = deleted.data.elements.filter((el) => el.type === "text").map((el) => el.originalText);
    expect(texts).not.toContain("Math");
    expect(texts).not.toContain("Algebra");
    expect(texts).not.toContain("Calculus");
    expect(texts).toContain("Study");
    expect(texts).toContain("Physics");
    // Remaining node is still intact.
    expect(deleted.data.elements.some((el) => el.id === physicsNodeId)).toBe(true);
  });

  it("arranges elements into a new named frame and supports set_frame removal", () => {
    const initial = buildStructuredWhiteboard(
      {
        items: [
          { ref: "s1", type: "stickynote", text: "Idea 1", color: "yellow", frameRef: null },
          { ref: "s2", type: "stickynote", text: "Idea 2", color: "yellow", frameRef: null },
          { ref: "s3", type: "stickynote", text: "Idea 3", color: "yellow", frameRef: null },
        ],
      },
      seqId(),
    ).data;
    const stickyIds = initial.elements.filter((el) => el.type === "stickynote").map((el) => el.id);

    const arranged = applyWhiteboardEdits(
      initial,
      [{
        op: "arrange",
        ref: "ideas_frame", elementType: null, elementId: null, elementIds: stickyIds,
        text: "Ideas", color: null, strokeStyle: null, fontSize: null,
        fromId: null, toId: null, frameId: null, nearId: null, placement: null, layout: "cluster", ungroup: null,
      }],
      seqId(),
    );

    const frame = arranged.data.elements.find((el) => el.type === "frame")!;
    expect(frame.name).toBe("Ideas");
    expect(arranged.data.elements.filter((el) => el.type === "stickynote").every((el) => el.frameId === frame.id)).toBe(true);

    // Now remove one sticky from the frame.
    const removed = applyWhiteboardEdits(
      arranged.data,
      [{
        op: "set_frame",
        ref: null, elementType: null, elementId: null, elementIds: [stickyIds[0]],
        text: null, color: null, strokeStyle: null, fontSize: null,
        fromId: null, toId: null, frameId: null, nearId: null, placement: null, layout: null, ungroup: null,
      }],
      seqId(),
    );
    expect(removed.data.elements.find((el) => el.id === stickyIds[0])?.frameId).toBeNull();
    expect(removed.data.elements.find((el) => el.id === stickyIds[1])?.frameId).toBe(frame.id);
  });

  it("enforces op count, element limit, and reports unchanged when nothing changed", () => {
    const empty = { elements: [] };
    const noop = applyWhiteboardEdits(empty, [], seqId());
    expect(noop.unchanged).toBe(true);

    const tooManyOps = Array.from({ length: MAX_AI_WHITEBOARD_OPS + 1 }, () => ({
      op: "add_element", elementType: "rectangle", text: "x",
    }));
    expect(() => applyWhiteboardEdits(empty, tooManyOps, seqId())).toThrow(WhiteboardEditError);

    const nearLimit = {
      elements: Array.from({ length: MAX_WHITEBOARD_ELEMENTS }, (_, idx) => ({
        id: `e_${idx}`,
        type: "rectangle",
        x: idx * 10,
        y: 0,
        width: 8,
        height: 8,
      })),
    };
    expect(() =>
      applyWhiteboardEdits(nearLimit, [{ op: "add_element", elementType: "rectangle", text: "overflow" }], seqId()),
    ).toThrow(/20,000-element/);
  });
});
