import { describe, expect, it } from "vitest";
import { menuPosition } from "./menu-position";

const size = { width: 200, height: 300 };
const viewport = { width: 412, height: 915 };
const anchor = (top: number, left = 100) => ({ top, bottom: top + 36, left, right: left + 36 });

describe("menuPosition", () => {
  it("opens below the button, aligned to its start edge", () => {
    expect(menuPosition(anchor(100), size, viewport, false)).toEqual({ left: 100, top: 140 });
    expect(menuPosition(anchor(100), size, viewport, true)).toEqual({ left: 8, top: 140 });
  });

  it("opens above the button when it doesn't fit below", () => {
    expect(menuPosition(anchor(800), size, viewport, false)).toEqual({ left: 100, top: 496 });
  });

  it("stays inside a short viewport", () => {
    const short = { width: 412, height: 400 };
    // The viewport shrank (e.g. keyboard) below the button: don't run off the bottom edge.
    expect(menuPosition(anchor(800), size, short, false).top).toBe(92);
    // Fits neither below nor above: keep the top edge on screen.
    expect(menuPosition(anchor(200), size, short, false).top).toBe(8);
  });

  it("keeps an 8px margin at the right edge", () => {
    expect(menuPosition(anchor(100, 380), size, viewport, false).left).toBe(204);
  });
});
