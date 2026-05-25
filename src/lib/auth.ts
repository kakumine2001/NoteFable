import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { getCookieSecret } from "@/lib/env";
import { prisma } from "@/lib/prisma";

// 匿名利用者を識別するための Cookie 名。
const COOKIE_NAME = "studymate_device";
// Cookie の有効期限。秒単位で 1 年。
const MAX_AGE = 60 * 60 * 24 * 365;

function getSecret() {
  // Cookie 署名用の秘密値を環境変数または開発用デフォルトから取得する。
  return getCookieSecret();
}

function sign(deviceId: string) {
  // deviceId だけを Cookie に入れると利用者側で自由に書き換えられる。
  // HMAC 署名を付け、サーバーが発行した ID かどうかを後で検証できるようにする。
  return createHmac("sha256", getSecret()).update(deviceId).digest("base64url");
}

function pack(deviceId: string) {
  // Cookie に保存する値を deviceId と署名の組にする。
  return `${deviceId}.${sign(deviceId)}`;
}

function unpack(value?: string) {
  // Cookie は「deviceId.signature」の形で保存している。
  // 署名長と値を timingSafeEqual で比較し、一致した場合だけ匿名デバイス ID として採用する。
  if (!value) return null;
  const [deviceId, signature] = value.split(".");

  if (!deviceId || !signature) return null;

  const expected = sign(deviceId);
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);

  if (
    expectedBuffer.length !== actualBuffer.length ||
    !timingSafeEqual(expectedBuffer, actualBuffer)
  ) {
    return null;
  }

  return deviceId;
}

export async function getAnonymousDeviceId() {
  // Cookie が存在し署名も正しい場合だけ、匿名デバイス ID を返す読み取り専用関数。
  const cookieStore = await cookies();
  return unpack(cookieStore.get(COOKIE_NAME)?.value);
}

export async function ensureAnonymousDeviceId() {
  // 既存 Cookie が有効ならその ID を使い、なければ新しい匿名 ID を発行する。
  // httpOnly Cookie にすることで、クライアント JS から直接読まれないようにしている。
  const cookieStore = await cookies();
  const existingDeviceId = unpack(cookieStore.get(COOKIE_NAME)?.value);
  const deviceId = existingDeviceId ?? randomUUID();

  if (!existingDeviceId) {
    cookieStore.set(COOKIE_NAME, pack(deviceId), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: MAX_AGE,
    });
  }

  return deviceId;
}

export async function getOrCreateAnonymousUser() {
  // DB 上の AnonymousUser と Cookie の deviceId を対応させる。
  // 初回アクセスなら create、既存ならそのまま返す。
  const deviceId = await ensureAnonymousDeviceId();

  return prisma.anonymousUser.upsert({
    where: { deviceId },
    update: {},
    create: { deviceId },
  });
}
