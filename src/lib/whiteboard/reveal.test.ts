import { afterEach, describe, expect, it } from "vitest";
import { cancelWhiteboardReveal, consumeWhiteboardReveal, requestWhiteboardReveal } from "@/lib/whiteboard/reveal";

afterEach(() => cancelWhiteboardReveal());

describe("whiteboard reveal requests", () => {
  it("hands the element to the right page once", () => {
    requestWhiteboardReveal("p1", "e1", 1000);
    expect(consumeWhiteboardReveal("p2", 1000)).toBeNull();
    expect(consumeWhiteboardReveal("p1", 1000)).toBe("e1");
    expect(consumeWhiteboardReveal("p1", 1000)).toBeNull();
  });

  it("drops stale requests and keeps only the latest", () => {
    requestWhiteboardReveal("p1", "e1", 0);
    expect(consumeWhiteboardReveal("p1", 60_000)).toBeNull();
    requestWhiteboardReveal("p1", "e1", 0);
    requestWhiteboardReveal("p1", "e2", 0);
    expect(consumeWhiteboardReveal("p1", 10)).toBe("e2");
  });
});
