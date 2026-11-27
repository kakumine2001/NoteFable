import { describe, expect, it } from "vitest";
import { flushCanvasEditors, flushCanvasEditorsSync } from "@/lib/canvas-flush";
import { trackSlideUpload } from "@/lib/slides/upload-tracker";

describe("trackSlideUpload", () => {
  it("keeps flushCanvasEditors waiting after unmount until every upload settles", async () => {
    let resolveUpload!: () => void;
    const uploadTask = new Promise<void>((resolve) => { resolveUpload = resolve; });

    trackSlideUpload("sl_detached", uploadTask, 5000);
    expect(flushCanvasEditorsSync("sl_detached")).toBe(true);
    expect(flushCanvasEditorsSync("sl_other")).toBe(false);
    expect(await flushCanvasEditors("sl_other")).toBe(true);

    let finished = false;
    const flushing = flushCanvasEditors("sl_detached").then((ok) => {
      finished = true;
      return ok;
    });

    await Promise.resolve();
    expect(finished).toBe(false);

    resolveUpload();
    expect(await flushing).toBe(true);
    expect(flushCanvasEditorsSync("sl_detached")).toBe(false);
  });
});
