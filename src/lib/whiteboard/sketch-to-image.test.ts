import { describe, expect, it } from "vitest";
import { chooseSketchAspectSize, hitTestGeneratedImage, placeSketchGeneratedImage } from "@/lib/whiteboard/sketch-to-image";

describe("sketch-to-image helpers", () => {
  it("picks the closest aspect ratio preset from sketch dimensions", () => {
    expect(chooseSketchAspectSize(400, 200)).toBe("1536x1024");
    expect(chooseSketchAspectSize(200, 400)).toBe("1024x1536");
    expect(chooseSketchAspectSize(300, 300)).toBe("1024x1024");
    expect(chooseSketchAspectSize(330, 300)).toBe("1024x1024");
    expect(chooseSketchAspectSize(0, 0)).toBe("1024x1024");
  });

  it("places generated images to the right of the selection without overlapping, scaled proportionally", () => {
    const selection = { x: 100, y: 200, width: 400, height: 300 };
    const placed = placeSketchGeneratedImage(selection, 1536, 1024);
    expect(placed.x).toBe(100 + 400 + 48);
    expect(placed.width).toBe(400);
    expect(placed.height).toBe(267);
    expect(placed.y).toBe(Math.round(200 + (300 - 267) / 2));

    // Tiny sketch is clamped up to a comfortable readable size (minSide = 220).
    const small = placeSketchGeneratedImage({ x: 0, y: 0, width: 80, height: 60 }, 1024, 1024);
    expect(small.x).toBe(80 + 48);
    expect(small.width).toBe(220);
    expect(small.height).toBe(220);

    // Huge sketch is clamped down to maxSide = 720 while preserving aspect ratio.
    const large = placeSketchGeneratedImage({ x: -100, y: 50, width: 2000, height: 1500 }, 1024, 1536);
    expect(large.x).toBe(-100 + 2000 + 48);
    expect(large.height).toBe(720);
    expect(large.width).toBe(480);
  });

  it("hit-tests the topmost AI-generated image element including rotated images", () => {
    const elements = [
      { id: "rect", type: "rectangle", x: 0, y: 0, width: 500, height: 500, customData: { generated: { prompt: "not image" } } },
      { id: "plain-img", type: "image", x: 0, y: 0, width: 200, height: 200 },
      { id: "ai-bottom", type: "image", x: 10, y: 10, width: 100, height: 100, customData: { generated: { prompt: "bottom" } } },
      { id: "ai-top", type: "image", x: 50, y: 50, width: 100, height: 100, customData: { generated: { prompt: "top" } } },
      { id: "ai-deleted", type: "image", x: 50, y: 50, width: 100, height: 100, isDeleted: true, customData: { generated: { prompt: "gone" } } },
      { id: "ai-rotated", type: "image", x: 300, y: 100, width: 200, height: 40, angle: Math.PI / 2, customData: { generated: { prompt: "rot" } } },
    ];

    expect(hitTestGeneratedImage(elements, { x: 75, y: 75 })).toBe("ai-top");
    expect(hitTestGeneratedImage(elements, { x: 25, y: 25 })).toBe("ai-bottom");
    expect(hitTestGeneratedImage(elements, { x: 180, y: 180 })).toBeNull();
    // Center of ai-rotated is (400, 120); rotated 90 deg, it spans y in [20, 220], x in [380, 420].
    expect(hitTestGeneratedImage(elements, { x: 400, y: 200 })).toBe("ai-rotated");
    expect(hitTestGeneratedImage(elements, { x: 480, y: 120 })).toBeNull();
  });
});
