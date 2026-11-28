import { DOMParser } from "linkedom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exportScene: vi.fn(),
  isInvisiblySmallElement: vi.fn(() => false),
  restoreElements: vi.fn((elements: unknown[]) => elements),
}));

vi.mock("@excalidraw/excalidraw", () => ({
  exportScene: mocks.exportScene,
  isInvisiblySmallElement: mocks.isInvisiblySmallElement,
  restoreElements: mocks.restoreElements,
}));

import { isolateSvgIds, renderWhiteboardSvg } from "./render-frame";

function parseSvg(markup: string): SVGSVGElement {
  const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
  return doc.documentElement as unknown as SVGSVGElement;
}

function buildFrameSvg(frameId: string): SVGSVGElement {
  return parseSvg(`
    <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
      <defs>
        <clipPath id="${frameId}"><rect x="0" y="0" width="100" height="80" /></clipPath>
        <linearGradient id="grad-1"></linearGradient>
        <style>.box { fill: url(#grad-1); }</style>
      </defs>
      <g clip-path="url(#${frameId})">
        <use href="#${frameId}" xlink:href="#${frameId}" />
        <rect fill="url('#grad-1')" filter="url(#external-untouched)" />
      </g>
    </svg>
  `);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isolateSvgIds", () => {
  it("namespaces duplicate clipPath/gradient IDs and all internal references across multiple previews", () => {
    const whole = buildFrameSvg("frame-api-gw");
    const cropped = buildFrameSvg("frame-api-gw");

    isolateSvgIds(whole, "nf-wb-1");
    isolateSvgIds(cropped, "nf-wb-2");

    expect(whole.querySelector("clipPath")?.getAttribute("id")).toBe("nf-wb-1-frame-api-gw");
    expect(cropped.querySelector("clipPath")?.getAttribute("id")).toBe("nf-wb-2-frame-api-gw");
    expect(whole.querySelector("g")?.getAttribute("clip-path")).toBe("url(#nf-wb-1-frame-api-gw)");
    expect(cropped.querySelector("g")?.getAttribute("clip-path")).toBe("url(#nf-wb-2-frame-api-gw)");
    expect(whole.querySelector("use")?.getAttribute("href")).toBe("#nf-wb-1-frame-api-gw");
    expect(cropped.querySelector("use")?.getAttribute("href")).toBe("#nf-wb-2-frame-api-gw");
    expect(whole.querySelector("g rect")?.getAttribute("fill")).toBe("url('#nf-wb-1-grad-1')");
    expect(whole.querySelector("style")?.textContent).toBe(".box { fill: url(#nf-wb-1-grad-1); }");
    // Unmatched external references stay untouched.
    expect(whole.querySelector("g rect")?.getAttribute("filter")).toBe("url(#external-untouched)");
  });
});

describe("renderWhiteboardSvg", () => {
  it("reuses prepared scene across frames of the same board data and isolates exported SVG IDs", async () => {
    const data = {
      elements: [
        { id: "frame-1", type: "frame", name: "API", x: 0, y: 0, width: 200, height: 150 },
        { id: "box-1", type: "rectangle", x: 10, y: 10, width: 80, height: 40, frameId: "frame-1" },
      ],
    };
    mocks.exportScene
      .mockResolvedValueOnce(buildFrameSvg("frame-1"))
      .mockResolvedValueOnce(buildFrameSvg("frame-1"));

    const whole = await renderWhiteboardSvg(data);
    const frame = await renderWhiteboardSvg(data, { frameId: "frame-1" });

    expect(whole.status).toBe("ready");
    expect(frame.status).toBe("ready");
    // restoreElements runs once for the same saved data object.
    expect(mocks.restoreElements).toHaveBeenCalledTimes(1);
    if (whole.status === "ready" && frame.status === "ready") {
      const wholeClipId = whole.svg.querySelector("clipPath")?.getAttribute("id");
      const frameClipId = frame.svg.querySelector("clipPath")?.getAttribute("id");
      expect(wholeClipId).toBeTruthy();
      expect(frameClipId).toBeTruthy();
      expect(wholeClipId).not.toBe(frameClipId);
    }
  });
});
