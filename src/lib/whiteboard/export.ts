import { exportScene, getCommonBounds, isInvisiblySmallElement } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI, BinaryFiles } from "@excalidraw/excalidraw/types";
import type { NonDeletedExcalidrawElement, ExcalidrawFrameLikeElement } from "@excalidraw/excalidraw/element/types";
import { msg } from "@/lib/i18n/translate";
import { buildPdf, isBlankRgb, rgbaToRgb, type PdfImage, type PdfPage } from "@/lib/whiteboard/pdf-writer";
import { boundsRelation, exportFileName, planPdfPages, type FrameRelation, type PdfPagePlan, type WhiteboardExportFormat } from "@/lib/whiteboard/export-utils";

export type { WhiteboardExportFormat };

// ホワイトボードの書き出し（PNG・SVG・PDF）。いつも浅色（白地）で書き出す（印刷・共有しても読みやすいように）。
// PDF は中身のある枠（Frame）ごとに 1 ページで、どの枠にも入っていない要素は最後の 1 ページ。枠が無ければ全体を 1 ページにする（planPdfPages）。
// 画像は note-files の URL のまま描ける（同じサイト）が、SVG はファイルの外で開くので、画像を data: に埋め込む。

export type ExportedFile = { blob: Blob; fileName: string; mimeType: string };

const MIME: Record<WhiteboardExportFormat, string> = { png: "image/png", svg: "image/svg+xml", pdf: "application/pdf" };
const PADDING = 32;
// 1 枚の画素数の上限（スマホの Safari の canvas の上限 16.7M より小さく）と、一辺の上限（ブラウザーの canvas の辺の上限より小さく）。
const MAX_PIXELS = 16_000_000;
const MAX_SIDE = 16_000;
// どちらの上限も超えない倍率（とても広い白板では 1 より小さくなる。下限で上限を超えることはしない）。
export const scaleFor = (preferred: number) => (width: number, height: number) =>
  Math.min(preferred, Math.sqrt(MAX_PIXELS / Math.max(1, width * height)), MAX_SIDE / Math.max(1, width, height));

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

// 可逆（Flate）が大きくなるページ（取り込んだ PDF・写真など）は、半分より小さくなるなら JPEG にする（線と文字だけのページは Flate のまま）。
const FLATE_CHECK_BYTES = 2 * 1024 * 1024;

async function jpegOf(canvas: HTMLCanvasElement): Promise<PdfImage> {
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error(msg("Could not export the whiteboard."))), "image/jpeg", 0.92));
  return { kind: "jpeg", data: new Uint8Array(await blob.arrayBuffer()), pixelWidth: canvas.width, pixelHeight: canvas.height };
}

// skipBlank のときは、真っ白（何も描かれていない）なら null を返す。
async function canvasToPdfImage(canvas: HTMLCanvasElement, skipBlank: boolean): Promise<PdfImage | null> {
  const context = canvas.getContext("2d");
  if (context && typeof CompressionStream !== "undefined") {
    const rgb = rgbaToRgb(context.getImageData(0, 0, canvas.width, canvas.height).data);
    if (skipBlank && isBlankRgb(rgb)) return null;
    const stream = new Blob([rgb as BlobPart]).stream().pipeThrough(new CompressionStream("deflate"));
    const data = new Uint8Array(await new Response(stream).arrayBuffer());
    const flate: PdfImage = { kind: "flate", data, pixelWidth: canvas.width, pixelHeight: canvas.height };
    if (data.byteLength <= FLATE_CHECK_BYTES) return flate;
    const jpeg = await jpegOf(canvas);
    return jpeg.data.byteLength * 2 < data.byteLength ? jpeg : flate;
  }
  return jpegOf(canvas);
}

// 要素と枠の外接矩形の関係（ページ割りに使う。Excalidraw の枠の書き出しも外接矩形の重なりで中身を選ぶ）。
function frameRelation() {
  const cache = new Map<string, readonly [number, number, number, number]>();
  const bounds = (element: NonDeletedExcalidrawElement) => {
    let value = cache.get(element.id);
    if (!value) { value = getCommonBounds([element]); cache.set(element.id, value); }
    return value;
  };
  return (element: NonDeletedExcalidrawElement, frame: NonDeletedExcalidrawElement): FrameRelation => boundsRelation(bounds(element), bounds(frame));
}

// PDF の 1 ページを描く。枠のページで、描いた結果が真っ白なら null（外接矩形だけが枠に重なっていた）。
async function renderPdfPage(api: ExcalidrawImperativeAPI, page: PdfPagePlan<NonDeletedExcalidrawElement>, elements: readonly NonDeletedExcalidrawElement[], files: BinaryFiles): Promise<PdfPage | null> {
  const frame = page.kind === "frame" ? page.frame as ExcalidrawFrameLikeElement : null;
  // 実際に使った倍率を覚えておき、元の大きさ（1 CSS ピクセル = 0.75 ポイント）のページにする。
  let used = 2;
  const pick = scaleFor(2);
  const canvas = await exportScene({
    type: "canvas",
    // 最後のページ（どの枠にも入っていない要素）は、その要素だけを描く。
    data: sceneData(api, page.kind === "rest" ? page.elements : elements, files),
    config: { theme: "light", scale: (width: number, height: number) => (used = pick(width, height)), ...(frame ? { exportingFrame: frame as never, padding: 0 } : { padding: PADDING }) },
  });
  try {
    const image = await canvasToPdfImage(canvas, frame !== null);
    return image && { width: (canvas.width / used) * 0.75, height: (canvas.height / used) * 0.75, image };
  } finally {
    // 大きな canvas はすぐ放す（スマホのメモリ）。
    canvas.width = 0;
    canvas.height = 0;
  }
}

export async function exportWhiteboard(api: ExcalidrawImperativeAPI, format: WhiteboardExportFormat, title: string): Promise<ExportedFile> {
  // 書き出しでは消える、大きさの無い要素（点 1 つの線など）しか無いときも「空」と言う（何も描かれない画像を作らない）。
  const elements = api.getSceneElements().filter((element) => !isInvisiblySmallElement(element));
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
  const pages: PdfPage[] = [];
  const files = api.getFiles();
  for (const page of planPdfPages(elements, frameRelation())) {
    const rendered = await renderPdfPage(api, page, elements, files);
    if (rendered) pages.push(rendered);
  }
  // 枠のページがどれも真っ白で、枠の外にも何も無かったときは、全体を 1 ページにする（空のファイルにしない）。
  if (!pages.length) pages.push((await renderPdfPage(api, { kind: "all" }, elements, files))!);
  const bytes = buildPdf(pages, { title: title === "Untitled" ? undefined : title });
  return { blob: new Blob([bytes as BlobPart], { type: mimeType }), fileName, mimeType };
}
