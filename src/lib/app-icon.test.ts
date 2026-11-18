import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHARACTER_IDS, DEFAULT_CHARACTER_ID } from "./characters";
import {
  CHARACTER_ICON_PREFIX,
  normalizeAppIcon,
  parseCharacterIcon,
  resolveAppIcon,
  saveAppIcon,
  toCharacterIcon,
} from "./app-icon";

const STORAGE_KEY = "notefable:app-icon";

function installWindowStorage(initial: Record<string, string> = {}, failWrites = false) {
  const map = new Map(Object.entries(initial));
  const target = new EventTarget();
  const localStorage = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (failWrites) throw new Error("QuotaExceededError");
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
  Object.assign(target, { localStorage });
  vi.stubGlobal("window", target);
  return { map, target };
}

describe("app-icon character storage & migration", () => {
  beforeEach(() => {
    installWindowStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults un-customized users to D · Quill", () => {
    expect(normalizeAppIcon(null)).toBeNull();
    expect(normalizeAppIcon("")).toBeNull();
    expect(resolveAppIcon(null)).toEqual({ kind: "character", characterId: "quill" });
    expect(resolveAppIcon(undefined)).toEqual({ kind: "character", characterId: "quill" });
  });

  it("round-trips all 7 preset characters and normalizes Quill to null", () => {
    for (const id of CHARACTER_IDS) {
      const encoded = toCharacterIcon(id);
      if (id === DEFAULT_CHARACTER_ID) {
        expect(encoded).toBeNull();
      } else {
        expect(encoded).toBe(`${CHARACTER_ICON_PREFIX}${id}`);
        expect(parseCharacterIcon(encoded!)).toBe(id);
      }
      expect(parseCharacterIcon(id)).toBe(id);
      expect(resolveAppIcon(encoded)).toEqual({ kind: "character", characterId: id });
      expect(resolveAppIcon(id)).toEqual({ kind: "character", characterId: id });
    }
  });

  it("preserves existing custom uploaded images across upgrades and round-trips", () => {
    const customImage = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
    const { map } = installWindowStorage({ [STORAGE_KEY]: customImage });

    expect(normalizeAppIcon(map.get(STORAGE_KEY))).toBe(customImage);
    expect(resolveAppIcon(map.get(STORAGE_KEY))).toEqual({ kind: "image", dataUrl: customImage });

    // Switching to a preset character replaces custom image; switching back to custom image works.
    expect(saveAppIcon("character:sora")).toBe(true);
    expect(map.get(STORAGE_KEY)).toBe("character:sora");
    expect(resolveAppIcon(map.get(STORAGE_KEY))).toEqual({ kind: "character", characterId: "sora" });

    expect(saveAppIcon(customImage)).toBe(true);
    expect(map.get(STORAGE_KEY)).toBe(customImage);
    expect(resolveAppIcon(map.get(STORAGE_KEY))).toEqual({ kind: "image", dataUrl: customImage });

    // Selecting Quill (Default) clears the stored key.
    expect(saveAppIcon("quill")).toBe(true);
    expect(map.has(STORAGE_KEY)).toBe(false);
    expect(resolveAppIcon(map.get(STORAGE_KEY))).toEqual({ kind: "character", characterId: "quill" });
  });

  it("migrates legacy custom emojis and unknown/corrupt values cleanly to default Quill", () => {
    for (const legacy of ["🦊", "👩🏽‍💻", "✨", "character:future_unknown", "logo", "https://example.com/x.png", "two words"]) {
      expect(normalizeAppIcon(legacy), legacy).toBeNull();
      expect(resolveAppIcon(legacy), legacy).toEqual({ kind: "character", characterId: "quill" });
    }
  });

  it("rejects invalid save inputs and reports false on storage write failures without throwing", () => {
    const { map, target } = installWindowStorage({ [STORAGE_KEY]: "character:piko" });
    const events: Event[] = [];
    target.addEventListener("notefable:app-icon-change", (e) => events.push(e));

    expect(saveAppIcon("not-a-character")).toBe(false);
    expect(saveAppIcon("🦊")).toBe(false);
    expect(map.get(STORAGE_KEY)).toBe("character:piko");
    expect(events).toHaveLength(0);

    expect(saveAppIcon("loop")).toBe(true);
    expect(map.get(STORAGE_KEY)).toBe("character:loop");
    expect(events).toHaveLength(1);

    installWindowStorage({}, true);
    expect(saveAppIcon("orbit")).toBe(false);
  });
});
