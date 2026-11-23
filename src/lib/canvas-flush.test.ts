import { describe, expect, it } from "vitest";
import { flushCanvasEditors, registerCanvasFlusher } from "@/lib/canvas-flush";

describe("canvas flush", () => {
  it("waits for every open editor and forgets closed ones", async () => {
    const calls: string[] = [];
    const offA = registerCanvasFlusher(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); calls.push("a"); });
    const offB = registerCanvasFlusher(() => { calls.push("b"); });
    await flushCanvasEditors();
    expect(calls.sort()).toEqual(["a", "b"]);
    offA();
    offB();
    await flushCanvasEditors();
    expect(calls).toHaveLength(2);
  });

  it("keeps going when one editor fails", async () => {
    const calls: string[] = [];
    const offA = registerCanvasFlusher(() => { throw new Error("broken"); });
    const offB = registerCanvasFlusher(() => { calls.push("b"); });
    await expect(flushCanvasEditors()).resolves.toBeUndefined();
    expect(calls).toEqual(["b"]);
    offA();
    offB();
  });
});
