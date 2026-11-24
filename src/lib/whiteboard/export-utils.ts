// ホワイトボードの書き出しの、Excalidraw に頼らない部分（テストする）。

export type WhiteboardExportFormat = "png" | "svg" | "pdf";

// ファイル名に使えない文字を落とす。空なら Whiteboard。
export function exportFileName(title: string, format: WhiteboardExportFormat) {
  const base = title.replace(/[\u0000-\u001f\u007f\\/:*?"<>|]/g, "").replace(/\s+/g, " ").trim().slice(0, 120) || "Whiteboard";
  return `${base === "Untitled" ? "Whiteboard" : base}.${format}`;
}

// 枠を、上から下・左から右の順に並べる（スライドのように読む順）。上から順に見て、行の先頭の枠と縦に半分以上重なる枠を
// 同じ行にまとめ、行の中は左から右。2 つずつ比べる並べ方（順序が推移的にならない）は使わない：並びが入力の順に左右されない。
export function frameOrder<T extends { x: number; y: number; height: number }>(frames: readonly T[]): T[] {
  const sorted = [...frames].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: { top: number; height: number; items: T[] }[] = [];
  for (const frame of sorted) {
    const row = rows.at(-1);
    const overlap = row ? Math.min(row.top + row.height, frame.y + frame.height) - Math.max(row.top, frame.y) : -Infinity;
    if (row && overlap > Math.min(row.height, frame.height) / 2) row.items.push(frame);
    else rows.push({ top: frame.y, height: frame.height, items: [frame] });
  }
  return rows.flatMap((row) => row.items.sort((a, b) => a.x - b.x));
}

// 要素と枠の位置の関係（外接矩形で見る）：枠の中に収まる・一部が重なる・重ならない。
export type FrameRelation = "inside" | "overlap" | "none";

// 外接矩形 [x1, y1, x2, y2] どうしの関係。辺が接するだけでは重ならない（Excalidraw の枠の書き出しの doBoundsIntersect と同じ。
// 枠の辺の上に引いた水平・垂直の線は枠のページに描かれないので、最後のページに入れる必要がある）。
export function boundsRelation(element: readonly [number, number, number, number], frame: readonly [number, number, number, number]): FrameRelation {
  const [ax1, ay1, ax2, ay2] = element;
  const [bx1, by1, bx2, by2] = frame;
  if (ax2 <= bx1 || ax1 >= bx2 || ay2 <= by1 || ay1 >= by2) return "none";
  return ax1 >= bx1 && ay1 >= by1 && ax2 <= bx2 && ay2 <= by2 ? "inside" : "overlap";
}

type PlannedElement = { id: string; type: string; x: number; y: number; height: number; frameId?: string | null; containerId?: string | null };

// PDF の 1 ページに描くもの：枠 1 つ・どの枠にも入っていない要素・白板の全体。
export type PdfPagePlan<T> = { kind: "frame"; frame: T } | { kind: "rest"; elements: T[] } | { kind: "all" };

const isFrameLike = (element: { type: string }) => element.type === "frame" || element.type === "magicframe";

// PDF のページ割り。中身のある枠ごとに 1 ページ（読む順）。どの枠にも入っていない要素があれば、最後にまとめて 1 ページ。
// 空の枠は白紙のページになるので飛ばし、枠の外の要素も落とさない（枠が 1 つでもあると、枠の外が書き出されなかった）。
// 枠が無いとき、また中身のある枠も枠の外の要素も無い（空の枠だけ）ときは、全体を 1 ページにする。
// 枠の中身は Excalidraw の枠の書き出しと同じ：その枠の子か、どの枠の子でもない要素で、枠に重なるもの（ほかの枠の子は、その枠で切り取られる）。
// 枠の子でなくても枠の中に収まる要素は枠のページに描かれるので、最後のページには入れない。一部だけ重なるものは両方に入る（欠けない）。
// 図形・矢印の中の文字は、入れ物と同じページに行く（入っている枠も位置も入れ物で見る）。
// 矢印は Excalidraw でどの枠にも切り取られない（isFrameClippable）。枠の子でも枠の外まで描かれるので、どの枠の子でもないものと同じに扱う：
// 重なる枠のページに描かれ、どの枠にも収まらなければ最後のページにも入る。
// 外接矩形だけが重なって実際には何も描かれない枠もあるので、書き出す側は描いた結果が画布の色だけの枠のページを捨てる（export.ts）。
export function planPdfPages<T extends PlannedElement>(elements: readonly T[], relation: (element: T, frame: T) => FrameRelation): PdfPagePlan<T>[] {
  const frames = frameOrder(elements.filter(isFrameLike));
  if (!frames.length) return [{ kind: "all" }];
  const frameIds = new Set(frames.map((frame) => frame.id));
  const byId = new Map(elements.map((element) => [element.id, element]));
  // 入れ物の中の文字は入れ物で見る。
  const anchorOf = (element: T) => (element.containerId ? byId.get(element.containerId) : undefined) ?? element;
  const unclipped = (anchor: T) => anchor.type === "arrow";
  // 枠のページに描かれるか（Excalidraw の getElementsOverlappingFrame と同じ）：どの枠の子でもないか、この枠の子か、矢印で、枠に重なる。
  // 消えた枠の子（frameId が残っている）はどの枠のページにも描かれない。
  const drawnOn = (anchor: T, frame: T) => (!anchor.frameId || anchor.frameId === frame.id || unclipped(anchor)) && relation(anchor, frame) !== "none";
  // 枠に切り取られる子は、見えている部分がその枠のページにあるので最後のページには入れない（画面でも枠の外は見えない）。
  const clippedChild = (anchor: T) => !unclipped(anchor) && Boolean(anchor.frameId && frameIds.has(anchor.frameId));
  const content = elements.filter((element) => !isFrameLike(element));
  const pages: PdfPagePlan<T>[] = frames
    .filter((frame) => content.some((element) => drawnOn(anchorOf(element), frame)))
    .map((frame) => ({ kind: "frame", frame }));
  // 最後のページ：どの枠のページにも欠けずに描かれない要素。
  const rest = content.filter((element) => {
    const anchor = anchorOf(element);
    return !clippedChild(anchor) && !frames.some((frame) => drawnOn(anchor, frame) && relation(anchor, frame) === "inside");
  });
  if (rest.length) pages.push({ kind: "rest", elements: rest });
  return pages.length ? pages : [{ kind: "all" }];
}
