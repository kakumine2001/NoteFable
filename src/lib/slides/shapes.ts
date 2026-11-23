import { msg } from "@/lib/i18n/translate";
import type { ShapeKind } from "@/lib/slides/model";

// 図形の輪郭（SVG のパス）。PPTX の既定の図形（prstGeom）と同じ形・同じ既定の調整値にそろえ、書き出しても見た目が変わらないようにする。
const f = (value: number) => Math.round(value * 100) / 100;
const polygon = (points: [number, number][]) => `M${points.map(([x, y]) => `${f(x)},${f(y)}`).join(" L")} Z`;

export function shapePath(shape: ShapeKind, w: number, h: number): string {
  const min = Math.min(w, h);
  switch (shape) {
    case "rect": return polygon([[0, 0], [w, 0], [w, h], [0, h]]);
    case "roundRect": {
      const r = min * 0.16667;
      return `M${f(r)},0 H${f(w - r)} A${f(r)},${f(r)} 0 0 1 ${f(w)},${f(r)} V${f(h - r)} A${f(r)},${f(r)} 0 0 1 ${f(w - r)},${f(h)} H${f(r)} A${f(r)},${f(r)} 0 0 1 0,${f(h - r)} V${f(r)} A${f(r)},${f(r)} 0 0 1 ${f(r)},0 Z`;
    }
    case "ellipse": return `M0,${f(h / 2)} A${f(w / 2)},${f(h / 2)} 0 1 1 ${f(w)},${f(h / 2)} A${f(w / 2)},${f(h / 2)} 0 1 1 0,${f(h / 2)} Z`;
    case "triangle": return polygon([[w / 2, 0], [w, h], [0, h]]);
    case "rightTriangle": return polygon([[0, 0], [w, h], [0, h]]);
    case "diamond": return polygon([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]);
    case "pentagon": return polygon([[w / 2, 0], [w, h * 0.382], [w * 0.809, h], [w * 0.191, h], [0, h * 0.382]]);
    case "hexagon": { const o = min * 0.25; return polygon([[o, 0], [w - o, 0], [w, h / 2], [w - o, h], [o, h], [0, h / 2]]); }
    case "star": {
      // 正五芒星（内側の半径は外側の 0.382）を、上の頂点が上端、下の 2 つの頂点が下端に来るよう箱に合わせる。
      const points: [number, number][] = [];
      for (let index = 0; index < 10; index++) {
        const radius = index % 2 === 0 ? 1 : 0.382;
        const angle = -Math.PI / 2 + (index * Math.PI) / 5;
        points.push([((Math.cos(angle) * radius + 0.9511) / 1.9022) * w, ((Math.sin(angle) * radius + 1) / 1.809) * h]);
      }
      return polygon(points);
    }
    case "arrowRight": { const head = min * 0.5; return polygon([[0, h * 0.25], [w - head, h * 0.25], [w - head, 0], [w, h / 2], [w - head, h], [w - head, h * 0.75], [0, h * 0.75]]); }
    case "arrowLeft": { const head = min * 0.5; return polygon([[w, h * 0.25], [head, h * 0.25], [head, 0], [0, h / 2], [head, h], [head, h * 0.75], [w, h * 0.75]]); }
    case "chevron": { const d = min * 0.5; return polygon([[0, 0], [w - d, 0], [w, h / 2], [w - d, h], [0, h], [d, h / 2]]); }
    case "parallelogram": { const o = min * 0.25; return polygon([[o, 0], [w, 0], [w - o, h], [0, h]]); }
    case "plus": { const o = min * 0.25; return polygon([[o, 0], [w - o, 0], [w - o, o], [w, o], [w, h - o], [w - o, h - o], [w - o, h], [o, h], [o, h - o], [0, h - o], [0, o], [o, o]]); }
    case "callout": return polygon([[0, 0], [w, 0], [w, h], [w * 0.5833, h], [w * 0.2917, h * 1.125], [w * 0.3333, h], [0, h]]);
  }
}

// PPTX（PptxGenJS の ShapeType）での名前。
export const PPTX_SHAPES: Record<ShapeKind, string> = {
  rect: "rect", roundRect: "roundRect", ellipse: "ellipse", triangle: "triangle", rightTriangle: "rtTriangle", diamond: "diamond",
  pentagon: "pentagon", hexagon: "hexagon", star: "star5", arrowRight: "rightArrow", arrowLeft: "leftArrow", chevron: "chevron",
  parallelogram: "parallelogram", plus: "plus", callout: "wedgeRectCallout",
};

export const SHAPE_LABELS: Record<ShapeKind, string> = {
  rect: msg("Rectangle"), roundRect: msg("Rounded rectangle"), ellipse: msg("Ellipse"), triangle: msg("Triangle"), rightTriangle: msg("Right triangle"),
  diamond: msg("Diamond"), pentagon: msg("Pentagon"), hexagon: msg("Hexagon"), star: msg("Star"), arrowRight: msg("Right arrow"), arrowLeft: msg("Left arrow"),
  chevron: msg("Chevron"), parallelogram: msg("Parallelogram"), plus: msg("Plus"), callout: msg("Speech bubble"),
};
