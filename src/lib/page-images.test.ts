import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultDimensionsFor, fitWhiteboardImageSize, generatePageImage, inferImageMimeType } from "./page-images";
import { StorageLimitError, UsageLimitError } from "./usage-plans";

describe("page-images", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("fits generated image dimensions cleanly for whiteboard placement", () => {
    expect(fitWhiteboardImageSize(1536, 1024)).toEqual({ width: 560, height: 373 });
    expect(fitWhiteboardImageSize(1024, 1024)).toEqual({ width: 560, height: 560 });
    expect(fitWhiteboardImageSize(1024, 1536)).toEqual({ width: 373, height: 560 });
    expect(fitWhiteboardImageSize(300, 200)).toEqual({ width: 300, height: 200 });
    expect(fitWhiteboardImageSize(0, 0)).toEqual({ width: 560, height: 373 });
  });

  it("infers image MIME types from response or filename", () => {
    expect(inferImageMimeType("ai-image.png", "image/webp")).toBe("image/webp");
    expect(inferImageMimeType("ai-image.webp")).toBe("image/webp");
    expect(inferImageMimeType("photo.JPG")).toBe("image/jpeg");
    expect(inferImageMimeType("anim.gif")).toBe("image/gif");
    expect(inferImageMimeType("ai-image.png")).toBe("image/png");
  });

  it("returns default dimensions matching the requested aspect size", () => {
    expect(defaultDimensionsFor("1536x1024")).toEqual({ width: 1536, height: 1024 });
    expect(defaultDimensionsFor("1024x1024")).toEqual({ width: 1024, height: 1024 });
    expect(defaultDimensionsFor("1024x1536")).toEqual({ width: 1024, height: 1536 });
  });

  it("calls /api/pages/images and returns normalized PageImage metadata", async () => {
    globalThis.fetch = vi.fn(async () => new Response(
      JSON.stringify({
        url: "/api/pages/files?key=note-files%2Fu1%2Fabc.webp&name=ai-image.webp",
        name: "ai-image.webp",
        mimeType: "image/webp",
        size: 12345,
        prompt: "a lighthouse",
      }),
      { status: 201, headers: { "Content-Type": "application/json" } },
    )) as typeof fetch;

    const result = await generatePageImage("a lighthouse", "1024x1536");
    expect(result).toEqual({
      url: "/api/pages/files?key=note-files%2Fu1%2Fabc.webp&name=ai-image.webp",
      name: "ai-image.webp",
      width: 1024,
      height: 1536,
      mimeType: "image/webp",
      prompt: "a lighthouse",
    });
  });

  it("throws UsageLimitError on 429 usage_limit", async () => {
    globalThis.fetch = vi.fn(async () => new Response(
      JSON.stringify({ error: "Limit reached", code: "usage_limit", tier: "guest", kind: "image" }),
      { status: 429, headers: { "Content-Type": "application/json" } },
    )) as typeof fetch;

    await expect(generatePageImage("lighthouse", "1536x1024")).rejects.toSatisfy(
      (err: unknown) => err instanceof UsageLimitError && err.tier === "guest" && err.kind === "image",
    );
  });

  it("throws StorageLimitError on 413 storage_limit", async () => {
    globalThis.fetch = vi.fn(async () => new Response(
      JSON.stringify({ error: "Storage full", code: "storage_limit", tier: "member", used: 500, limit: 500 }),
      { status: 413, headers: { "Content-Type": "application/json" } },
    )) as typeof fetch;

    await expect(generatePageImage("lighthouse", "1024x1024")).rejects.toBeInstanceOf(StorageLimitError);
  });

  it("sends multipart FormData with referenceImage when generating from a sketch", async () => {
    const fetchSpy = vi.fn(async () => new Response(
      JSON.stringify({
        url: "/api/pages/files?key=note-files%2Fu1%2Fsketch-out.png&name=ai-image.png",
        name: "ai-image.png",
        mimeType: "image/png",
        size: 4096,
        prompt: "Clean diagram",
        reportToken: "tok-1",
      }),
      { status: 201, headers: { "Content-Type": "application/json" } },
    ));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const blob = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" });
    const result = await generatePageImage("", "1024x1024", { referenceImage: blob });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/pages/images");
    expect(init.body).toBeInstanceOf(FormData);
    const form = init.body as FormData;
    expect(form.get("size")).toBe("1024x1024");
    expect(form.get("prompt")).toBeNull();
    const ref = form.get("referenceImage") as File;
    expect(ref.name).toBe("sketch.png");
    expect(ref.type).toBe("image/png");
    expect(result).toMatchObject({
      url: "/api/pages/files?key=note-files%2Fu1%2Fsketch-out.png&name=ai-image.png",
      prompt: "Clean diagram",
      reportToken: "tok-1",
    });
  });
});
