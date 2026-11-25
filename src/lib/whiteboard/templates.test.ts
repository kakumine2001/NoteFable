import { describe, expect, it } from "vitest";
import { mindmapDataOf } from "@/lib/whiteboard/mindmap/model";
import { moveSkeletons, skeletonBounds, templateSkeletons, WHITEBOARD_TEMPLATES, type TemplateLabels } from "@/lib/whiteboard/templates";
import { WHITEBOARD_ELEMENT_TYPES } from "@/lib/whiteboard/scene";

const labels: TemplateLabels = {
  title: "T",
  mindmap: { central: "中心", idea: (n) => `想法 ${n}` },
  cornell: { header: "Topic · Date", cues: "Cues", notes: "Notes", summary: "Summary" },
  timeline: { event: (n) => `Event ${n}`, date: "Date" },
  venn: { left: "A", right: "B", both: "Both" },
  comparison: { aspect: "Aspect", optionA: "Option A", optionB: "Option B", point: (n) => `Point ${n}` },
};

describe("templateSkeletons", () => {
  it.each(WHITEBOARD_TEMPLATES)("builds %s from placeable element types with unique ids and the given text", (template) => {
    let n = 0;
    const skeletons = templateSkeletons(template, labels, () => `id${n++}`);
    expect(skeletons.length).toBeGreaterThan(3);
    expect(new Set(skeletons.map((item) => item.id)).size).toBe(skeletons.length);
    expect(skeletons.every((item) => WHITEBOARD_ELEMENT_TYPES.has(item.type))).toBe(true);
    const texts = JSON.stringify(skeletons);
    if (template === "mindmap") expect(texts).toContain("想法 3");
    else expect(skeletons[0]).toMatchObject({ type: "frame", name: "T" });
  });

  it("puts every non-mindmap part inside its frame", () => {
    for (const template of WHITEBOARD_TEMPLATES.filter((item) => item !== "mindmap")) {
      const [frame, ...parts] = templateSkeletons(template, labels);
      expect((frame.children as string[]).sort()).toEqual(parts.map((part) => part.id).sort());
      const bounds = skeletonBounds(parts);
      expect(frame.x as number).toBeLessThanOrEqual(bounds.x);
      expect((frame.x as number) + (frame.width as number)).toBeGreaterThanOrEqual(bounds.x + bounds.width);
    }
  });

  it("starts the mindmap template as an editable mindmap tree", () => {
    const skeletons = templateSkeletons("mindmap", labels);
    const nodes = skeletons.filter((item) => mindmapDataOf(item.customData)?.role === "node");
    expect(nodes).toHaveLength(4);
  });

  it("moves skeletons without touching relative arrow points", () => {
    const skeletons = templateSkeletons("timeline", labels);
    const moved = moveSkeletons(skeletons, 100, -50);
    expect(moved[1].x).toBe((skeletons[1].x as number) + 100);
    expect(moved[1].points).toEqual(skeletons[1].points);
    expect(skeletonBounds(moved).x).toBeCloseTo(skeletonBounds(skeletons).x + 100);
  });
});
