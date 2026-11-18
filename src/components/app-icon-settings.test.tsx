import { createElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHARACTER_IDS } from "@/lib/characters";

const uiState = vi.hoisted(() => ({
  picking: false,
  hoveredId: null as string | null,
  error: "",
}));

vi.mock("react", async (original) => {
  const actual = await original<typeof import("react")>();
  let idSeq = 0;
  return {
    ...actual,
    useId: () => `test-id-${++idSeq}`,
    useRef: (initial: unknown) => ({ current: initial }),
    useEffect: (fn: () => void | (() => void)) => {
      fn();
    },
    useState: (initial: unknown) => {
      const value = typeof initial === "function" ? (initial as () => unknown)() : initial;
      if (typeof value === "boolean") {
        return [
          uiState.picking,
          (next: boolean | ((prev: boolean) => boolean)) => {
            uiState.picking = typeof next === "function" ? next(uiState.picking) : next;
          },
        ];
      }
      if (value === "") {
        return [
          uiState.error,
          (next: string) => {
            uiState.error = next;
          },
        ];
      }
      return [
        uiState.hoveredId,
        (next: string | null | ((prev: string | null) => string | null)) => {
          uiState.hoveredId = typeof next === "function" ? next(uiState.hoveredId) : next;
        },
      ];
    },
  };
});

const savedIcon = { current: null as string | null };
const saveSpy = vi.fn((next: string | null) => {
  savedIcon.current = next;
  return true;
});

vi.mock("@/components/i18n-provider", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@/lib/app-icon", async (original) => {
  const actual = await original<typeof import("@/lib/app-icon")>();
  return {
    ...actual,
    useAppIcon: () => savedIcon.current,
    saveAppIcon: (next: string | null) => saveSpy(next),
  };
});

import { AppIconSettings } from "./app-icon-settings";

type AnyElement = ReactElement<Record<string, unknown>>;

function collectElements(node: ReactNode, predicate: (el: AnyElement) => boolean): AnyElement[] {
  const found: AnyElement[] = [];
  const visit = (item: ReactNode) => {
    if (!item || typeof item !== "object") return;
    if (Array.isArray(item)) {
      for (const child of item) visit(child);
      return;
    }
    const el = item as AnyElement;
    if (typeof el.type === "string" || typeof el.type === "function") {
      if (predicate(el)) found.push(el);
      if (typeof el.type === "function" && el.type !== AppIconSettings) {
        try {
          visit((el.type as (props: unknown) => ReactNode)(el.props));
        } catch {
          // Ignore hooks in leaf icon components when traversing static props.
        }
      }
      visit(el.props?.children as ReactNode);
    }
  };
  visit(node);
  return found;
}

describe("AppIconSettings character picker behaviour", () => {
  beforeEach(() => {
    uiState.picking = false;
    uiState.hoveredId = null;
    uiState.error = "";
    savedIcon.current = null;
    saveSpy.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("toggles the 7-character preset picker, marks Quill as Default & selected, and saves character choices", () => {
    const closeGuardRef = { current: () => true };

    // Initially closed: clicking "Choose a character" opens the picker.
    let tree = AppIconSettings({ closeGuardRef });
    const toggleBtn = collectElements(tree, (el) => el.type === "button" && el.props["aria-expanded"] !== undefined)[0]!;
    expect(toggleBtn.props["aria-expanded"]).toBe(false);
    expect(closeGuardRef.current()).toBe(true);

    (toggleBtn.props.onClick as () => void)();
    expect(uiState.picking).toBe(true);

    // Picker is now open with all 7 preset characters.
    tree = AppIconSettings({ closeGuardRef });
    const radios = collectElements(tree, (el) => el.props.role === "radio");
    expect(radios).toHaveLength(CHARACTER_IDS.length);

    // Un-customized user has Quill (Default) checked.
    const checked = radios.filter((r) => r.props["aria-checked"] === true);
    expect(checked).toHaveLength(1);
    expect(checked[0]!.props["aria-label"]).toBe("Quill (Default)");

    // Clicking Sora saves "character:sora".
    const soraBtn = radios.find((r) => r.props["aria-label"] === "Sora")!;
    (soraBtn.props.onClick as () => void)();
    expect(saveSpy).toHaveBeenLastCalledWith("character:sora");

    // Re-rendering shows Sora checked.
    tree = AppIconSettings({ closeGuardRef });
    const radiosAfterSora = collectElements(tree, (el) => el.props.role === "radio");
    expect(radiosAfterSora.find((r) => r.props["aria-label"] === "Sora")!.props["aria-checked"]).toBe(true);
    expect(radiosAfterSora.find((r) => r.props["aria-label"] === "Quill (Default)")!.props["aria-checked"]).toBe(false);

    // Clicking Quill (Default) saves null to restore default.
    (radiosAfterSora.find((r) => r.props["aria-label"] === "Quill (Default)")!.props.onClick as () => void)();
    expect(saveSpy).toHaveBeenLastCalledWith(null);

    // closeGuardRef closes the open picker first before letting Settings close.
    expect(closeGuardRef.current()).toBe(false);
    expect(uiState.picking).toBe(false);
    expect(createElement).toBeDefined();
  });

  it("shows no preset checked when a custom uploaded image is active, and lets the user switch back to any preset", () => {
    savedIcon.current = "data:image/png;base64,CUSTOM";
    uiState.picking = true;

    const tree = AppIconSettings({});
    const radios = collectElements(tree, (el) => el.props.role === "radio");
    expect(radios).toHaveLength(7);
    expect(radios.every((r) => r.props["aria-checked"] === false)).toBe(true);

    // User can click Loop to switch away from custom image to Loop.
    const loopBtn = radios.find((r) => r.props["aria-label"] === "Loop")!;
    (loopBtn.props.onClick as () => void)();
    expect(saveSpy).toHaveBeenLastCalledWith("character:loop");
  });
});
