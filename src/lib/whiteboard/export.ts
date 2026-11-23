import { exportScene } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI, BinaryFiles } from "@excalidraw/excalidraw/types";
import type { NonDeletedExcalidrawElement, ExcalidrawFrameLikeElement } from "@excalidraw/excalidraw/element/types";
import { msg } from "@/lib/i18n/translate";
import { nativeCanSaveFile, postToNative } from "@/lib/native-bridge";
import { buildPdf, rgbaToRgb, type PdfImage, type PdfPage } from "@/lib/whiteboard/pdf-writer";

// ホワイトボードの書き出し（PNG・SVG・PDF）。いつも浅色（白地）で書き出す（印刷・共有しても読みやすいように）。
// PDF は枠（Frame）ごとに 1 ページ。枠が無ければ全体を 1 ページにする。
// 画像は note-files の URL のまま描ける（同じサイト）が、SVG はファイルの外で開くので、画像を data: に埋め込む。

export type WhiteboardExportFormat = "png" | "svg" | "pdf";
export type ExportedFile = { blob: Blob; fileName: string; mimeType: string };

const MIME: Record<WhiteboardExportFormat, string> = { png: "image/png", svg: "image/svg+xml", pdf: "application/pdf" };
const PADDING = 32;
// 1 枚の画素数の上限（スマホの Safari の canvas の上限 16.7M より小さく）。
const MAX_PIXELS = 16_000_000;
const scaleFor = (preferred: number) => (width: number, height: number) => Math.max(0.1, Math.min(preferred, Math.sqrt(MAX_PIXELS / Math.max(1, width * height))));

// ファイル名に使えない文字を落とす。空なら Whiteboard。
export function exportFileName(title: string, format: WhiteboardExportFormat) {
  const base = title.replace(/[\u0000-\u001f\u007f\\/:*?"<>|]/g, "").replace(/\s+/g, " ").trim().slice(0, 120) || "Whiteboard";
  return `${base === "Untitled" ? "Whiteboard" : base}.${format}`;
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// 使っている画像だけを、data: URL にして渡す（SVG のため）。
async function inlineFiles(files: BinaryFiles, elements: readonly NonDeletedExcalidrawElement[]): Promise<BinaryFiles> {
  const used = new Set(elements.filter((element) => element.type === "image").map((element) => (element as { fileId?: string | null }).fileId).filter(Boolean) as string[]);
  const out: BinaryFiles = {};
  await Promise.all([...used].map(async (id) => {
    const file = files[id];
    if (!file) return;
    if (file.dataURL.startsWith("data:")) { out[id] = file; return; }
    const response = await fetch(file.dataURL);
    if (!response.ok) return;
    out[id] = { ...file, dataURL: await blobToDataUrl(await response.blob()) as typeof file.dataURL };
  }));
  return out;
}

function sceneData(api: ExcalidrawImperativeAPI, elements: readonly NonDeletedExcalidrawElement[], files: BinaryFiles) {
  const appState = api.getAppState();
  return { elements, files, appState: { viewBackgroundColor: appState.viewBackgroundColor } } as Parameters<typeof exportScene>[0]["data"];
}

async function canvasToPdfImage(canvas: HTMLCanvasElement): Promise<PdfImage> {
  const context = canvas.getContext("2d");
  if (context && typeof CompressionStream !== "undefined") {
    const rgb = rgbaToRgb(context.getImageData(0, 0, canvas.width, canvas.height).data);
    const stream = new Blob([rgb as BlobPart]).stream().pipeThrough(new CompressionStream("deflate"));
    const data = new Uint8Array(await new Response(stream).arrayBuffer());
    return { kind: "flate", data, pixelWidth: canvas.width, pixelHeight: canvas.height };
  }
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error(msg("Could not export the whiteboard."))), "image/jpeg", 0.92));
  return { kind: "jpeg", data: new Uint8Array(await blob.arrayBuffer()), pixelWidth: canvas.width, pixelHeight: canvas.height };
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

export async function exportWhiteboard(api: ExcalidrawImperativeAPI, format: WhiteboardExportFormat, title: string): Promise<ExportedFile> {
  const elements = api.getSceneElements();
  if (!elements.length) throw new Error(msg("This whiteboard is empty."));
  const mimeType = MIME[format];
  const fileName = exportFileName(title, format);
  if (format === "svg") {
    const files = await inlineFiles(api.getFiles(), elements);
    const svg = await exportScene({ type: "svg", data: sceneData(api, elements, files), config: { padding: PADDING, theme: "light" } });
    const text = new XMLSerializer().serializeToString(svg);
    return { blob: new Blob([text], { type: mimeType }), fileName, mimeType };
  }
  if (format === "png") {
    const blob = await exportScene({ type: "png", data: sceneData(api, elements, api.getFiles()), config: { padding: PADDING, theme: "light", scale: scaleFor(2) } });
    return { blob, fileName, mimeType };
  }
  const frames = frameOrder(elements.filter((element) => element.type === "frame" || element.type === "magicframe") as unknown as ExcalidrawFrameLikeElement[]);
  const pages: PdfPage[] = [];
  const targets: (ExcalidrawFrameLikeElement | null)[] = frames.length ? frames : [null];
  for (const frame of targets) {
    // 実際に使った倍率を覚えておき、元の大きさ（1 CSS ピクセル = 0.75 ポイント）のページにする。
    let used = 2;
    const pick = scaleFor(2);
    const canvas = await exportScene({
      type: "canvas",
      data: sceneData(api, elements, api.getFiles()),
      config: { theme: "light", scale: (width: number, height: number) => (used = pick(width, height)), ...(frame ? { exportingFrame: frame as never, padding: 0 } : { padding: PADDING }) },
    });
    pages.push({ width: (canvas.width / used) * 0.75, height: (canvas.height / used) * 0.75, image: await canvasToPdfImage(canvas) });
    canvas.width = 0;
    canvas.height = 0;
  }
  const bytes = buildPdf(pages, { title: title === "Untitled" ? undefined : title });
  return { blob: new Blob([bytes as BlobPart], { type: mimeType }), fileName, mimeType };
}

// 書き出したファイルを渡す：アプリの中（/note-embed）ではアプリに保存してもらい、ブラウザーではダウンロードする。
// アプリがファイルを受け取れない（古いアプリ）ときは false（呼び出し側が理由を出す）。
export async function deliverExport(file: ExportedFile, embedded: boolean): Promise<boolean> {
  if (embedded) {
    if (!nativeCanSaveFile()) return false;
    const dataUrl = await blobToDataUrl(file.blob);
    return postToNative({ type: "saveFile", name: file.fileName, mimeType: file.mimeType, data: dataUrl.slice(dataUrl.indexOf(",") + 1) });
  }
  const url = URL.createObjectURL(file.blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.fileName;
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return true;
}
