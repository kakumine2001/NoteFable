import { describe, expect, it } from "vitest";
import { fitCentered, hasColor, inkBounds } from "@/lib/emoji-raster";

function pixels(width: number, height: number, painted: Array<[number, number, number?]>) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (const [x, y, alpha = 255] of painted) data[(y * width + x) * 4 + 3] = alpha;
  return data;
}

describe("inkBounds", () => {
  it("returns the painted box", () => {
    expect(inkBounds(pixels(10, 8, [[3, 2], [6, 5], [4, 4]]), 10, 8)).toEqual({ left: 3, top: 2, width: 4, height: 4 });
  });

  it("ignores faint pixels", () => {
    expect(inkBounds(pixels(10, 8, [[0, 0, 8], [5, 5]]), 10, 8)).toEqual({ left: 5, top: 5, width: 1, height: 1 });
  });

  it("returns null when nothing is painted", () => {
    expect(inkBounds(pixels(4, 4, []), 4, 4)).toBeNull();
  });
});

describe("hasColor", () => {
  it("is false for black-only ink", () => {
    expect(hasColor(pixels(4, 4, [[1, 1], [2, 2]]))).toBe(false);
  });

  it("is true once a painted pixel has colour", () => {
    const data = pixels(4, 4, [[1, 1]]);
    data[(1 * 4 + 1) * 4 + 2] = 200;
    expect(hasColor(data)).toBe(true);
  });
});

describe("fitCentered", () => {
  it("keeps the glyph scale and centers the ink, wherever it was drawn", () => {
    expect(fitCentered({ left: 90, top: 1, width: 40, height: 80 }, 100, 90)).toEqual({ x: 30, y: 10, width: 40, height: 80 });
  });

  it("keeps small emoji small", () => {
    expect(fitCentered({ left: 0, top: 0, width: 30, height: 30 }, 100, 90)).toEqual({ x: 35, y: 35, width: 30, height: 30 });
  });

  it("shrinks ink that would overflow the box", () => {
    expect(fitCentered({ left: 7, top: 30, width: 200, height: 100 }, 100, 90)).toEqual({ x: 0, y: 25, width: 100, height: 50 });
  });
});
