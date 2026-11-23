import { SLIDE_HEIGHT, SLIDE_WIDTH, type SlideElement } from "@/lib/slides/model";

// スライドの自由配置の計算（移動・拡大縮小・回転・吸着・整列・等間隔）。座標はスライドの論理ピクセル。純粋な関数だけ（テストあり）。

export type Box = { x: number; y: number; w: number; h: number };
export type Frame = Box & { rotation: number };
export type Guide = { axis: "x" | "y"; at: number; from: number; to: number };

const rad = (degrees: number) => (degrees * Math.PI) / 180;

// 回した要素を囲む、軸に沿った箱。
export function rotatedBounds(frame: Frame): Box {
  if (!frame.rotation) return { x: frame.x, y: frame.y, w: frame.w, h: frame.h };
  const cx = frame.x + frame.w / 2;
  const cy = frame.y + frame.h / 2;
  const cos = Math.abs(Math.cos(rad(frame.rotation)));
  const sin = Math.abs(Math.sin(rad(frame.rotation)));
  const w = frame.w * cos + frame.h * sin;
  const h = frame.w * sin + frame.h * cos;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

export function unionBounds(boxes: Box[]): Box | null {
  if (!boxes.length) return null;
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.w));
  const bottom = Math.max(...boxes.map((box) => box.y + box.h));
  return { x: left, y: top, w: right - left, h: bottom - top };
}

export function elementsBounds(elements: SlideElement[]): Box | null {
  return unionBounds(elements.map(rotatedBounds));
}

// 選んだ ID を、同じグループの要素まで広げる。
export function expandGroups(elements: SlideElement[], ids: Iterable<string>): Set<string> {
  const selected = new Set(ids);
  const groups = new Set(elements.filter((element) => selected.has(element.id) && element.group).map((element) => element.group!));
  for (const element of elements) if (element.group && groups.has(element.group)) selected.add(element.id);
  return selected;
}

// 整列・等間隔で 1 つの塊として扱う単位（グループは 1 つ、ほかは要素ごと）。
export function selectionUnits(elements: SlideElement[], ids: Set<string>): SlideElement[][] {
  const units = new Map<string, SlideElement[]>();
  for (const element of elements) {
    if (!ids.has(element.id)) continue;
    const key = element.group ? `g:${element.group}` : `e:${element.id}`;
    units.set(key, [...(units.get(key) ?? []), element]);
  }
  return [...units.values()];
}

export type AlignMode = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";

// 揃える。塊が 1 つだけならスライドに対して揃える。
export function alignElements(elements: SlideElement[], ids: Set<string>, mode: AlignMode): SlideElement[] {
  const units = selectionUnits(elements, ids);
  if (!units.length) return elements;
  const target = units.length === 1 ? { x: 0, y: 0, w: SLIDE_WIDTH, h: SLIDE_HEIGHT } : elementsBounds(units.flat())!;
  const moves = new Map<string, { dx: number; dy: number }>();
  for (const unit of units) {
    const box = elementsBounds(unit)!;
    let dx = 0;
    let dy = 0;
    if (mode === "left") dx = target.x - box.x;
    if (mode === "hcenter") dx = target.x + target.w / 2 - (box.x + box.w / 2);
    if (mode === "right") dx = target.x + target.w - (box.x + box.w);
    if (mode === "top") dy = target.y - box.y;
    if (mode === "vcenter") dy = target.y + target.h / 2 - (box.y + box.h / 2);
    if (mode === "bottom") dy = target.y + target.h - (box.y + box.h);
    for (const element of unit) moves.set(element.id, { dx, dy });
  }
  return elements.map((element) => {
    const move = moves.get(element.id);
    return move && (move.dx || move.dy) ? { ...element, x: round(element.x + move.dx), y: round(element.y + move.dy) } : element;
  });
}

// 等間隔に並べる（塊が 3 つ以上）。両端の塊は動かさず、間の隙間をそろえる。
export function distributeElements(elements: SlideElement[], ids: Set<string>, axis: "x" | "y"): SlideElement[] {
  const units = selectionUnits(elements, ids).map((unit) => ({ unit, box: elementsBounds(unit)! }));
  if (units.length < 3) return elements;
  const start = (box: Box) => (axis === "x" ? box.x : box.y);
  const size = (box: Box) => (axis === "x" ? box.w : box.h);
  units.sort((a, b) => start(a.box) - start(b.box));
  const first = units[0].box;
  const last = units[units.length - 1].box;
  const total = start(last) + size(last) - start(first);
  const gap = (total - units.reduce((sum, { box }) => sum + size(box), 0)) / (units.length - 1);
  const moves = new Map<string, number>();
  let cursor = start(first);
  for (const { unit, box } of units) {
    const delta = cursor - start(box);
    for (const element of unit) moves.set(element.id, delta);
    cursor += size(box) + gap;
  }
  return elements.map((element) => {
    const delta = moves.get(element.id);
    if (!delta) return element;
    return axis === "x" ? { ...element, x: round(element.x + delta) } : { ...element, y: round(element.y + delta) };
  });
}

const round = (value: number) => Math.round(value * 100) / 100;

// 動かしている箱を、スライドの端・中央と他の要素の端・中央に吸着させる。threshold はスライド座標（画面の数 px 分）。
export function snapBox(box: Box, others: Box[], threshold: number): { dx: number; dy: number; guides: Guide[] } {
  const targetsX = [0, SLIDE_WIDTH / 2, SLIDE_WIDTH, ...others.flatMap((other) => [other.x, other.x + other.w / 2, other.x + other.w])];
  const targetsY = [0, SLIDE_HEIGHT / 2, SLIDE_HEIGHT, ...others.flatMap((other) => [other.y, other.y + other.h / 2, other.y + other.h])];
  const edgesX = [box.x, box.x + box.w / 2, box.x + box.w];
  const edgesY = [box.y, box.y + box.h / 2, box.y + box.h];
  const best = (edges: number[], targets: number[]) => {
    let found: { delta: number; at: number } | null = null;
    for (const edge of edges) for (const target of targets) {
      const delta = target - edge;
      if (Math.abs(delta) <= threshold && (!found || Math.abs(delta) < Math.abs(found.delta))) found = { delta, at: target };
    }
    return found;
  };
  const snapX = best(edgesX, targetsX);
  const snapY = best(edgesY, targetsY);
  const dx = snapX?.delta ?? 0;
  const dy = snapY?.delta ?? 0;
  const moved = { x: box.x + dx, y: box.y + dy, w: box.w, h: box.h };
  const guides: Guide[] = [];
  if (snapX) {
    const related = others.filter((other) => [other.x, other.x + other.w / 2, other.x + other.w].some((value) => Math.abs(value - snapX.at) < 0.5));
    const span = unionBounds([moved, ...related])!;
    guides.push({ axis: "x", at: snapX.at, from: related.length ? span.y : 0, to: related.length ? span.y + span.h : SLIDE_HEIGHT });
  }
  if (snapY) {
    const related = others.filter((other) => [other.y, other.y + other.h / 2, other.y + other.h].some((value) => Math.abs(value - snapY.at) < 0.5));
    const span = unionBounds([moved, ...related])!;
    guides.push({ axis: "y", at: snapY.at, from: related.length ? span.x : 0, to: related.length ? span.x + span.w : SLIDE_WIDTH });
  }
  return { dx, dy, guides };
}

export type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const MIN_SIZE = 8;

// 取っ手で大きさを変える。回した要素では、指の動きを要素の向きに直して計算し、反対側の取っ手の位置を動かさない。
// keepRatio: 縦横比を保つ（Shift、画像の角）。
export function resizeFrame(start: Frame, handle: Handle, dx: number, dy: number, keepRatio: boolean): Frame {
  const angle = rad(start.rotation);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // 指の動きを要素の向きへ。
  const lx = dx * cos + dy * sin;
  const ly = -dx * sin + dy * cos;
  const sx = handle.includes("e") ? 1 : handle.includes("w") ? -1 : 0;
  const sy = handle.includes("s") ? 1 : handle.includes("n") ? -1 : 0;
  let w = Math.max(MIN_SIZE, start.w + sx * lx);
  let h = Math.max(MIN_SIZE, start.h + sy * ly);
  if (keepRatio && start.w > 0 && start.h > 0) {
    const ratio = start.w / start.h;
    if (sx && sy) {
      if (w / ratio > h) h = w / ratio; else w = h * ratio;
    } else if (sx) h = w / ratio;
    else if (sy) w = h * ratio;
  }
  // 反対側（固定する点）の、要素の中心から見た位置。
  const anchorLocal = (size: number, sign: number) => (sign === 0 ? 0 : -sign * size / 2);
  const oldAnchor = { x: anchorLocal(start.w, sx), y: anchorLocal(start.h, sy) };
  const newAnchor = { x: anchorLocal(w, sx), y: anchorLocal(h, sy) };
  // 中心の移動量（要素の向き）を、スライドの向きへ戻す。
  const cx = start.x + start.w / 2;
  const cy = start.y + start.h / 2;
  const shiftX = oldAnchor.x - newAnchor.x;
  const shiftY = oldAnchor.y - newAnchor.y;
  const ncx = cx + shiftX * cos - shiftY * sin;
  const ncy = cy + shiftX * sin + shiftY * cos;
  return { x: round(ncx - w / 2), y: round(ncy - h / 2), w: round(w), h: round(h), rotation: start.rotation };
}

// 中心から指への角度（度）。snap: 15 度ごとに止める（Shift）。
export function rotationFor(frame: Frame, pointerX: number, pointerY: number, snap: boolean): number {
  const cx = frame.x + frame.w / 2;
  const cy = frame.y + frame.h / 2;
  let degrees = (Math.atan2(pointerY - cy, pointerX - cx) * 180) / Math.PI + 90;
  if (snap) degrees = Math.round(degrees / 15) * 15;
  degrees = ((degrees % 360) + 360) % 360;
  if (degrees > 180) degrees -= 360;
  return round(degrees);
}

// 線の端を動かす。線は箱の対角なので、もう一方の端を固定して箱と向きを作り直す。
export function lineEndpoints(line: { x: number; y: number; w: number; h: number; flipH: boolean; flipV: boolean }) {
  const x1 = line.flipH ? line.x + line.w : line.x;
  const x2 = line.flipH ? line.x : line.x + line.w;
  const y1 = line.flipV ? line.y + line.h : line.y;
  const y2 = line.flipV ? line.y : line.y + line.h;
  return { x1, y1, x2, y2 };
}
export function lineFromEndpoints(x1: number, y1: number, x2: number, y2: number) {
  return { x: round(Math.min(x1, x2)), y: round(Math.min(y1, y2)), w: round(Math.abs(x2 - x1)), h: round(Math.abs(y2 - y1)), flipH: x2 < x1, flipV: y2 < y1 };
}

// 箱が範囲選択の枠と重なるか（回した要素は囲む箱で見る）。
export function intersects(a: Box, b: Box) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
