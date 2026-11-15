import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ currentUser: vi.fn(), find: vi.fn(), consume: vi.fn(), refund: vi.fn(), send: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  getOrCreateUser: mocks.currentUser,
  isAccountUser: (user: { googleSub: string | null; verifiedEmail?: string | null }) => Boolean(user.googleSub || user.verifiedEmail),
}));
vi.mock("@/lib/answer-report", async (load) => ({
  ...(await load<typeof import("@/lib/answer-report")>()),
  findReportedAnswer: mocks.find,
  sendReport: mocks.send,
}));
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
    mocks.consume.mockResolvedValue({ kind: "report", day: "2026-11-15", keys: ["user:u1", "ip:net"] });
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
    expect(mocks.refund).toHaveBeenCalledWith({ kind: "report", day: "2026-11-15", keys: ["user:u1", "ip:net"] });
  });
});
