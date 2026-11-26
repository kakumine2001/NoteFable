import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const envMock = vi.hoisted(() => ({
  requireEnv: vi.fn((key: string) => (key === "OPENAI_API_KEY" ? "sk-test" : "")),
  optionalEnv: vi.fn<(key: string) => string | undefined>(() => undefined),
}));

vi.mock("@/lib/env", () => ({
  requireEnv: envMock.requireEnv,
  optionalEnv: envMock.optionalEnv,
}));

import { createImageApiEdit, createImageApiGeneration, findGeneratedImage } from "./image-generation";

describe("image-generation", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    envMock.requireEnv.mockImplementation((key: string) => (key === "OPENAI_API_KEY" ? "sk-test" : ""));
    envMock.optionalEnv.mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("extracts the first non-empty b64_json image from Images API responses", () => {
    expect(findGeneratedImage(undefined)).toBeUndefined();
    expect(findGeneratedImage({ data: [{ b64_json: "" }, { b64_json: "abc123" }] })).toBe("abc123");
  });

  it("posts multipart form data to /images/edits with all reference images", async () => {
    envMock.optionalEnv.mockImplementation((key: string) => {
      if (key === "OPENAI_BASE_URL") return "https://proxy.example/v1/";
      if (key === "OPENAI_IMAGE_MODEL") return "custom-image-model";
      return undefined;
    });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ b64_json: "edited-b64" }] }), { status: 200 }));

    const result = await createImageApiEdit("Make it watercolor", "1536x1024", "auto", [
      { filename: "sketch.png", mimeType: "image/png", buffer: Buffer.from("png-bytes") },
      { filename: "ref.webp", mimeType: "image/webp", buffer: Buffer.from("webp-bytes") },
    ]);

    expect(result).toEqual({ data: [{ b64_json: "edited-b64" }] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://proxy.example/v1/images/edits");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ Authorization: "Bearer sk-test" });
    const form = init.body as FormData;
    expect(form.get("model")).toBe("custom-image-model");
    expect(form.get("prompt")).toBe("Make it watercolor");
    expect(form.get("n")).toBe("1");
    expect(form.get("size")).toBe("1536x1024");
    expect(form.get("quality")).toBe("auto");
    expect(form.get("output_format")).toBe("png");
    const images = form.getAll("image") as File[];
    expect(images).toHaveLength(2);
    expect(images.map((file) => [file.name, file.type])).toEqual([
      ["sketch.png", "image/png"],
      ["ref.webp", "image/webp"],
    ]);
    expect(Buffer.from(await images[0].arrayBuffer()).toString()).toBe("png-bytes");
    expect(Buffer.from(await images[1].arrayBuffer()).toString()).toBe("webp-bytes");
  });

  it("throws upstream JSON error messages and falls back to status text for non-JSON responses", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Safety blocked" } }), { status: 400 }));
    await expect(createImageApiEdit("sketch", "1024x1024", "auto", [
      { filename: "sketch.png", mimeType: "image/png", buffer: Buffer.from("x") },
    ])).rejects.toThrow("Safety blocked");

    fetchMock.mockResolvedValueOnce(new Response("<html>524 timeout</html>", { status: 524 }));
    await expect(createImageApiEdit("sketch", "1024x1024", "auto", [
      { filename: "sketch.png", mimeType: "image/png", buffer: Buffer.from("x") },
    ])).rejects.toThrow("OpenAI returned an HTML error page. Try again later.");
  });

  it("posts JSON to /images/generations for text-only generation", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ b64_json: "gen-b64" }] }), { status: 200 }));
    const result = await createImageApiGeneration("A calm sea", "1024x1024", "auto");
    expect(result).toEqual({ data: [{ b64_json: "gen-b64" }] });
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.openai.com/v1/images/generations");
  });
});
