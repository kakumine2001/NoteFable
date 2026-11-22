import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { composeSharedText, consumeWebShare, mergeDraftWithShare, pruneExpiredWebShares, SHARE_CACHE_NAME, SHARE_CACHE_PREFIX, SHARE_MAX_AGE_MS } from "./share-target";

describe("composeSharedText", () => {
  it("joins title, text and url on separate lines", () => {
    expect(composeSharedText({ title: "Article", text: "Read this", url: "https://example.com/a" })).toBe("Article\nRead this\nhttps://example.com/a");
  });

  it("does not repeat a url that is already in the text or the title", () => {
    expect(composeSharedText({ title: "T", text: "see https://example.com/a", url: "https://example.com/a" })).toBe("T\nsee https://example.com/a");
    expect(composeSharedText({ title: "https://example.com/a", url: "https://example.com/a" })).toBe("https://example.com/a");
  });

  it("does not repeat a title that is already in the text", () => {
    expect(composeSharedText({ title: "Hello", text: "Hello world" })).toBe("Hello world");
  });

  it("keeps multiline text and Unicode, trims the edges and ignores blanks", () => {
    expect(composeSharedText({ title: "  ", text: "  一行目\n二行目 🎉  ", url: null })).toBe("一行目\n二行目 🎉");
    expect(composeSharedText({})).toBe("");
  });
});

describe("mergeDraftWithShare", () => {
  it("keeps what the user already typed and appends the shared text", () => {
    expect(mergeDraftWithShare("draft", "shared")).toBe("draft\n\nshared");
  });

  it("uses whichever side is not blank", () => {
    expect(mergeDraftWithShare("  ", "shared")).toBe("shared");
    expect(mergeDraftWithShare("draft", " ")).toBe("draft");
  });
});

// Cache Storage の最小の代役。
function fakeCaches() {
  const entries = new Map<string, Response>();
  const cache = {
    match: async (key: string | Request) => entries.get(typeof key === "string" ? key : key.url)?.clone(),
    put: async (key: string, response: Response) => void entries.set(key, response),
    delete: async (key: string | Request) => entries.delete(typeof key === "string" ? key : key.url),
    keys: async () => Array.from(entries.keys(), (url) => ({ url }) as Request),
  };
  vi.stubGlobal("caches", { open: async (name: string) => (name === SHARE_CACHE_NAME ? cache : (() => { throw new Error(name); })()) });
  return entries;
}

describe("consumeWebShare", () => {
  let entries: Map<string, Response>;
  beforeEach(() => {
    entries = fakeCaches();
  });
  afterEach(() => vi.unstubAllGlobals());

  function store(id: string, meta: object, files: Record<number, string> = {}) {
    entries.set(`${SHARE_CACHE_PREFIX}${id}/meta.json`, new Response(JSON.stringify(meta)));
    for (const [index, body] of Object.entries(files)) entries.set(`${SHARE_CACHE_PREFIX}${id}/file-${index}`, new Response(body));
  }

  it("returns the text and files once, then removes them", async () => {
    store("abcdef12", { createdAt: Date.now(), title: "", text: "hi", url: "https://example.com", files: [{ index: 0, name: "a.txt", type: "text/plain", size: 3, truncated: false }] }, { 0: "abc" });
    const shared = await consumeWebShare("abcdef12");
    expect(shared?.text).toBe("hi\nhttps://example.com");
    expect(shared?.files).toHaveLength(1);
    expect(shared?.files[0].name).toBe("a.txt");
    expect(await shared?.files[0].text()).toBe("abc");
    expect(entries.size).toBe(0);
  });

  it("gives a second read of the same id (StrictMode) the same result", async () => {
    store("repeat123", { createdAt: Date.now(), title: "", text: "once", url: "", files: [] });
    const [first, second] = await Promise.all([consumeWebShare("repeat123"), consumeWebShare("repeat123")]);
    expect(first).toBe(second);
    expect(first?.text).toBe("once");
  });

  it("reports the real size of a file that was too large to keep", async () => {
    store("toolarge1", { createdAt: Date.now(), title: "", text: "", url: "", files: [{ index: 0, name: "big.pdf", type: "application/pdf", size: 30 * 1024 * 1024, truncated: true }] }, { 0: "" });
    const shared = await consumeWebShare("toolarge1");
    expect(shared?.files[0].size).toBe(30 * 1024 * 1024);
  });

  it("drops expired payloads on read and prunes them on startup", async () => {
    const expiredAt = Date.now() - SHARE_MAX_AGE_MS - 1000;
    store("expired01", { createdAt: expiredAt, title: "", text: "old", url: "", files: [{ index: 0, name: "a.txt", type: "text/plain", size: 1, truncated: false }] }, { 0: "x" });
    expect(await consumeWebShare("expired01")).toBeNull();
    expect(entries.size).toBe(0);

    store("expired02", { createdAt: expiredAt, title: "", text: "stale", url: "", files: [{ index: 0, name: "b.txt", type: "text/plain", size: 1, truncated: false }] }, { 0: "y" });
    store("fresh0001", { createdAt: Date.now(), title: "", text: "fresh", url: "", files: [] });
    await pruneExpiredWebShares();
    expect(entries.has(`${SHARE_CACHE_PREFIX}expired02/meta.json`)).toBe(false);
    expect(entries.has(`${SHARE_CACHE_PREFIX}expired02/file-0`)).toBe(false);
    expect(entries.has(`${SHARE_CACHE_PREFIX}fresh0001/meta.json`)).toBe(true);
  });

  it("returns null for a missing or malformed id", async () => {
    expect(await consumeWebShare("missing123")).toBeNull();
    expect(await consumeWebShare("../etc")).toBeNull();
  });
});
