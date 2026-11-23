import { inNativeApp, nativeCanSaveFile, postToNative } from "@/lib/native-bridge";

// 書き出したファイル（ホワイトボードの PNG・SVG・PDF、スライドの PPTX など）を利用者に渡す。
// - ブラウザー：<a download> でダウンロードする。
// - アプリの中（/note-embed の WebView）：分けてアプリに送り（native-bridge.ts の fileStart / fileChunk / fileEnd）、アプリが保存先を選ばせる。
// 結果：download（ブラウザーで落とした）・app（アプリに渡した）・unsupported（ファイルを受け取れない古いアプリ）・failed（送る途中で失敗）。

// 1 回に送る元のバイト数（base64 にすると約 683 KiB の文字列）。
export const FILE_CHUNK_BYTES = 512 * 1024;
export type SaveExportResult = "download" | "app" | "unsupported" | "failed";

async function base64Of(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const step = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += step) binary += String.fromCharCode(...bytes.subarray(offset, offset + step));
  return btoa(binary);
}

function randomId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

// アプリへ分けて送る。送れなかったら fileAbort を送って false。
export async function sendFileToNative(blob: Blob, name: string, post: typeof postToNative = postToNative): Promise<boolean> {
  const id = randomId();
  const mime = blob.type || "application/octet-stream";
  if (!post({ type: "fileStart", id, name, mime, size: blob.size })) return false;
  for (let index = 0, offset = 0; offset < blob.size; index++, offset += FILE_CHUNK_BYTES) {
    const data = await base64Of(blob.slice(offset, offset + FILE_CHUNK_BYTES));
    if (!post({ type: "fileChunk", id, index, data })) { post({ type: "fileAbort", id }); return false; }
  }
  return post({ type: "fileEnd", id });
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function saveExportFile(blob: Blob, name: string): Promise<SaveExportResult> {
  if (inNativeApp()) {
    // アプリの WebView は blob: のダウンロードを扱えないので、ファイルを受け取れない古いアプリでは何もしない（呼び出し側が理由を出す）。
    if (!nativeCanSaveFile()) return "unsupported";
    return (await sendFileToNative(blob, name)) ? "app" : "failed";
  }
  downloadBlob(blob, name);
  return "download";
}
