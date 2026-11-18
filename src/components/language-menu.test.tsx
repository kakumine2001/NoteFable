import { useEffect, useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageMenuPanel } from "./language-menu";

vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useEffect: vi.fn(),
  useRef: vi.fn(() => ({ current: null })),
  useState: vi.fn(),
}));
vi.mock("@/components/i18n-provider", () => ({ useI18n: () => ({ locale: "en", t: (key: string) => key }) }));
vi.mock("@/lib/use-back-to-close", () => ({ useBackToClose: vi.fn() }));

const matchMedia = vi.fn();

function renderPanel(top: number, query = "", current: "ja" | null = "ja") {
  vi.mocked(useState).mockImplementation((initial?: unknown): ReturnType<typeof useState> => [
    typeof initial === "function" ? initial() : query,
    vi.fn(),
  ]);
  return LanguageMenuPanel({
    anchor: { top, bottom: top + 28, left: 32, right: 128 } as DOMRect,
    current,
    onChoose: vi.fn(),
    onClose: vi.fn(),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("window", { innerWidth: 412, innerHeight: 915, matchMedia });
});

afterEach(() => vi.unstubAllGlobals());

describe("language menu placement", () => {
  it("keeps the bottom 4px above the trigger even as filtering shortens the list", () => {
    const style = renderPanel(840).props.style;
    expect(style).toMatchObject({ top: "auto", bottom: 79, maxHeight: 368 });
    expect(renderPanel(840, "ja").props.style).toEqual(style);
  });

  it("caps the upward menu at the available space and uses the layout viewport for the bottom inset", () => {
    vi.stubGlobal("window", { innerWidth: 412, innerHeight: 915, visualViewport: { height: 480 }, matchMedia });
    expect(renderPanel(260).props.style).toMatchObject({ top: "auto", bottom: 659, maxHeight: 248 });
  });

  it("still opens under the trigger when there is room", () => {
    const { style } = renderPanel(32).props;
    expect(style).toMatchObject({ top: 64, maxHeight: 368 });
    expect(style).not.toHaveProperty("bottom");
  });
});

describe("language menu initial focus", () => {
  it.each([
    { coarse: true, current: "ja", expected: "checked option" },
    { coarse: true, current: null, expected: "first option" },
    { coarse: false, current: "ja", expected: "search" },
  ] as const)("sets autofocus on the $expected before opening (coarse $coarse)", ({ coarse, current, expected }) => {
    matchMedia.mockReturnValue({ matches: coarse });
    const candidates = {
      "checked option": { setAttribute: vi.fn() },
      "first option": { setAttribute: vi.fn() },
      search: { setAttribute: vi.fn() },
    };
    const dialog = {
      querySelector: vi.fn((selector: string) => selector === '[role="radio"][aria-checked="true"]'
        ? current && candidates["checked option"]
        : selector === '[role="radio"]' ? candidates["first option"] : null),
      showModal: vi.fn(() => {
        for (const [name, element] of Object.entries(candidates)) {
          if (name === expected) expect(element.setAttribute).toHaveBeenCalledWith("autofocus", "");
          else expect(element.setAttribute).not.toHaveBeenCalled();
        }
      }),
    };
    vi.mocked(useRef).mockReturnValueOnce({ current: dialog }).mockReturnValueOnce({ current: candidates.search });

    renderPanel(840, "", current);
    vi.mocked(useEffect).mock.calls.at(-1)?.[0]();

    expect(matchMedia).toHaveBeenCalledWith("(pointer: coarse)");
    expect(dialog.showModal).toHaveBeenCalledOnce();
  });
});
