import { useSyncExternalStore } from "react";
import { DEFAULT_CHARACTER_ID, isCharacterId, type CharacterId } from "@/lib/characters";

// ワークスペース全体（空の会話のキャラクター、AI の返答のアイコン、サイドバー、ノートの AI ボタン、設定の見本）で使う
// AI キャラクター／カスタム画像の設定。このブラウザの localStorage に保存し、アカウントには同期しない。
// null（未設定）は既定キャラクターの Quill（D · Quill）。
// プリセットは "character:<id>"（Quill は null に正規化）、アップロード画像は "data:image/..." のまま保持する。
// 旧バージョンの絵文字や不明な値は自動で既定キャラクター（null -> Quill）へ移行する。
const KEY = "notefable:app-icon";
const CHANGE_EVENT = "notefable:app-icon-change";
export const CHARACTER_ICON_PREFIX = "character:";
// 保存する画像の一辺（px）。
const ICON_IMAGE_SIZE = 96;

export type ResolvedAppIcon =
  | { kind: "character"; characterId: CharacterId }
  | { kind: "image"; dataUrl: string };

export const isImageIcon = (icon: string) => icon.startsWith("data:image/");

export function parseCharacterIcon(value: string): CharacterId | null {
  if (value.startsWith(CHARACTER_ICON_PREFIX)) {
    const id = value.slice(CHARACTER_ICON_PREFIX.length);
    return isCharacterId(id) ? id : null;
  }
  return isCharacterId(value) ? value : null;
}

export function toCharacterIcon(characterId: CharacterId): string | null {
  return characterId === DEFAULT_CHARACTER_ID ? null : `${CHARACTER_ICON_PREFIX}${characterId}`;
}

export function normalizeAppIcon(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw) return null;
  if (isImageIcon(raw)) return raw;
  const characterId = parseCharacterIcon(raw);
  return characterId ? toCharacterIcon(characterId) : null;
}

export function resolveAppIcon(icon: string | null | undefined): ResolvedAppIcon {
  const normalized = normalizeAppIcon(icon);
  if (normalized && isImageIcon(normalized)) {
    return { kind: "image", dataUrl: normalized };
  }
  const characterId = normalized ? parseCharacterIcon(normalized) : null;
  return { kind: "character", characterId: characterId ?? DEFAULT_CHARACTER_ID };
}

function read(): string | null {
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
  return useSyncExternalStore(subscribe, read, () => null);
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
