import { convertToExcalidrawElements, setCustomTextMetricsProvider } from "@excalidraw/element";
import { describe, expect, it } from "vitest";
import { mindmapDataOf } from "@/lib/whiteboard/mindmap/model";
import { moveSkeletons, skeletonBounds, templateSkeletons, WHITEBOARD_TEMPLATES, type TemplateLabels } from "@/lib/whiteboard/templates";
import { WHITEBOARD_ELEMENT_TYPES } from "@/lib/whiteboard/scene";
import { withServerDom } from "@/lib/whiteboard/server-dom";

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

  it("centres the timeline and Venn labels on their dots and regions once converted", async () => {
    setCustomTextMetricsProvider({ getLineWidth: (text) => text.length * 10 });
    const centres = (template: "timeline" | "venn") => withServerDom(async () => {
      const elements = convertToExcalidrawElements(templateSkeletons(template, labels) as never, { regenerateIds: false });
      return elements.flatMap((element) => (element.type === "text" ? [[element.originalText, element.x + element.width / 2] as const] : []));
    });
    const dots = templateSkeletons("timeline", labels).filter((item) => item.type === "ellipse").map((item) => (item.x as number) + (item.width as number) / 2);
    const timeline = await centres("timeline");
    expect(timeline.map(([, x]) => x)).toEqual(dots.flatMap((dot) => [dot, dot]));
    // 左の円は 0–440、右の円は 280–720（重なりは 280–440）。
    expect(Object.fromEntries(await centres("venn"))).toEqual({ A: 150, B: 570, Both: 360 });
    // 外接矩形も中心からの幅で数える（枠が中心ぞろえの文字を含むように）。
    const left = templateSkeletons("venn", labels).find((item) => item.type === "text")!;
    expect(skeletonBounds([left]).x).toBe((left.x as number) - (left.width as number) / 2);
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
