import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ head: vi.fn(), read: vi.fn(), remove: vi.fn(), optionalEnv: vi.fn() }));
vi.mock("@vercel/blob", () => ({ head: mocks.head, list: vi.fn(), del: vi.fn() }));
vi.mock("@/lib/storage", () => ({ readStoredImage: mocks.read, deleteStoredImage: mocks.remove }));
vi.mock("@/lib/env", () => ({ optionalEnv: mocks.optionalEnv, getCookieSecret: () => "upload-test-secret" }));
import { issueUploadTicket } from "@/lib/chat-upload-ticket";
import { loadChatUploads, parseUploadReferences, removeChatUploads } from "@/lib/chat-uploads";

describe("private attachment resolution", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.optionalEnv.mockReturnValue("configured"); mocks.remove.mockResolvedValue(undefined); });
  const metadata = { name: "notes.txt", type: "text/plain", size: 8 };
  it("loads only signed owner references and deletes the temporary original", async () => {
    const { ticket, path } = await issueUploadTicket("owner", metadata);
    mocks.head.mockResolvedValue({ size: 8, contentType: "text/plain" });
    mocks.read.mockResolvedValue(Buffer.from("abcdefgh"));
    const files = await loadChatUploads([ticket], "owner");
    expect(await files[0].text()).toBe("abcdefgh");
    expect(mocks.read).toHaveBeenCalledWith(path, 8);
    expect(mocks.remove).toHaveBeenCalledWith(path);
  });
  it("blocks other users, forged refs, duplicates and totals before reading", async () => {
    const { ticket } = await issueUploadTicket("owner", metadata);
    await expect(loadChatUploads([ticket], "other")).rejects.toThrow();
    await removeChatUploads([ticket], "other");
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(() => parseUploadReferences(JSON.stringify([ticket, ticket]))).toThrow();
    expect(() => parseUploadReferences("not-json")).toThrow();
    const large = await issueUploadTicket("owner", { ...metadata, size: 20 * 1024 * 1024 });
    const legacy = Array.from({ length: 5 }, () => ({ name: "x.txt", type: "text/plain", size: 20 * 1024 * 1024 } as File));
    await expect(loadChatUploads([large.ticket], "owner", legacy)).rejects.toThrow("Total upload");
    expect(mocks.head).not.toHaveBeenCalled();
  });
  it("rejects actual size/type mismatches and cleans up after read failures", async () => {
    const { ticket } = await issueUploadTicket("owner", metadata);
    mocks.head.mockResolvedValue({ size: 9, contentType: "text/plain" });
    await expect(loadChatUploads([ticket], "owner")).rejects.toThrow("metadata");
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.remove).toHaveBeenCalled();
    mocks.head.mockResolvedValue({ size: 8, contentType: "text/plain" });
    mocks.read.mockResolvedValue(Buffer.from("short"));
    await expect(loadChatUploads([ticket], "owner")).rejects.toThrow("Incomplete");
  });
});
