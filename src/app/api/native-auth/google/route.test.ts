import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const isGoogleLoginConfigured = vi.fn(() => true);
const verifyGoogleIdToken = vi.fn();
const createSessionCookie = vi.fn(async (_identity: unknown, secure: boolean) => ({
  name: `${secure ? "__Secure-" : ""}authjs.session-token`,
  value: "signed-session",
  maxAge: 100,
}));

vi.mock("next-auth/jwt", () => ({ encode: vi.fn() }));
vi.mock("@/lib/google-auth", () => ({ isGoogleLoginConfigured }));
vi.mock("@/lib/native-google-login", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/native-google-login")>()),
  verifyGoogleIdToken,
  createSessionCookie,
}));

const { GoogleVerificationUnavailableError, NONCE_COOKIE, createNonce } = await import("@/lib/native-google-login");
const { POST } = await import("@/app/api/native-auth/google/route");
const { POST: POST_NONCE } = await import("@/app/api/native-auth/nonce/route");

function post(body: unknown, headers: Record<string, string> = {}, url = "https://studymate.example/api/native-auth/google") {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json", host: "studymate.example", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/native-auth/nonce", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_SECRET", "test-secret");
    isGoogleLoginConfigured.mockReturnValue(true);
  });

  it("returns a nonce and stores a signed copy in an httpOnly cookie scoped to the native auth routes", async () => {
    const response = await POST_NONCE(post("", {}, "https://studymate.example/api/native-auth/nonce"));
    const { nonce } = await response.json();
    const cookie = response.headers.get("set-cookie") ?? "";

    expect(response.status).toBe(200);
    expect(cookie).toContain(`${NONCE_COOKIE}=${nonce}.`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Path=\/api\/native-auth/i);
  });

  it("rejects other origins and an unconfigured server", async () => {
    const foreign = await POST_NONCE(post("", { origin: "https://evil.example" }));
    expect(foreign.status).toBe(403);

    isGoogleLoginConfigured.mockReturnValue(false);
    expect((await POST_NONCE(post(""))).status).toBe(503);
  });
});

describe("POST /api/native-auth/google", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_SECRET", "test-secret");
    isGoogleLoginConfigured.mockReturnValue(true);
    verifyGoogleIdToken.mockReset();
    createSessionCookie.mockClear();
  });

  function withNonce(extra: Record<string, string> = {}) {
    const { nonce, cookieValue } = createNonce();
    return { nonce, headers: { cookie: `${NONCE_COOKIE}=${cookieValue}`, ...extra } };
  }

  it("verifies the token against this device's nonce and sets a secure httpOnly session cookie", async () => {
    verifyGoogleIdToken.mockResolvedValue({ sub: "1", email: null, name: null, image: null });
    const { nonce, headers } = withNonce({ origin: "https://studymate.example" });

    const response = await POST(post({ idToken: "token" }, headers));

    expect(response.status).toBe(200);
    expect(verifyGoogleIdToken).toHaveBeenCalledWith("token", nonce);
    const cookies = response.headers.getSetCookie();
    const session = cookies.find((value) => value.startsWith("__Secure-authjs.session-token=")) ?? "";
    expect(session).toContain("signed-session");
    expect(session).toMatch(/HttpOnly/i);
    expect(session).toMatch(/Secure/i);
    expect(session).toMatch(/SameSite=lax/i);
    expect(cookies.some((value) => value.startsWith(`${NONCE_COOKIE}=;`) || /Max-Age=0/i.test(value))).toBe(true);
  });

  it("expires leftover chunked session cookies so they cannot corrupt the new one", async () => {
    verifyGoogleIdToken.mockResolvedValue({ sub: "1", email: null, name: null, image: null });
    const { headers } = withNonce();
    headers.cookie += "; __Secure-authjs.session-token.0=old0; __Secure-authjs.session-token.1=old1";

    const cookies = (await POST(post({ idToken: "token" }, headers))).headers.getSetCookie();

    for (const name of ["__Secure-authjs.session-token.0", "__Secure-authjs.session-token.1"]) {
      expect(cookies.some((value) => value.startsWith(`${name}=;`) && /Max-Age=0/i.test(value))).toBe(true);
    }
  });

  it("returns 401, no session and a cleared nonce when the token is not valid", async () => {
    verifyGoogleIdToken.mockResolvedValue(null);
    const response = await POST(post({ idToken: "bad" }, withNonce().headers));

    expect(response.status).toBe(401);
    const cookies = response.headers.getSetCookie();
    expect(cookies.some((value) => value.startsWith("__Secure-authjs.session-token="))).toBe(false);
    expect(cookies.some((value) => /Max-Age=0/i.test(value))).toBe(true);
    expect(createSessionCookie).not.toHaveBeenCalled();
  });

  it("returns 503, not 401, when Google's keys could not be fetched", async () => {
    verifyGoogleIdToken.mockRejectedValue(new GoogleVerificationUnavailableError("offline"));
    const response = await POST(post({ idToken: "token" }, withNonce().headers));
    expect(response.status).toBe(503);
    expect(createSessionCookie).not.toHaveBeenCalled();
  });

  it("returns 500 and clears the nonce when the session cannot be created", async () => {
    verifyGoogleIdToken.mockResolvedValue({ sub: "1", email: null, name: null, image: null });
    createSessionCookie.mockRejectedValueOnce(new Error("too large"));

    const response = await POST(post({ idToken: "token" }, withNonce().headers));

    expect(response.status).toBe(500);
    expect(response.headers.getSetCookie().some((value) => /Max-Age=0/i.test(value))).toBe(true);
  });

  it("requires the nonce cookie issued to this device", async () => {
    const missing = await POST(post({ idToken: "token" }));
    expect(missing.status).toBe(400);

    const forged = await POST(post({ idToken: "token" }, { cookie: `${NONCE_COOKIE}=attacker-nonce.forged` }));
    expect(forged.status).toBe(400);
    expect(verifyGoogleIdToken).not.toHaveBeenCalled();
  });

  it("rejects requests from another or opaque origin", async () => {
    for (const origin of ["https://evil.example", "null"]) {
      const response = await POST(post({ idToken: "token" }, withNonce({ origin }).headers));
      expect(response.status).toBe(403);
    }
    expect(verifyGoogleIdToken).not.toHaveBeenCalled();
  });

  it("rejects non-JSON bodies, missing tokens and oversized tokens", async () => {
    const { headers } = withNonce();
    expect((await POST(post("idToken=x", { ...headers, "content-type": "text/plain" }))).status).toBe(415);
    expect((await POST(post({}, headers))).status).toBe(400);
    expect((await POST(post("not json", headers))).status).toBe(400);
    expect((await POST(post({ idToken: "x".repeat(9000) }, headers))).status).toBe(400);
    expect(verifyGoogleIdToken).not.toHaveBeenCalled();
  });

  it("is unavailable when Google login is not configured", async () => {
    isGoogleLoginConfigured.mockReturnValue(false);
    expect((await POST(post({ idToken: "token" }))).status).toBe(503);
  });
});
