import { afterEach, describe, expect, it, vi } from "vitest";
const sdk = vi.hoisted(() => ({ upload: vi.fn() }));
vi.mock("@vercel/blob/client", () => ({ upload: sdk.upload }));
import { uploadChatFiles, uploadChatFilesWithSelection } from "./client-chat-upload";
import { StorageLimitError } from "./usage-plans";

describe("direct client attachment uploads", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
  it("keeps binaries out of the ticket request and uses private Blob for files over 4.5MB", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ mode: "blob", uploads: [{ path: "private/path", ticket: "signed" }] }));
    vi.stubGlobal("fetch", fetchMock);
    const file = new File([new Uint8Array(6 * 1024 * 1024)], "photo.png", { type: "image/png" });
    sdk.upload.mockResolvedValue({});
    const result = await uploadChatFiles([file], vi.fn());
    expect(result).toEqual(["signed"]);
    const init = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(init).toEqual({ files: [{ name: "photo.png", type: "image/png", size: file.size }] });
    expect(fetchMock.mock.calls[0][1].body.length).toBeLessThan(200);
    expect(sdk.upload).toHaveBeenCalledWith("private/path", file, expect.objectContaining({ access: "private", clientPayload: "signed", multipart: true }));
  });
  it("cleans temporary uploads and reports failure without submitting a chat", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ mode: "blob", uploads: [{ path: "private/path", ticket: "signed" }] })).mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    sdk.upload.mockRejectedValue(new Error("network unavailable"));
    await expect(uploadChatFiles([new File(["data"], "notes.txt", { type: "text/plain" })], vi.fn())).rejects.toThrow("try sending again");
    expect(fetchMock).toHaveBeenLastCalledWith("/api/uploads", expect.objectContaining({ method: "DELETE", body: JSON.stringify({ uploads: ["signed"] }) }));
  });
});

const makeFile = (name: string, size: number) => new File([new Uint8Array(size)], name, { type: "image/png" });

describe("uploadChatFilesWithSelection", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("checks user attachments and selection screenshot together, and drops only the screenshot when combined storage exceeds the limit", async () => {
    const seenBatches: string[][] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/uploads" && init?.method === "POST") {
        const parsed = JSON.parse(String(init.body)) as { files: { name: string; size: number }[] };
        seenBatches.push(parsed.files.map((item) => item.name));
        const total = parsed.files.reduce((sum, item) => sum + item.size, 0);
        if (total > 100) {
          return new Response(
            JSON.stringify({ error: "Storage full", code: "storage_limit", tier: "member", used: 90, limit: 100 }),
            { status: 413, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({
            mode: "local",
            uploads: parsed.files.map((item, idx) => ({ path: `/tmp/${item.name}`, ticket: `t_${idx}_${item.name}` })),
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.startsWith("/api/uploads/local?")) {
        return new Response(null, { status: 200 });
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    // Combined 70 + 40 = 110 > 100, user file alone 70 <= 100 -> drops only selection screenshot.
    const result = await uploadChatFilesWithSelection([makeFile("photo.png", 70)], makeFile("selection.png", 40), () => {});
    expect(result).toEqual({ tickets: ["t_0_photo.png"], selectionDropped: true });
    expect(seenBatches).toEqual([["photo.png", "selection.png"], ["photo.png"]]);

    // When only the selection screenshot exceeds remaining storage (no manual files), degrade cleanly to text-only.
    seenBatches.length = 0;
    const textOnly = await uploadChatFilesWithSelection([], makeFile("selection.png", 120), () => {});
    expect(textOnly).toEqual({ tickets: [], selectionDropped: true });
    expect(seenBatches).toEqual([["selection.png"]]);

    // When the user's own file exceeds storage on its own, propagate StorageLimitError.
    await expect(
      uploadChatFilesWithSelection([makeFile("huge.png", 120)], makeFile("selection.png", 40), () => {}),
    ).rejects.toBeInstanceOf(StorageLimitError);
  });
});
