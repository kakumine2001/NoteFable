import { noteFileUrlName, parseNoteFileUrl } from "@/lib/note-file-keys";
import { shareFileUrl } from "@/lib/note-share";
import { pageCardOf } from "@/lib/whiteboard/links";
import { storedToScene, type StoredWhiteboard, type WhiteboardElement } from "@/lib/whiteboard/scene";

// 公開リンク（/s/:token）でホワイトボードを見せるときの形。サーバーとテストから使う（Excalidraw の本体は読み込まない）。
// 画像の URL は持ち主だけが読める /api/pages/files ではなく、公開ページ用の /s/:token/file に置き換える。
// /s/:token/file は、そのホワイトボードの files が実際に参照しているファイルだけを返す（whiteboardFileKeys）。

// 生きている画像要素が使う note-files の保存先（キー）。見る画面に渡す scene（storedToScene）と同じものだけ：
// 消した画像・どの要素も使っていないファイル・同じファイルの 2 つ目の URL は読ませない。
export function whiteboardFileKeys(data: unknown): Set<string> {
  const keys = new Set<string>();
  for (const file of Object.values(storedToScene(data).files)) {
    const parsed = parseNoteFileUrl(file.dataURL);
    if (parsed && parsed !== "empty") keys.add(parsed.path);
  }
  return keys;
}

// 公開する要素の customData は、ページカードの印（notefablePage）だけを残す（ほかのアプリの拡張の値を外に出さない）。
function publicElement(element: WhiteboardElement): WhiteboardElement {
  if (element.customData === undefined) return element;
  const { customData, ...rest } = element;
  const card = pageCardOf(customData);
  return card ? { ...rest, customData: { notefablePage: card } } : rest;
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
  return { elements: scene.elements.map(publicElement), files, appState: scene.appState };
}
