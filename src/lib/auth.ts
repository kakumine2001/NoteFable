import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { getCookieSecret } from "@/lib/env";
import { isGoogleLoginConfigured } from "@/lib/google-auth";
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

async function issueDeviceId() {
  // 新しい匿名 ID を発行して httpOnly Cookie に保存する。クライアント JS から直接読まれないようにしている。
  const cookieStore = await cookies();
  const deviceId = randomUUID();

  cookieStore.set(COOKIE_NAME, pack(deviceId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });

  return deviceId;
}

export async function ensureAnonymousDeviceId() {
  // 既存 Cookie が有効ならその ID を使い、なければ新しい匿名 ID を発行する。
  const cookieStore = await cookies();
  const existingDeviceId = unpack(cookieStore.get(COOKIE_NAME)?.value);

  return existingDeviceId ?? issueDeviceId();
}

type GoogleIdentity = { sub: string; email: string | null; name: string | null; image: string | null };

async function getGoogleIdentity(): Promise<GoogleIdentity | null> {
  // 設定が無い環境や Auth.js の失敗では匿名利用に戻し、既存の API を止めない。
  if (!isGoogleLoginConfigured()) return null;

  try {
    const { auth } = await import("@/lib/google-auth");
    const session = await auth();
    const sub = session?.user?.id;
    if (!sub) return null;

    return {
      sub,
      email: session.user?.email ?? null,
      name: session.user?.name ?? null,
      image: session.user?.image ?? null,
    };
  } catch {
    return null;
  }
}

async function getOrCreateGoogleUser(identity: GoogleIdentity) {
  const profile = { email: identity.email, name: identity.name, image: identity.image };
  const existing = await prisma.anonymousUser.findUnique({ where: { googleSub: identity.sub } });

  if (existing) {
    // プロフィール（メール・名前・画像）が変わっていたときだけ更新する。
    const changed =
      existing.email !== profile.email || existing.name !== profile.name || existing.image !== profile.image;
    return changed ? prisma.anonymousUser.update({ where: { id: existing.id }, data: profile }) : existing;
  }

  // 初めての Google ログイン: いま使っている端末の匿名データをこのアカウントに引き継ぐ。
  const deviceId = await ensureAnonymousDeviceId();
  const deviceUser = await prisma.anonymousUser.upsert({
    where: { deviceId },
    update: {},
    create: { deviceId },
  });

  try {
    // 端末の利用者が別の Google アカウントに紐付済みなら引き継がず、新しい利用者を作る。
    // googleSub が null の行だけを条件に更新し、同時リクエストでも紐付けが 1 回だけになるようにする。
    const claimed = await prisma.anonymousUser.updateMany({
      where: { id: deviceUser.id, googleSub: null },
      data: { googleSub: identity.sub, ...profile },
    });

    if (claimed.count === 1) {
      return await prisma.anonymousUser.findUniqueOrThrow({ where: { id: deviceUser.id } });
    }

    const raced = await prisma.anonymousUser.findUnique({ where: { googleSub: identity.sub } });
    if (raced) return raced;

    return await prisma.anonymousUser.create({
      data: { deviceId: randomUUID(), googleSub: identity.sub, ...profile },
    });
  } catch (error) {
    // 別の端末が同じアカウントを同時に初回ログインして googleSub の一意制約に当たった場合は、先に作られた行を使う。
    if ((error as { code?: string }).code !== "P2002") throw error;

    const winner = await prisma.anonymousUser.findUnique({ where: { googleSub: identity.sub } });
    if (winner) return winner;
    throw error;
  }
}

export async function getOrCreateAnonymousUser() {
  // Google にログイン済みならそのアカウントの利用者を返す。
  const googleIdentity = await getGoogleIdentity();
  if (googleIdentity) return getOrCreateGoogleUser(googleIdentity);

  // 未ログインなら従来どおり Cookie の deviceId と DB の AnonymousUser を対応させる。
  const deviceId = await ensureAnonymousDeviceId();
  const user = await prisma.anonymousUser.upsert({
    where: { deviceId },
    update: {},
    create: { deviceId },
  });

  if (!user.googleSub) return user;

  // この端末の Cookie は Google アカウントの行を指している。ログアウト後や Google ログインを
  // 無効にした環境で、認証なしにそのアカウントのデータを見せないよう、新しい匿名の利用者に切り替える。
  return prisma.anonymousUser.create({ data: { deviceId: await issueDeviceId() } });
}
