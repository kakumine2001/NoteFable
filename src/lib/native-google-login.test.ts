import { generateKeyPair, SignJWT, errors } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const encode = vi.fn<(options: unknown) => Promise<string>>(async () => "signed-session");
vi.mock("next-auth/jwt", () => ({ encode }));

const {
  createNonce,
  createSessionCookie,
  GoogleVerificationUnavailableError,
  isSameOrigin,
  readNonce,
  sessionCookieName,
  verifyGoogleIdToken,
} = await import("@/lib/native-google-login");

const CLIENT_ID = "web-client.apps.googleusercontent.com";
const NONCE = "nonce-from-this-device";
const { publicKey, privateKey } = await generateKeyPair("RS256");
const otherKeys = await generateKeyPair("RS256");

type Claims = { nonce?: string; email?: string; email_verified?: unknown; name?: string; picture?: string };

async function idToken(
  claims: Claims = {},
  options: { audience?: string; issuer?: string; subject?: string | null; expires?: string | number; key?: CryptoKey } = {},
) {
  const jwt = new SignJWT({
    nonce: NONCE,
    email: "a@example.com",
    email_verified: true,
    name: "A",
    picture: "https://example.com/a.png",
    ...claims,
  })
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .setIssuer(options.issuer ?? "https://accounts.google.com")
    .setAudience(options.audience ?? CLIENT_ID)
    .setIssuedAt()
    .setExpirationTime(options.expires ?? "1h");
  if (options.subject !== null) jwt.setSubject(options.subject ?? "109876543210");
  return jwt.sign(options.key ?? privateKey);
}

const keys = async () => publicKey;

describe("verifyGoogleIdToken", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_GOOGLE_ID", CLIENT_ID);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the Google identity for a signed token issued to this app and this device", async () => {
    expect(await verifyGoogleIdToken(await idToken(), NONCE, keys)).toEqual({
      sub: "109876543210",
      email: "a@example.com",
      emailAuthoritative: false,
      name: "A",
      image: "https://example.com/a.png",
    });
  });

  it.each([
    ["issued to another app", () => idToken({}, { audience: "someone-else.apps.googleusercontent.com" })],
    ["from another issuer", () => idToken({}, { issuer: "https://evil.example" })],
    ["expired", () => idToken({}, { expires: Math.floor(Date.now() / 1000) - 60 })],
    ["bound to another nonce", () => idToken({ nonce: "someone-elses-nonce" })],
    ["without a nonce", () => idToken({ nonce: undefined })],
    ["without a subject", () => idToken({}, { subject: null })],
    ["with an unverified email", () => idToken({ email_verified: false })],
    ["signed with a key Google does not publish", () => idToken({}, { key: otherKeys.privateKey })],
    ["that is not a JWT", async () => "not-a-token"],
  ])("rejects a token %s", async (_label, make) => {
    expect(await verifyGoogleIdToken(await make(), NONCE, keys)).toBeNull();
  });

  it("accepts email_verified as the string 'true' and a token without an email", async () => {
    expect((await verifyGoogleIdToken(await idToken({ email_verified: "true" }), NONCE, keys))?.email).toBe(
      "a@example.com",
    );
    const bare = await idToken({ email: undefined, email_verified: undefined });
    expect((await verifyGoogleIdToken(bare, NONCE, keys))?.email).toBeNull();
  });

  it("treats an unknown signing key as an invalid token", async () => {
    const unknownKey = async () => {
      throw new errors.JWKSNoMatchingKey();
    };
    expect(await verifyGoogleIdToken(await idToken(), NONCE, unknownKey)).toBeNull();
  });

  it("treats a token with an unsupported critical header as invalid, not as an outage", async () => {
    const header = Buffer.from(JSON.stringify({ alg: "RS256", crit: ["x"], x: true })).toString("base64url");
    const body = Buffer.from(JSON.stringify({ sub: "1" })).toString("base64url");
    expect(await verifyGoogleIdToken(`${header}.${body}.c2ln`, NONCE, keys)).toBeNull();
  });

  it("reports an unreachable key server as unavailable, not as a bad token", async () => {
    const offline = async () => {
      throw new TypeError("fetch failed");
    };
    await expect(verifyGoogleIdToken(await idToken(), NONCE, offline)).rejects.toBeInstanceOf(
      GoogleVerificationUnavailableError,
    );
  });

  it("rejects everything when Google login is not configured", async () => {
    vi.stubEnv("AUTH_GOOGLE_ID", "");
    expect(await verifyGoogleIdToken(await idToken(), NONCE, keys)).toBeNull();
  });
});

describe("nonce", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_SECRET", "test-secret");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("round-trips through the signed cookie value", () => {
    const { nonce, cookieValue } = createNonce();
    expect(nonce.length).toBeGreaterThan(16);
    expect(readNonce(cookieValue)).toBe(nonce);
  });

  it("issues a different value each time", () => {
    expect(createNonce().nonce).not.toBe(createNonce().nonce);
  });

  it("rejects a forged, tampered or malformed cookie", () => {
    const { nonce, cookieValue } = createNonce();
    expect(readNonce(`${nonce}.forged-signature`)).toBeNull();
    expect(readNonce(`other-nonce.${cookieValue.split(".")[1]}`)).toBeNull();
    expect(readNonce(`${cookieValue}.extra`)).toBeNull();
    expect(readNonce(nonce)).toBeNull();
    expect(readNonce("")).toBeNull();
    expect(readNonce(undefined)).toBeNull();
  });

  it("expires after five minutes and rejects a cookie dated in the future", () => {
    const now = Date.now();
    const { nonce, cookieValue } = createNonce(now);
    expect(readNonce(cookieValue, now + 4 * 60_000)).toBe(nonce);
    expect(readNonce(cookieValue, now + 5 * 60_000 + 1000)).toBeNull();
    expect(readNonce(cookieValue, now - 10 * 60_000)).toBeNull();
  });

  it("does not accept a nonce whose timestamp was changed", () => {
    const { nonce, cookieValue } = createNonce(Date.now());
    const [, , signature] = cookieValue.split(".");
    expect(readNonce(`${nonce}.${Date.now() + 1}.${signature}`)).toBeNull();
  });

  it("rejects a cookie signed with a different secret", () => {
    const { cookieValue } = createNonce();
    vi.stubEnv("AUTH_SECRET", "another-secret");
    expect(readNonce(cookieValue)).toBeNull();
  });
});

describe("createSessionCookie", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    encode.mockReset();
    encode.mockResolvedValue("signed-session");
  });

  it("names the cookie the way Auth.js does for http and https", () => {
    expect(sessionCookieName(false)).toBe("authjs.session-token");
    expect(sessionCookieName(true)).toBe("__Secure-authjs.session-token");
  });

  it("encodes the Google account id into the token, with the cookie name as salt", async () => {
    vi.stubEnv("AUTH_SECRET", "test-secret");
    const cookie = await createSessionCookie(
      { sub: "109876543210", email: "a@example.com", name: "A", image: null },
      true,
    );

    expect(cookie).toMatchObject({ name: "__Secure-authjs.session-token", value: "signed-session" });
    expect(encode).toHaveBeenCalledWith(
      expect.objectContaining({
        secret: "test-secret",
        salt: "__Secure-authjs.session-token",
        token: expect.objectContaining({ googleSub: "109876543210", email: "a@example.com", name: "A" }),
      }),
    );
  });

  it("refuses to issue a session without AUTH_SECRET", async () => {
    vi.stubEnv("AUTH_SECRET", "");
    await expect(createSessionCookie({ sub: "1", email: null, name: null, image: null }, false)).rejects.toThrow(
      "AUTH_SECRET",
    );
  });

  it("fails instead of writing a cookie that would need Auth.js chunking", async () => {
    vi.stubEnv("AUTH_SECRET", "test-secret");
    encode.mockResolvedValue("x".repeat(4000));
    await expect(createSessionCookie({ sub: "1", email: null, name: null, image: null }, true)).rejects.toThrow(
      "too large",
    );
  });
});

describe("isSameOrigin", () => {
  it("allows requests without an Origin header and from the same host", () => {
    expect(isSameOrigin(null, "notefable.example")).toBe(true);
    expect(isSameOrigin("https://notefable.example", "notefable.example")).toBe(true);
  });

  it("rejects other hosts, the opaque 'null' origin and malformed values", () => {
    expect(isSameOrigin("https://evil.example", "notefable.example")).toBe(false);
    expect(isSameOrigin("null", "notefable.example")).toBe(false);
    expect(isSameOrigin("%%%", "notefable.example")).toBe(false);
    expect(isSameOrigin("https://notefable.example", null)).toBe(false);
  });
});
