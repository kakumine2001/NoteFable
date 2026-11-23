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
