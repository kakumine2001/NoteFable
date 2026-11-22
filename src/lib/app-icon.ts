import { useSyncExternalStore } from "react";

// ワークスペース全体（空の会話のキャラクター、AI の返答のアイコン、サイドバー、ノートの AI ボタン、設定の見本）で使う
// AI キャラクター／カスタム画像の設定。このブラウザの localStorage に保存する。ログインしていれば、アカウントにも保存して
// 端末間で同期する（サーバーの値が優先。app-icon-sync.ts と /api/app-icon）。未ログインの端末ではこの端末だけの設定。
// null（未設定）は既定キャラクターの Quill（D · Quill）。
// プリセットは "character:<id>"（Quill は null に正規化）、アップロード画像は "data:image/..." のまま保持する。
// 旧バージョンの絵文字や不明な値は自動で既定キャラクター（null -> Quill）へ移行する。
const KEY = "notefable:app-icon";
const CHANGE_EVENT = "notefable:app-icon-change";
// 保存する画像の一辺（px）。
const ICON_IMAGE_SIZE = 96;

export { CHARACTER_ICON_PREFIX, isImageIcon, normalizeAppIcon, parseCharacterIcon, resolveAppIcon, toCharacterIcon, type ResolvedAppIcon } from "@/lib/app-icon-value";
import { isImageIcon, normalizeAppIcon, parseCharacterIcon, resolveAppIcon, toCharacterIcon, type ResolvedAppIcon } from "@/lib/app-icon-value";

// この端末に保存している値（正規化済み）。読めなければ null（既定）。
export function readAppIcon(): string | null {
  try {
    return normalizeAppIcon(window.localStorage.getItem(KEY));
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

// いまのアイコン設定（正規化済み）。サーバー側と初回描画は既定（null = Quill）にしてハイドレーションの不一致を避ける。
export function useAppIcon() {
  return useSyncExternalStore(subscribe, readAppIcon, () => null);
}

export function useResolvedAppIcon(): ResolvedAppIcon {
  return resolveAppIcon(useAppIcon());
}

// 保存できなかったとき（プライベートブラウズ、容量不足、不正な値）は false。
export function saveAppIcon(icon: string | null) {
  let stored: string | null = null;
  if (icon !== null && icon !== "") {
    if (isImageIcon(icon)) {
      stored = icon;
    } else {
      const characterId = parseCharacterIcon(icon);
      if (!characterId) return false;
      stored = toCharacterIcon(characterId);
    }
  }
  try {
    if (stored) window.localStorage.setItem(KEY, stored);
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
