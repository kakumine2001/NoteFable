import { DEFAULT_CHARACTER_ID, isCharacterId, type CharacterId } from "@/lib/characters";

// 設定の「アイコン」の値の形（app-icon.ts）。React に依存しないので、サーバー（/api/app-icon）からも使う。
export const CHARACTER_ICON_PREFIX = "character:";

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
