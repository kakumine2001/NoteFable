import { msg } from "@/lib/i18n/translate";
import { MAX_NOTE_FILE_BYTES } from "@/lib/note-file-keys";
import { uploadImageBlob } from "@/lib/whiteboard/upload";

// PDF の取り込み：pdf.js でページを 1 枚ずつ画像にして、note-files へアップロードする（ブラウザーの中だけで行う）。
// スマホのメモリを考え、1 ページずつ描いて送り、描いた canvas はすぐに捨てる。1 枚の画素数も抑える。
// worker は自分のサイトから配る（scripts/copy-whiteboard-assets.mjs が public/whiteboard/ へ写す）。

export const MAX_PDF_IMPORT_PAGES = 50;
// PDF ファイルそのものの大きさの上限（読み込みに使うメモリを抑える）。
export const MAX_PDF_IMPORT_BYTES = 50 * 1024 * 1024;
// 1 ページの画像の長い辺と画素数の上限。
const MAX_SIDE = 2000;
const MAX_PIXELS = 3_500_000;

export type ImportedPdfPage = { url: string; mimeType: string; width: number; height: number; page: number };
// failed：途中のページで失敗したときの理由（そこまでのページは pages に入っている。最初のページで失敗したときは投げる）。
export type PdfImportResult = { pages: ImportedPdfPage[]; total: number; name: string; failed?: unknown };

export function isPdfFile(file: File) {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

async function canvasBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error(msg("Could not read this PDF."))), "image/jpeg", quality));
}

export async function importPdfPages(file: File, { onProgress, signal }: { onProgress?: (done: number, total: number) => void; signal?: AbortSignal } = {}): Promise<PdfImportResult> {
  if (!isPdfFile(file)) throw new Error(msg("Choose a PDF file."));
  if (file.size > MAX_PDF_IMPORT_BYTES) throw new Error(msg("This PDF is too large to import (max 50 MB)."));
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/whiteboard/pdf.worker.min.mjs";
  let document;
  try {
    document = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  } catch {
    throw new Error(msg("Could not read this PDF."));
  }
  const name = file.name.replace(/\.pdf$/i, "").trim() || "PDF";
  try {
    const total = Math.min(document.numPages, MAX_PDF_IMPORT_PAGES);
    const pages: ImportedPdfPage[] = [];
    for (let number = 1; number <= total; number++) {
      if (signal?.aborted) break;
      onProgress?.(number - 1, total);
      const page = await document.getPage(number);
      const base = page.getViewport({ scale: 1 });
      let scale = Math.min(2, MAX_SIDE / Math.max(base.width, base.height));
      scale = Math.min(scale, Math.sqrt(MAX_PIXELS / Math.max(1, base.width * base.height)));
      const viewport = page.getViewport({ scale });
      const canvas = globalThis.document.createElement("canvas");
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      const context = canvas.getContext("2d");
      if (!context) throw new Error(msg("Could not read this PDF."));
      // 透明な PDF も白地で見えるように。
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      try {
        await page.render({ canvas, canvasContext: context, viewport }).promise;
        let blob = await canvasBlob(canvas, 0.86);
        if (blob.size > MAX_NOTE_FILE_BYTES) blob = await canvasBlob(canvas, 0.6);
        if (blob.size > MAX_NOTE_FILE_BYTES) throw new Error(msg("A page of this PDF is too large to import."));
        const uploaded = await uploadImageBlob(blob, `${name}-${number}`);
        pages.push({ ...uploaded, width: base.width, height: base.height, page: number });
      } catch (error) {
        // 途中のページで失敗したら（容量の上限・通信など）、アップロードの済んだページは捨てずに取り込む。
        if (!pages.length) throw error;
        return { pages, total: document.numPages, name, failed: error };
      } finally {
        page.cleanup();
        canvas.width = 0;
        canvas.height = 0;
      }
    }
    onProgress?.(pages.length, total);
    return { pages, total: document.numPages, name };
  } finally {
    void document.destroy();
  }
}
