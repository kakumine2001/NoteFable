import { describe, expect, it, vi } from "vitest";

describe("withServerDom", () => {
  it("shows document and DOMParser only inside the conversion, even when the module is loaded twice", async () => {
    const first = await import("@/lib/whiteboard/server-dom");
    vi.resetModules();
    const second = await import("@/lib/whiteboard/server-dom");
    expect(first).not.toBe(second);
    for (const copy of [first, second]) {
      await copy.withServerDom(async () => {
        await Promise.resolve();
        const svg = new DOMParser().parseFromString("<svg xmlns=\"http://www.w3.org/2000/svg\"><g data-id=\"a\"/></svg>", "image/svg+xml");
        expect(svg.documentElement.tagName).toBe("svg");
        const textarea = document.createElement("textarea") as unknown as { innerHTML: string; value: string };
        textarea.innerHTML = "&#9829; &amp; &lt;";
        expect(textarea.value).toBe("♥ & <");
        expect(window).toBeUndefined();
      });
    }
    expect(typeof document).toBe("undefined");
    expect(typeof DOMParser).toBe("undefined");
  });

  it("does not leak into other requests running at the same time", async () => {
    const { withServerDom } = await import("@/lib/whiteboard/server-dom");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const inside = withServerDom(async () => { await gate; return typeof document; });
    // 変換の途中で、ほかの非同期の流れから見る。
    const outside = await Promise.resolve().then(() => typeof document);
    release();
    expect(await inside).toBe("object");
    expect(outside).toBe("undefined");
  });
});
