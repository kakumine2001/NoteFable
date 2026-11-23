// ホワイトボードの書き出しの、Excalidraw に頼らない部分（テストする）。

export type WhiteboardExportFormat = "png" | "svg" | "pdf";

// ファイル名に使えない文字を落とす。空なら Whiteboard。
export function exportFileName(title: string, format: WhiteboardExportFormat) {
  const base = title.replace(/[\u0000-\u001f\u007f\\/:*?"<>|]/g, "").replace(/\s+/g, " ").trim().slice(0, 120) || "Whiteboard";
  return `${base === "Untitled" ? "Whiteboard" : base}.${format}`;
}

// 枠を、上から下・左から右の順に並べる（スライドのように読む順）。
export function frameOrder<T extends { x: number; y: number; height: number }>(frames: readonly T[]): T[] {
  return [...frames].sort((a, b) => {
    // 縦にほぼ同じ高さ（重なっている）なら左から右。
    const overlap = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
    if (overlap > Math.min(a.height, b.height) / 2) return a.x - b.x;
    return a.y - b.y;
  });
}
