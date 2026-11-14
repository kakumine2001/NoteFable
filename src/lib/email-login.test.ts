import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  emailLoginCode: {
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
    findFirst: vi.fn(),
    updateMany: vi.fn(),
  },
  $executeRaw: vi.fn(),
  $transaction: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import {
  createLoginCode,
  hashCode,
  loginEmailContent,
  MAX_ATTEMPTS,
  newCode,
  parseCode,
  parseEmail,
  sendLoginEmail,
  verifyLoginCode,
} from "@/lib/email-login";

const now = new Date("2026-11-14T12:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AUTH_SECRET = "test-secret";
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
  prismaMock.emailLoginCode.findMany.mockResolvedValue([]);
  prismaMock.emailLoginCode.count.mockResolvedValue(0);
  prismaMock.emailLoginCode.create.mockResolvedValue({ id: "c1" });
  prismaMock.emailLoginCode.deleteMany.mockResolvedValue({ count: 0 });
  // トランザクションは同じモックをそのまま渡す。
  prismaMock.$transaction.mockImplementation(async (work: (tx: typeof prismaMock) => unknown) => work(prismaMock));
});

describe("parsing", () => {
  it("normalizes addresses and rejects malformed ones", () => {
    expect(parseEmail("  A.B@Example.COM ")).toBe("a.b@example.com");
    expect(parseEmail("no-at-sign")).toBeNull();
    expect(parseEmail("a@b")).toBeNull();
    expect(parseEmail(`${"a".repeat(250)}@x.io`)).toBeNull();
    expect(parseEmail(42)).toBeNull();
  });

  it("accepts only six digits, ignoring spaces", () => {
    expect(parseCode("123 456")).toBe("123456");
    expect(parseCode("12345")).toBeNull();
    expect(parseCode("12345a")).toBeNull();
  });

  it("makes six-digit codes", () => {
    for (let i = 0; i < 50; i++) expect(newCode()).toMatch(/^\d{6}$/);
  });
});

describe("createLoginCode", () => {
  it("takes per-address and per-requester locks before counting", async () => {
    await createLoginCode("a@example.com", "ip:x", now);
    expect(prismaMock.$executeRaw).toHaveBeenCalledTimes(2);
    expect(prismaMock.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(prismaMock.emailLoginCode.findMany.mock.invocationCallOrder[0]);
  });

  it("stores only a hash of the code", async () => {
    const result = await createLoginCode("a@example.com", "ip:x", now);
    expect(result.ok).toBe(true);
    const data = prismaMock.emailLoginCode.create.mock.calls[0][0].data;
    if (!result.ok) throw new Error("expected ok");
    expect(data.codeHash).toBe(hashCode("a@example.com", result.code));
    expect(JSON.stringify(data)).not.toContain(result.code);
    expect(data.expiresAt.getTime() - now.getTime()).toBe(10 * 60 * 1000);
  });

  it("refuses a second code within a minute", async () => {
    prismaMock.emailLoginCode.findMany.mockResolvedValue([{ createdAt: new Date(now.getTime() - 30_000) }]);
    expect(await createLoginCode("a@example.com", null, now)).toEqual({ ok: false, reason: "too-soon" });
    expect(prismaMock.emailLoginCode.create).not.toHaveBeenCalled();
  });

  it("caps codes per address and per requester each hour", async () => {
    prismaMock.emailLoginCode.findMany.mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => ({ createdAt: new Date(now.getTime() - (i + 2) * 60_000) })),
    );
    expect(await createLoginCode("a@example.com", null, now)).toEqual({ ok: false, reason: "too-many" });

    prismaMock.emailLoginCode.findMany.mockResolvedValue([]);
    prismaMock.emailLoginCode.count.mockResolvedValue(20);
    expect(await createLoginCode("b@example.com", "ip:x", now)).toEqual({ ok: false, reason: "too-many" });
  });
});

describe("verifyLoginCode", () => {
  const row = (attempts = 0, code = "123456", id = "c1") => ({ id, email: "a@example.com", codeHash: hashCode("a@example.com", code), attempts });

  it("accepts the right code once and expires the address's codes without deleting the send history", async () => {
    prismaMock.emailLoginCode.findMany.mockResolvedValue([row()]);
    prismaMock.emailLoginCode.updateMany.mockResolvedValue({ count: 1 });
    expect(await verifyLoginCode("a@example.com", "123456", now)).toBe("ok");
    expect(prismaMock.emailLoginCode.updateMany).toHaveBeenCalledWith({
      where: { email: "a@example.com", expiresAt: { gt: now } },
      data: { expiresAt: now },
    });
    expect(prismaMock.emailLoginCode.deleteMany).not.toHaveBeenCalled();
  });

  it("still accepts an earlier code after a newer one was requested", async () => {
    prismaMock.emailLoginCode.findMany.mockResolvedValue([row(0, "999999", "new"), row(0, "123456", "old")]);
    prismaMock.emailLoginCode.updateMany.mockResolvedValue({ count: 1 });
    expect(await verifyLoginCode("a@example.com", "123456", now)).toBe("ok");
    expect(prismaMock.emailLoginCode.updateMany).toHaveBeenCalledWith({
      where: { id: "old", attempts: { lt: MAX_ATTEMPTS }, expiresAt: { gt: now } },
      data: { expiresAt: now },
    });
  });

  it("loses a race for the same code", async () => {
    prismaMock.emailLoginCode.findMany.mockResolvedValue([row()]);
    prismaMock.emailLoginCode.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await verifyLoginCode("a@example.com", "123456", now)).toBe("expired");
  });

  it("counts a wrong code against every open code and locks after the limit", async () => {
    prismaMock.emailLoginCode.findMany.mockResolvedValue([row(0, "123456", "a"), row(2, "222222", "b")]);
    prismaMock.emailLoginCode.updateMany.mockResolvedValue({ count: 2 });
    expect(await verifyLoginCode("a@example.com", "000000", now)).toBe("wrong");
    expect(prismaMock.emailLoginCode.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["a", "b"] }, attempts: { lt: MAX_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    });

    prismaMock.emailLoginCode.findMany.mockResolvedValue([row(MAX_ATTEMPTS - 1)]);
    expect(await verifyLoginCode("a@example.com", "000000", now)).toBe("locked");

    prismaMock.emailLoginCode.findMany.mockResolvedValue([row(MAX_ATTEMPTS)]);
    expect(await verifyLoginCode("a@example.com", "123456", now)).toBe("locked");
  });

  it("reports an expired code when none is valid", async () => {
    prismaMock.emailLoginCode.findMany.mockResolvedValue([]);
    expect(await verifyLoginCode("a@example.com", "123456", now)).toBe("expired");
  });
});

describe("the email", () => {
  it("is localized and shows the code", () => {
    const en = loginEmailContent("042137", "en");
    expect(en.subject).toContain("042137");
    expect(en.html).toContain("042137");
    const zh = loginEmailContent("042137", "zh");
    expect(zh.text).toContain("验证码");
  });

  it("is sent through Resend when configured", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.EMAIL_FROM = "StudyMate <login@example.com>";
    const fetcher = vi.fn(async () => new Response("{}", { status: 200 }));
    await sendLoginEmail("a@example.com", "042137", "ja", fetcher as unknown as typeof fetch);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer re_test");
    expect(JSON.parse(String(init.body))).toMatchObject({ to: ["a@example.com"], from: "StudyMate <login@example.com>" });
  });

  it("fails when the service rejects the email", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.EMAIL_FROM = "login@example.com";
    const fetcher = vi.fn(async () => new Response("no", { status: 422 }));
    await expect(sendLoginEmail("a@example.com", "042137", "en", fetcher as unknown as typeof fetch)).rejects.toThrow();
  });
});

describe("isAuthoritativeGoogleEmail", () => {
  it("trusts only verified Gmail and Workspace addresses", async () => {
    const { isAuthoritativeGoogleEmail } = await import("@/lib/email-address");
    expect(isAuthoritativeGoogleEmail("A@Gmail.com", true, undefined)).toBe(true);
    expect(isAuthoritativeGoogleEmail("a@school.edu", true, "school.edu")).toBe(true);
    expect(isAuthoritativeGoogleEmail("a@outlook.com", true, undefined)).toBe(false);
    expect(isAuthoritativeGoogleEmail("a@other.edu", true, "school.edu")).toBe(false);
    expect(isAuthoritativeGoogleEmail("a@gmail.com", false, undefined)).toBe(false);
  });
});
