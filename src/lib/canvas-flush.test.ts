import { describe, expect, it } from "vitest";
import { flushCanvasEditors, flushCanvasEditorsSync, registerCanvasFlusher } from "@/lib/canvas-flush";

describe("canvas flush", () => {
  it("waits for every open editor and forgets closed ones", async () => {
    const calls: string[] = [];
    const offA = registerCanvasFlusher(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); calls.push("a"); return true; });
    const offB = registerCanvasFlusher(() => { calls.push("b"); return true; });
    expect(await flushCanvasEditors()).toBe(true);
    expect(calls.sort()).toEqual(["a", "b"]);
    offA();
    offB();
    await flushCanvasEditors();
    expect(calls).toHaveLength(2);
  });

  it("reports an editor that could not hand everything over", async () => {
    const off = registerCanvasFlusher(async () => false);
    expect(await flushCanvasEditors()).toBe(false);
    off();
    expect(await flushCanvasEditors()).toBe(true);
  });

  it("keeps going when one editor fails", async () => {
    const calls: string[] = [];
    const offA = registerCanvasFlusher(() => { throw new Error("broken"); });
    const offB = registerCanvasFlusher(() => { calls.push("b"); return true; });
    // 投げたエディターは渡し切れなかったものとして数える。ほかのエディターは渡す。
    await expect(flushCanvasEditors()).resolves.toBe(false);
    expect(calls).toEqual(["b"]);
    offA();
    offB();
  });

  it("runs synchronous flushers and reports whether async editor work remains", () => {
    let flushed = false;
    const offClean = registerCanvasFlusher(() => true, () => { flushed = true; return false; });
    expect(flushCanvasEditorsSync()).toBe(false);
    expect(flushed).toBe(true);
    const offUploading = registerCanvasFlusher(() => false, () => true);
    expect(flushCanvasEditorsSync()).toBe(true);
    offUploading();
    offClean();
    expect(flushCanvasEditorsSync()).toBe(false);
  });
});
