import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ currentUser: vi.fn(), find: vi.fn(), findProposal: vi.fn(), findPage: vi.fn(), findPageImage: vi.fn(), readCanvas: vi.fn(), consume: vi.fn(), refund: vi.fn(), send: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  getOrCreateUser: mocks.currentUser,
  isAccountUser: (user: { googleSub: string | null; verifiedEmail?: string | null }) => Boolean(user.googleSub || user.verifiedEmail),
}));
vi.mock("@/lib/answer-report", async (load) => ({
  ...(await load<typeof import("@/lib/answer-report")>()),
  findReportedAnswer: mocks.find,
  findReportedProposal: mocks.findProposal,
  findReportedPage: mocks.findPage,
  findReportedPageImage: mocks.findPageImage,
  sendReport: mocks.send,
}));
vi.mock("@/lib/canvas-store", () => ({ readCanvasData: mocks.readCanvas }));
vi.mock("@/lib/usage-limits", () => ({ clientNetworkKey: () => "ip:net", consumeReportQuota: mocks.consume, refundUsage: mocks.refund }));
vi.mock("@/lib/prisma", () => ({ prisma: {}, databaseSchema: "notefable" }));
import { EmailSendError } from "@/lib/email-login";
import { POST } from "./route";

const answer = { id: "m2", sessionId: "s1", content: "An answer", model: "luna", createdAt: new Date("2026-11-15T00:00:00Z"), prompt: "A question" };
function post(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("https://notefable.com/api/reports", {
    method: "POST", body: JSON.stringify(body), headers: { host: "notefable.com", "content-type": "application/json", ...headers },
  });
}

describe("POST /api/reports", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentUser.mockResolvedValue({ id: "u1", googleSub: null, verifiedEmail: null });
    mocks.find.mockResolvedValue(answer);
    mocks.consume.mockResolvedValue({ buckets: [{ key: "user:u1", kind: "report", day: "2026-11-15" }, { key: "ip:net", kind: "report", day: "2026-11-15" }] });
    mocks.send.mockResolvedValue(undefined);
  });

  it("sends the reported answer with its question and the reason", async () => {
    const response = await POST(post({ messageId: "m2", reason: "  Offensive  " }));
    expect(response.status).toBe(200);
    expect(mocks.find).toHaveBeenCalledWith("u1", "m2");
    expect(mocks.consume).toHaveBeenCalledWith(expect.objectContaining({ id: "u1" }), "ip:net");
    const email = mocks.send.mock.calls[0][0] as { subject: string; text: string };
    expect(email.subject).toContain("m2");
    expect(email.text).toContain("Reason: Offensive");
    expect(email.text).toContain("anonymous");
    expect(email.text).toContain("A question");
    expect(email.text).toContain("An answer");
  });

  it("includes the storage paths of generated images", async () => {
    mocks.find.mockResolvedValueOnce({ ...answer, content: "", images: [{ id: "a1", filename: "image.png", path: "images/2026/11/15/x.png" }] });
    expect((await POST(post({ messageId: "m2" }))).status).toBe(200);
    const email = mocks.send.mock.calls[0][0] as { text: string };
    expect(email.text).toContain("(no text)");
    expect(email.text).toContain("image.png: images/2026/11/15/x.png (attachment a1)");
  });

  it("only reports the user's own answers", async () => {
    mocks.find.mockResolvedValueOnce(null);
    expect((await POST(post({ messageId: "other" }))).status).toBe(404);
    expect(mocks.consume).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("reports an AI proposal card with its before and after text", async () => {
    mocks.findProposal.mockResolvedValue({
      id: "prop1", sessionId: "s1", messageId: "m2", kind: "EDIT", status: "APPLIED", pageKind: "note", autoApplied: true, model: "luna",
      createdAt: new Date("2026-11-20T00:00:00Z"), payload: { pageId: "p1", pageTitle: "Biology", changes: [{ op: "replace", block: 2, before: "old line", after: "rude line" }] },
    });
    expect((await POST(post({ proposalId: "prop1", reason: "Rude" }))).status).toBe(200);
    expect(mocks.findProposal).toHaveBeenCalledWith("u1", "prop1");
    const email = mocks.send.mock.calls[0][0] as { subject: string; text: string };
    expect(email.subject).toContain("prop1");
    expect(email.text).toContain("Reason: Rude");
    expect(email.text).toContain("applied automatically");
    expect(email.text).toContain("old line");
    expect(email.text).toContain("rude line");
    mocks.findProposal.mockResolvedValueOnce(null);
    expect((await POST(post({ proposalId: "other" }))).status).toBe(404);
  });

  it("reports a page the AI wrote with its current text and the AI changes applied to it", async () => {
    mocks.findPage.mockResolvedValue({
      id: "p1", kind: "note", title: "Biology", aiUpdatedAt: new Date("2026-11-20T00:00:00Z"), text: "Cells are rude",
      proposals: [{ id: "prop1", sessionId: "s1", messageId: "m2", kind: "CREATE", status: "APPLIED", autoApplied: false, createdAt: new Date("2026-11-20T00:00:00Z") }],
    });
    expect((await POST(post({ pageId: "p1" }))).status).toBe(200);
    expect(mocks.findPage).toHaveBeenCalledWith("u1", "p1");
    const email = mocks.send.mock.calls[0][0] as { text: string };
    expect(email.text).toContain("Cells are rude");
    expect(email.text).toContain("prop1: created");
    mocks.findPage.mockResolvedValueOnce(null);
    expect((await POST(post({ pageId: "gone" }))).status).toBe(404);
    // 対象は 1 つだけ。
    expect((await POST(post({ pageId: "p1", messageId: "m2" }))).status).toBe(400);
  });

  it("reports an AI image on the user's own slide deck with its prompt and storage path", async () => {
    const path = "note-files/u1/00000000-0000-4000-8000-000000000000.png";
    const src = `/api/pages/files?key=${encodeURIComponent(path)}&name=sky.png`;
    mocks.readCanvas.mockResolvedValue({ slides: [{ id: "s1", elements: [
      { id: "img1", type: "image", src, generated: { prompt: "A lighthouse at dawn" } },
      { id: "img2", type: "image", src },
    ] }] });
    expect((await POST(post({ pageId: "deck1", elementId: "img1", reason: "Wrong" }))).status).toBe(200);
    expect(mocks.readCanvas).toHaveBeenCalledWith("u1", "deck1");
    const email = mocks.send.mock.calls[0][0] as { subject: string; text: string };
    expect(email.subject).toContain("deck1/img1");
    expect(email.text).toContain("A lighthouse at dawn");
    expect(email.text).toContain(path);
    // AI で作った印の無い画像、無い要素、読めないページは 404。
    expect((await POST(post({ pageId: "deck1", elementId: "img2" }))).status).toBe(404);
    expect((await POST(post({ pageId: "deck1", elementId: "gone" }))).status).toBe(404);
    mocks.readCanvas.mockResolvedValueOnce(null);
    expect((await POST(post({ pageId: "other", elementId: "img1" }))).status).toBe(404);
    expect(mocks.findPage).not.toHaveBeenCalled();
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it("reports an AI image on the user's own whiteboard with its prompt and storage path", async () => {
    const ownedPath = "note-files/u1/00000000-0000-4000-8000-000000000002.png";
    const foreignPath = "note-files/other/00000000-0000-4000-8000-000000000003.png";
    const ownedUrl = `/api/pages/files?key=${encodeURIComponent(ownedPath)}&name=ai-image.png`;
    const foreignUrl = `/api/pages/files?key=${encodeURIComponent(foreignPath)}&name=ai-image.png`;
    mocks.readCanvas.mockResolvedValue({
      elements: [
        { id: "wb-img-1", type: "image", fileId: "f1", customData: { generated: { prompt: "Sketch turned into watercolor castle" } } },
        { id: "wb-img-plain", type: "image", fileId: "f1" },
        { id: "wb-img-deleted", type: "image", fileId: "f1", isDeleted: true, customData: { generated: { prompt: "Deleted" } } },
        { id: "wb-img-foreign", type: "image", fileId: "f2", customData: { generated: { prompt: "Foreign" } } },
        { id: "wb-rect", type: "rectangle", customData: { generated: { prompt: "Not an image" } } },
      ],
      files: {
        f1: { id: "f1", mimeType: "image/png", dataURL: ownedUrl },
        f2: { id: "f2", mimeType: "image/png", dataURL: foreignUrl },
      },
    });

    expect((await POST(post({ pageId: "wb1", elementId: "wb-img-1", reason: "Broken rendering" }))).status).toBe(200);
    expect(mocks.readCanvas).toHaveBeenCalledWith("u1", "wb1");
    const email = mocks.send.mock.calls[0][0] as { subject: string; text: string };
    expect(email.subject).toContain("Reported whiteboard image wb1/wb-img-1");
    expect(email.text).toContain("Whiteboard: wb1");
    expect(email.text).toContain("Image element: wb-img-1");
    expect(email.text).toContain("Sketch turned into watercolor castle");
    expect(email.text).toContain(ownedPath);
    expect(email.text).toContain("Reason: Broken rendering");

    // Non-generated, deleted, foreign-owned file, non-image, missing element, and missing/trashed page are rejected as 404.
    expect((await POST(post({ pageId: "wb1", elementId: "wb-img-plain" }))).status).toBe(404);
    expect((await POST(post({ pageId: "wb1", elementId: "wb-img-deleted" }))).status).toBe(404);
    expect((await POST(post({ pageId: "wb1", elementId: "wb-img-foreign" }))).status).toBe(404);
    expect((await POST(post({ pageId: "wb1", elementId: "wb-rect" }))).status).toBe(404);
    expect((await POST(post({ pageId: "wb1", elementId: "missing" }))).status).toBe(404);
    mocks.readCanvas.mockResolvedValueOnce(null);
    expect((await POST(post({ pageId: "trashed", elementId: "wb-img-1" }))).status).toBe(404);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.consume).toHaveBeenCalledTimes(1);
  });

  it("reports a generated workspace image on a note or whiteboard using a verified report token", async () => {
    const path = "note-files/u1/00000000-0000-4000-8000-000000000001.png";
    const reportToken = "signed-report-token";
    mocks.findPageImage.mockResolvedValueOnce({ pageId: "n1", pageKind: "note", path, prompt: "A misty forest" });
    expect((await POST(post({ pageId: "n1", reportToken, reason: "Inappropriate" }))).status).toBe(200);
    expect(mocks.findPageImage).toHaveBeenCalledWith("u1", "n1", reportToken);
    const email = mocks.send.mock.calls[0][0] as { subject: string; text: string };
    expect(email.subject).toContain("n1");
    expect(email.text).toContain("Page: n1 (note)");
    expect(email.text).toContain("A misty forest");
    expect(email.text).toContain(path);
    expect(email.text).toContain("Reason: Inappropriate");

    mocks.findPageImage.mockResolvedValueOnce(null);
    expect((await POST(post({ pageId: "n1", reportToken }))).status).toBe(404);
    expect((await POST(post({ pageId: "n1", elementId: "img1", reportToken }))).status).toBe(400);
  });

  it("rejects bad bodies, other sites and too many reports", async () => {
    expect((await POST(post({ reason: "x" }))).status).toBe(400);
    expect((await POST(post({ messageId: "m2", reason: "x".repeat(1001) }))).status).toBe(400);
    expect((await POST(post({ messageId: "m2" }, { origin: "https://evil.example" }))).status).toBe(403);
    mocks.consume.mockResolvedValueOnce(null);
    expect((await POST(post({ messageId: "m2" }))).status).toBe(429);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("reports a failed email as 502 and gives the report back", async () => {
    mocks.send.mockRejectedValueOnce(new EmailSendError("down"));
    expect((await POST(post({ messageId: "m2" }))).status).toBe(502);
    expect(mocks.refund).toHaveBeenCalledWith({ buckets: [{ key: "user:u1", kind: "report", day: "2026-11-15" }, { key: "ip:net", kind: "report", day: "2026-11-15" }] });
  });
});
