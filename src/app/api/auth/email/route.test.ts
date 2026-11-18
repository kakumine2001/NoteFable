import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  configured: vi.fn(),
  create: vi.fn(),
  discard: vi.fn(),
  send: vi.fn(),
  verify: vi.fn(),
}));
vi.mock("@/lib/google-auth", () => ({ isEmailLoginConfigured: mocks.configured }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/email-login", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email-login")>();
  return {
    ...actual,
    createLoginCode: mocks.create,
    discardCode: mocks.discard,
    sendLoginEmail: mocks.send,
    verifyLoginCode: mocks.verify,
    createEmailSessionCookie: async () => ({ name: "authjs.session-token", value: "jwt", maxAge: 100 }),
  };
});
import { POST as start } from "./start/route";
import { POST as verify } from "./verify/route";

function request(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", host: "localhost", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.configured.mockReturnValue(true);
  mocks.create.mockResolvedValue({ ok: true, id: "c1", code: "123456" });
  mocks.send.mockResolvedValue(undefined);
});

describe("POST /api/auth/email/start", () => {
  it("sends a code in the requested language", async () => {
    const response = await start(request("/api/auth/email/start", { email: " A@Example.com ", locale: "ja" }));
    expect(response.status).toBe(200);
    expect(mocks.send).toHaveBeenCalledWith("a@example.com", "123456", "ja");
  });

  it("is off when email sign-in is not configured", async () => {
    mocks.configured.mockReturnValue(false);
    expect((await start(request("/api/auth/email/start", { email: "a@example.com" }))).status).toBe(404);
  });

  it("refuses other origins and bad addresses", async () => {
    expect((await start(request("/api/auth/email/start", { email: "a@example.com" }, { origin: "https://evil.example" }))).status).toBe(403);
    expect((await start(request("/api/auth/email/start", { email: "nope" }))).status).toBe(400);
  });

  it("rate limits and discards a code that could not be sent", async () => {
    mocks.create.mockResolvedValueOnce({ ok: false, reason: "too-soon" });
    expect((await start(request("/api/auth/email/start", { email: "a@example.com" }))).status).toBe(429);

    const { EmailSendError } = await import("@/lib/email-login");
    mocks.send.mockRejectedValueOnce(new EmailSendError("down"));
    expect((await start(request("/api/auth/email/start", { email: "a@example.com" }))).status).toBe(502);
    expect(mocks.discard).toHaveBeenCalledWith("c1");
  });
});

describe("POST /api/auth/email/verify", () => {
  it("sets the session cookie for the right code, including Arabic-Indic digits", async () => {
    mocks.verify.mockResolvedValue("ok");
    const response = await verify(request("/api/auth/email/verify", { email: "a@example.com", code: "123 456" }));
    expect(response.status).toBe(200);
    expect(mocks.verify).toHaveBeenCalledWith("a@example.com", "123456");
    expect(response.cookies.get("authjs.session-token")?.value).toBe("jwt");

    const arabic = await verify(request("/api/auth/email/verify", { email: "a@example.com", code: "٤٨٢ ٩١٠" }));
    expect(arabic.status).toBe(200);
    expect(mocks.verify).toHaveBeenCalledWith("a@example.com", "482910");
  });

  it("explains wrong, expired and locked codes without a cookie", async () => {
    for (const result of ["wrong", "expired", "locked"]) {
      mocks.verify.mockResolvedValueOnce(result);
      const response = await verify(request("/api/auth/email/verify", { email: "a@example.com", code: "000000" }));
      expect(response.status).toBe(400);
      expect(response.cookies.get("authjs.session-token")).toBeUndefined();
    }
  });

  it("rejects malformed codes before checking", async () => {
    expect((await verify(request("/api/auth/email/verify", { email: "a@example.com", code: "12" }))).status).toBe(400);
    expect(mocks.verify).not.toHaveBeenCalled();
  });
});
