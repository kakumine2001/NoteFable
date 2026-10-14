import { afterEach, describe, expect, it, vi } from "vitest";
import { issueUploadTicket, validateUploadMetadata, verifyUploadTicket } from "@/lib/chat-upload-ticket";

describe("chat upload tickets", () => {
  afterEach(() => vi.useRealTimers());
  const file = { name: "large.png", type: "image/png", size: 6 * 1024 * 1024 };
  it("accepts a file larger than the function payload and binds it to its owner", async () => {
    validateUploadMetadata([file]);
    const issued = await issueUploadTicket("user-a", file);
    expect(await verifyUploadTicket(issued.ticket, "user-a")).toMatchObject({ userId: "user-a", ...file, path: issued.path });
    await expect(verifyUploadTicket(issued.ticket, "user-b")).rejects.toThrow("another user");
    await expect(verifyUploadTicket(issued.ticket.slice(0, -3) + "bad", "user-a")).rejects.toThrow();
  });
  it("rejects expired tickets, unsupported types and oversized batches", async () => {
    vi.useFakeTimers();
    const issued = await issueUploadTicket("user-a", file);
    vi.advanceTimersByTime(61 * 60 * 1000);
    await expect(verifyUploadTicket(issued.ticket, "user-a")).rejects.toThrow("expired");
    expect(() => validateUploadMetadata([{ ...file, type: "image/heic", name: "x.heic" }])).toThrow();
    expect(() => validateUploadMetadata(Array.from({ length: 11 }, () => file))).toThrow();
    expect(() => validateUploadMetadata([{ ...file, size: -1 }])).toThrow();
  });
});
