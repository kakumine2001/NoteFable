import { useSyncExternalStore } from "react";

// ワークスペースに出すアイコン（サイドバーのロゴ、AI の返答の印、ノートの AI ボタン）を、利用者が好きな絵文字や画像に替えられる。
// 選んだアイコンはこのブラウザにだけ覚える（アカウントには保存しない）。null は既定の NoteFable ロゴ。
// 値は絵文字そのもの、または小さく縮めた画像の data URL。
const KEY = "notefable:app-icon";
const CHANGE_EVENT = "notefable:app-icon-change";
// 保存する画像の一辺（px）。表示は最大でも 30px ほどなので、高精細の画面でも足りる大きさ。
const ICON_IMAGE_SIZE = 96;

export const isImageIcon = (icon: string) => icon.startsWith("data:image/");

function read(): string | null {
  try {
    return window.localStorage.getItem(KEY) || null;
  } catch {
    return null;
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  // 別のタブで替えたときも合わせる。
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

// いまのアイコン。サーバー側と初回描画は既定（null）にして、ハイドレーションの不一致を避ける。
export function useAppIcon() {
  return useSyncExternalStore(subscribe, read, () => null);
}

// 保存できなかったとき（プライベートブラウズ、容量不足）は false。
export function saveAppIcon(icon: string | null) {
  try {
    if (icon) window.localStorage.setItem(KEY, icon);
    else window.localStorage.removeItem(KEY);
  } catch {
    return false;
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
  return true;
}

// 選んだ画像を、中央を正方形に切り抜いて小さく縮める。読めない画像は例外にする。
export async function imageFileToIcon(file: File) {
  const bitmap = await createImageBitmap(file);
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = ICON_IMAGE_SIZE;
    const context = canvas.getContext("2d");
    if (!context || !side) throw new Error("Cannot read the image.");
    context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, ICON_IMAGE_SIZE, ICON_IMAGE_SIZE);
    return canvas.toDataURL("image/png");
  } finally {
    bitmap.close();
  }
}
