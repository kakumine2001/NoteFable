import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from "jose";
import { encode } from "next-auth/jwt";
import { optionalEnv } from "@/lib/env";

// Android アプリ（WebView）は Google の Web ログイン画面を開けないので、端末側で取得した ID トークンを
// このサーバーで検証し、Auth.js と同じ形式のセッション Cookie を発行する。
const GOOGLE_KEYS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;
const ISSUERS = ["accounts.google.com", "https://accounts.google.com"];
// Auth.js は 4096 バイトを超えるセッション Cookie を分割して保存する。この経路は分割せず、収まらなければ失敗させる。
const MAX_COOKIE_VALUE_LENGTH = 3800;

export const NONCE_COOKIE = "studymate_native_nonce";
export const NONCE_MAX_AGE = 300;

export type GoogleIdentity = { sub: string; email: string | null; name: string | null; image: string | null };

// Google の鍵を取りに行けないなどサーバー側の事情で検証できなかった場合。トークン自体が不正な場合とは区別する。
export class GoogleVerificationUnavailableError extends Error {}

// 鍵は取得結果がキャッシュされ、署名鍵が見つからないときだけ取り直される。
const googleKeys = createRemoteJWKSet(new URL(GOOGLE_KEYS_URL));

// トークンそのものが不正（署名・期限・発行元などが合わない）なときの jose のエラー。
const INVALID_TOKEN_ERRORS = [
  errors.JWTExpired,
  errors.JWTClaimValidationFailed,
  errors.JWTInvalid,
  errors.JWSInvalid,
  errors.JWSSignatureVerificationFailed,
  errors.JWKSNoMatchingKey,
  errors.JWKSMultipleMatchingKeys,
  errors.JOSEAlgNotAllowed,
  errors.JOSENotSupported,
];

function text(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

function nonceSignature(payload: string) {
  const secret = optionalEnv("AUTH_SECRET");
  if (!secret) throw new Error("AUTH_SECRET is not configured.");
  return createHmac("sha256", secret).update(`native-google-nonce:${payload}`).digest("base64url");
}

// ログイン開始時にサーバーが発行する値。ID トークンに埋め込ませ、発行した端末の Cookie と突き合わせる。
// トークンだけが漏れても、発行元の端末の Cookie を持たない相手は別の端末から使い回せない。
// Cookie には発行時刻も署名に含め、5 分を過ぎたものは受け付けない。サーバー側では使用済みを記録しないので、
// 1 回限りの強制ではなく「Cookie とトークンの両方を持つ相手が、5 分以内に」使い回せる範囲に限られる。
export function createNonce(now = Date.now()) {
  const nonce = randomBytes(18).toString("base64url");
  const payload = `${nonce}.${now}`;
  return { nonce, cookieValue: `${payload}.${nonceSignature(payload)}` };
}

export function readNonce(cookieValue: string | undefined, now = Date.now()) {
  const [nonce, issuedAt, signature, ...rest] = (cookieValue ?? "").split(".");
  if (!nonce || !issuedAt || !signature || rest.length) return null;

  const expected = Buffer.from(nonceSignature(`${nonce}.${issuedAt}`));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  const age = now - Number(issuedAt);
  return age >= -60_000 && age <= NONCE_MAX_AGE * 1000 ? nonce : null;
}

// 署名・有効期限・発行元・宛先（自分の Web クライアント ID）・nonce を確認する。トークンが不正なら null。
export async function verifyGoogleIdToken(
  idToken: string,
  expectedNonce: string,
  keys: JWTVerifyGetKey = googleKeys,
): Promise<GoogleIdentity | null> {
  const clientId = optionalEnv("AUTH_GOOGLE_ID");
  if (!clientId) return null;

  let claims;
  try {
    ({ payload: claims } = await jwtVerify(idToken, keys, {
      issuer: ISSUERS,
      audience: clientId,
      algorithms: ["RS256"],
    }));
  } catch (error) {
    if (INVALID_TOKEN_ERRORS.some((type) => error instanceof type)) return null;
    throw new GoogleVerificationUnavailableError("Could not reach Google to verify the sign-in.", { cause: error });
  }

  const sub = text(claims.sub);
  if (!sub || claims.nonce !== expectedNonce) return null;

  const email = text(claims.email);
  // メールが未確認のアカウントは受け付けない。
  if (email && claims.email_verified !== true && claims.email_verified !== "true") return null;

  return { sub, email, name: text(claims.name), image: text(claims.picture) };
}

export function sessionCookieName(secure: boolean) {
  return `${secure ? "__Secure-" : ""}authjs.session-token`;
}

// Auth.js が読むセッション Cookie の値を作る。salt は Cookie 名、payload は google-auth.ts の callbacks と対応させる。
export async function createSessionCookie(identity: GoogleIdentity, secure: boolean) {
  const secret = optionalEnv("AUTH_SECRET");
  if (!secret) throw new Error("AUTH_SECRET is not configured.");

  const name = sessionCookieName(secure);
  const value = await encode({
    token: {
      sub: identity.sub,
      googleSub: identity.sub,
      name: identity.name,
      email: identity.email,
      picture: identity.image,
    },
    secret,
    salt: name,
    maxAge: SESSION_MAX_AGE,
  });
  if (value.length > MAX_COOKIE_VALUE_LENGTH) throw new Error("The session is too large for a single cookie.");

  return { name, value, maxAge: SESSION_MAX_AGE };
}

// 別サイトのページから、他人のトークンで勝手にログインさせられないよう、同一オリジンのリクエストだけ受け付ける。
export function isSameOrigin(origin: string | null, host: string | null) {
  if (origin === null) return true;
  try {
    return Boolean(host) && new URL(origin).host === host;
  } catch {
    return false;
  }
}
