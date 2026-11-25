import { createHash, randomUUID } from "node:crypto";
import { createRemoteJWKSet, EncryptJWT, errors, importPKCS8, jwtDecrypt, jwtVerify, SignJWT } from "jose";
import { appleIdentityConfig, IOS_BUNDLE_ID } from "@/lib/apple-identity-config";
import { currentDeviceUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withUserBillingLock } from "@/lib/subscription-state";

const issuer = "https://appleid.apple.com";
const keys = createRemoteJWKSet(new URL(`${issuer}/auth/keys`));

async function appleRequest(path: "token" | "revoke", fields: Record<string, string>) {
  const config = appleIdentityConfig();
  if (!config) throw new Error("Apple login is not configured.");
  const key = await importPKCS8(Buffer.from(config.key, "base64").toString("utf8"), "ES256");
  const clientSecret = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: config.keyId })
    .setIssuer(config.team).setAudience(issuer).setSubject(IOS_BUNDLE_ID)
    .setIssuedAt().setExpirationTime("5m").sign(key);
  return fetch(`${issuer}/auth/${path}`, {
    method: "POST",
    body: new URLSearchParams({ client_id: IOS_BUNDLE_ID, client_secret: clientSecret, ...fields }),
    signal: AbortSignal.timeout(10_000),
  });
}

function tokenKey() {
  const config = appleIdentityConfig();
  if (!config) throw new Error("Apple login is not configured.");
  return createHash("sha256").update("notefable-apple-refresh:").update(config.secret).digest();
}

export async function exchangeAppleCode(code: string, nonce: string, name: string | null) {
  const response = await appleRequest("token", { grant_type: "authorization_code", code });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    if (response.status === 400 && body?.error === "invalid_grant") return null;
    throw new Error("Apple authorization code exchange failed.");
  }
  const { id_token, refresh_token } = await response.json() as { id_token?: string; refresh_token?: string };
  if (typeof id_token !== "string" || typeof refresh_token !== "string" || !refresh_token) return null;
  const { payload } = await jwtVerify(id_token, keys, {
    issuer, audience: IOS_BUNDLE_ID, algorithms: ["RS256"], requiredClaims: ["exp", "iat", "sub", "nonce"],
  });
  if (!payload.sub || payload.nonce !== nonce) return null;
  const email = typeof payload.email === "string" && (payload.email_verified === true || payload.email_verified === "true")
    ? payload.email : null;
  return {
    appleSub: payload.sub,
    appleRefreshToken: await new EncryptJWT({ refreshToken: refresh_token })
      .setProtectedHeader({ alg: "dir", enc: "A256GCM" }).setSubject(payload.sub).encrypt(tokenKey()),
    name, email,
    appleAuthorizedAt: new Date(Number(payload.iat) * 1000),
  };
}

export async function saveAppleAccount(identity: NonNullable<Awaited<ReturnType<typeof exchangeAppleCode>>>) {
  const { appleSub, appleRefreshToken, appleAuthorizedAt, name, email } = identity;
  const where = { appleSub };
  const updateExisting = (id: string) => withUserBillingLock(id, async (tx) => {
    const updated = await tx.user.updateMany({
      where: { id, appleSub, OR: [{ appleRevokedAt: null }, { appleRevokedAt: { lt: appleAuthorizedAt } }] },
      data: { appleRefreshToken, appleAuthorizedAt, ...(name ? { name } : {}), ...(email ? { email } : {}) },
    });
    return updated.count === 1;
  });
  const existing = await prisma.user.findUnique({ where, select: { id: true } });
  if (existing) return updateExisting(existing.id);

  // Apple 邮箱可能是转发地址；仅按 Apple 的稳定账号 ID 识别，不按邮箱合并。
  const device = await currentDeviceUser();
  try {
    const claimed = await prisma.user.updateMany({
      where: { id: device.id, appleSub: null, googleSub: null, verifiedEmail: null },
      data: identity,
    });
    if (claimed.count) return true;
    await prisma.user.create({ data: { deviceId: randomUUID(), ...identity } });
    return true;
  } catch (error) {
    if ((error as { code?: string }).code !== "P2002") throw error;
    const winner = await prisma.user.findUnique({ where, select: { id: true } });
    return winner ? updateExisting(winner.id) : false;
  }
}

export async function syncAppleIdentityEvent(token: string) {
  let payload;
  try {
    ({ payload } = await jwtVerify(token, keys, {
      issuer, audience: IOS_BUNDLE_ID, algorithms: ["RS256"], requiredClaims: ["iat", "jti"],
    }));
  } catch (error) {
    if (error instanceof errors.JOSEError && error.code !== "ERR_JWKS_TIMEOUT") return false;
    throw error;
  }
  let event;
  try {
    event = typeof payload.events === "string" ? JSON.parse(payload.events) : payload.events;
  } catch {
    return false;
  }
  if (typeof event?.sub !== "string" || !event.sub) return false;
  if (event.type !== "consent-revoked" && event.type !== "account-deleted") return true;
  const time = Number(event.event_time);
  if (!Number.isSafeInteger(time) || time <= 0) return false;
  // Apple can send event_time in seconds or milliseconds. A late delivery cannot revoke a later authorization.
  const revokedAt = new Date(time < 10_000_000_000 ? time * 1000 : time);
  if (!Number.isFinite(revokedAt.getTime()) || revokedAt.getTime() > Date.now() + 60_000) return false;
  await prisma.user.updateMany({
    where: {
      appleSub: event.sub,
      AND: [
        { OR: [{ appleAuthorizedAt: null }, { appleAuthorizedAt: { lte: revokedAt } }] },
        { OR: [{ appleRevokedAt: null }, { appleRevokedAt: { lt: revokedAt } }] },
      ],
    },
    data: { appleRevokedAt: revokedAt, appleRefreshToken: null },
  });
  return true;
}

export async function revokeAppleLogin(appleSub: string, encryptedToken: string) {
  const { payload } = await jwtDecrypt(encryptedToken, tokenKey(), { subject: appleSub });
  if (typeof payload.refreshToken !== "string") throw new Error("Invalid stored Apple refresh token.");
  const response = await appleRequest("revoke", { token: payload.refreshToken, token_type_hint: "refresh_token" });
  if (!response.ok) throw new Error("Apple credential revocation failed.");
}
