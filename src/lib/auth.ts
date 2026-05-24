import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { getCookieSecret } from "@/lib/env";
import { prisma } from "@/lib/prisma";

const COOKIE_NAME = "studymate_device";
const MAX_AGE = 60 * 60 * 24 * 365;

function getSecret() {
  return getCookieSecret();
}

function sign(deviceId: string) {
  return createHmac("sha256", getSecret()).update(deviceId).digest("base64url");
}

function pack(deviceId: string) {
  return `${deviceId}.${sign(deviceId)}`;
}

function unpack(value?: string) {
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
  const cookieStore = await cookies();
  return unpack(cookieStore.get(COOKIE_NAME)?.value);
}

export async function ensureAnonymousDeviceId() {
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
  const deviceId = await ensureAnonymousDeviceId();

  return prisma.anonymousUser.upsert({
    where: { deviceId },
    update: {},
    create: { deviceId },
  });
}
