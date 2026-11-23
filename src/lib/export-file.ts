import { nativeCanSaveFile, postToNative } from "@/lib/native-bridge";

// 画面で作ったファイル（スライドの PDF・PNG・PPTX、ホワイトボードの画像など）を保存する。
// アプリ（/note-embed）では、ファイルを base64 に分けてアプリへ渡し、アプリの保存画面で保存してもらう（canSaveFile を持つアプリだけ）。
// ブラウザでは、ふつうのダウンロードにする。

const CHUNK_BYTES = 512 * 1024;

function toBase64(bytes: Uint8Array) {
  let binary = "";
  const step = 0x8000;
  for (let index = 0; index < bytes.length; index += step) binary += String.fromCharCode(...bytes.subarray(index, index + step));
  return btoa(binary);
}

// 保存先に使えない文字を除いたファイル名（拡張子は別に付ける）。
export function exportFileBase(title: string, fallback = "slides") {
  const base = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  return base && base !== "Untitled" ? base : fallback;
}

export async function saveExportFile(blob: Blob, name: string): Promise<"native" | "download"> {
  if (nativeCanSaveFile()) {
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (!postToNative({ type: "fileStart", id, name, mime: blob.type || "application/octet-stream", size: bytes.length })) throw new Error("bridge");
    try {
      for (let index = 0, part = 0; index < bytes.length; index += CHUNK_BYTES, part++) {
        if (!postToNative({ type: "fileChunk", id, index: part, data: toBase64(bytes.subarray(index, index + CHUNK_BYTES)) })) throw new Error("bridge");
        // 大きなファイルでも画面が固まらないよう、ときどき描画に返す。
        if (part % 8 === 7) await new Promise((resolve) => setTimeout(resolve, 0));
      }
    } catch (error) {
      postToNative({ type: "fileAbort", id });
      throw error;
    }
    postToNative({ type: "fileEnd", id });
    return "native";
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return "download";
}
