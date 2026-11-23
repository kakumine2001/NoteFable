import { noteFileUrlName, parseNoteFileUrl } from "@/lib/note-file-keys";
import { shareFileUrl } from "@/lib/note-share";
import { storedToScene, type StoredWhiteboard } from "@/lib/whiteboard/scene";

// 公開リンク（/s/:token）でホワイトボードを見せるときの形。サーバーとテストから使う（Excalidraw の本体は読み込まない）。
// 画像の URL は持ち主だけが読める /api/pages/files ではなく、公開ページ用の /s/:token/file に置き換える。
// /s/:token/file は、そのホワイトボードの files が実際に参照しているファイルだけを返す（whiteboardFileKeys）。

// 本体の files が参照している note-files の保存先（キー）。
export function whiteboardFileKeys(data: unknown): Set<string> {
  const keys = new Set<string>();
  if (typeof data !== "object" || data === null) return keys;
  const files = (data as { files?: unknown }).files;
  if (typeof files !== "object" || files === null || Array.isArray(files)) return keys;
  for (const file of Object.values(files)) {
    if (typeof file !== "object" || file === null) continue;
    for (const value of [(file as { dataURL?: unknown }).dataURL, (file as { url?: unknown }).url]) {
      const parsed = parseNoteFileUrl(value);
      if (parsed && parsed !== "empty") keys.add(parsed.path);
    }
  }
  return keys;
}

// 公開ページで描く scene。消した要素は入れない。画像は公開用の URL、外部へのリンクはそのまま（ページへのリンクは見る画面が公開リンクに読み替える）。
export function publicWhiteboardScene(data: unknown, token: string, pageId: string): StoredWhiteboard {
  const scene = storedToScene(data);
  const files: StoredWhiteboard["files"] = {};
  for (const [id, file] of Object.entries(scene.files)) {
    const parsed = parseNoteFileUrl(file.dataURL);
    if (!parsed || parsed === "empty") continue;
    files[id] = { id, mimeType: file.mimeType, dataURL: shareFileUrl(token, pageId, parsed.path, noteFileUrlName(file.dataURL)) };
  }
  return { elements: scene.elements, files, appState: scene.appState };
}
