import { afterEach, describe, expect, it, vi } from "vitest";
const sdk = vi.hoisted(() => ({ upload: vi.fn() }));
vi.mock("@vercel/blob/client", () => ({ upload: sdk.upload }));
import { uploadChatFiles } from "@/lib/client-chat-upload";

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
