import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { getCookieSecret } from "@/lib/env";
import { isAccountLoginConfigured, isEmailLoginConfigured, isGoogleLoginConfigured } from "@/lib/google-auth";
import { normalizeEmail } from "@/lib/email-address";
import { prisma } from "@/lib/prisma";

// 匿名利用者を識別するための Cookie 名。
const COOKIE_NAME = "notefable_device";
// 改名前の Cookie 名。署名は同じなので、残っていればその ID を新しい名前でも保存する（匿名のデータを失わない）。
const LEGACY_COOKIE_NAME = "studymate_device";
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
  return unpack(cookieStore.get(COOKIE_NAME)?.value) ?? unpack(cookieStore.get(LEGACY_COOKIE_NAME)?.value);
}

async function issueDeviceId(deviceId: string = randomUUID()) {
  // 匿名 ID（渡されなければ新しく作る）を httpOnly Cookie に保存する。クライアント JS から直接読まれないようにしている。
  const cookieStore = await cookies();

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
  if (existingDeviceId) return existingDeviceId;

  const legacyDeviceId = unpack(cookieStore.get(LEGACY_COOKIE_NAME)?.value);
  if (legacyDeviceId) {
    // 古い Cookie は消さずに残す。改名前のデプロイへ戻したときも同じ利用者として読めるように。
    await issueDeviceId(legacyDeviceId);
    return legacyDeviceId;
  }
  return issueDeviceId();
}

type GoogleIdentity = {
  kind: "google";
  sub: string;
  email: string | null;
  // Google が確認済みとしたアドレス（小文字）。未確認なら null で、メールログインの利用者とはまとめない。
  verifiedEmail: string | null;
  name: string | null;
  image: string | null;
};
type EmailIdentity = { kind: "email"; email: string };
export type AccountIdentity = GoogleIdentity | EmailIdentity;

export { normalizeEmail };

// ログイン Cookie（Auth.js の JWT）から、Google かメールのどちらでログインしているかを読む。
// 設定が無い環境や Auth.js の失敗では匿名利用に戻し、既存の API を止めない。
export async function getAccountIdentity(): Promise<AccountIdentity | null> {
  if (!isAccountLoginConfigured()) return null;

  try {
    const { auth } = await import("@/lib/google-auth");
    const session = await auth();
    const sub = session?.user?.id;
    if (sub && isGoogleLoginConfigured()) {
      const email = session.user?.email ?? null;
      return {
        kind: "google",
        sub,
        email,
        verifiedEmail: email && session.googleEmailVerified ? normalizeEmail(email) : null,
        name: session.user?.name ?? null,
        image: session.user?.image ?? null,
      };
    }
    if (session?.loginEmail && isEmailLoginConfigured()) return { kind: "email", email: normalizeEmail(session.loginEmail) };
    return null;
  } catch {
    return null;
  }
}

function isUniqueViolation(error: unknown) {
  return (error as { code?: string }).code === "P2002";
}

// いま使っている端末の匿名の行。まだどのアカウントにも紐付いていなければ、ログインした人がこのデータを引き継ぐ。
async function currentDeviceUser() {
  const deviceId = await ensureAnonymousDeviceId();
  return prisma.user.upsert({ where: { deviceId }, update: {}, create: { deviceId } });
}

async function getOrCreateGoogleUser(identity: GoogleIdentity): Promise<Awaited<ReturnType<typeof currentDeviceUser>>> {
  const profile = { email: identity.email, name: identity.name, image: identity.image };
  const existing = await prisma.user.findUnique({ where: { googleSub: identity.sub } });

  if (existing) {
    // プロフィール（メール・名前・画像）が変わっていたときだけ更新する。確認済みのメールはまだ持っていなければ記録する
    // （このアドレスでメールログインしたときに同じ利用者になるように）。別の利用者が使っているアドレスなら付けない。
    const addEmail = identity.verifiedEmail && !existing.verifiedEmail ? identity.verifiedEmail : null;
    const changed =
      existing.email !== profile.email || existing.name !== profile.name || existing.image !== profile.image || addEmail;
    if (!changed) return existing;
    try {
      return await prisma.user.update({
        where: { id: existing.id },
        data: addEmail ? { ...profile, verifiedEmail: addEmail } : profile,
      });
    } catch (error) {
      if (!addEmail || !isUniqueViolation(error)) throw error;
      // このアドレスはすでに別の利用者のもの（確認済みの印が付く前の Google 利用者が、別の端末でメールログインした場合など）。
      // 2 人分のデータをまとめるには利用者 ID を含む保存先（ノートのファイルや表紙）まで移す必要があり危ないので、しない。
      // それぞれの利用者のまま残す（docs/architecture/database.md の verifiedEmail）。
      return prisma.user.update({ where: { id: existing.id }, data: profile });
    }
  }

  // このアドレスで先にメールログインしていた利用者がいれば、その利用者に Google を紐付ける（同じ人として扱う）。
  // アドレスが別の Google アカウントの利用者のものなら（Google 側でアドレスが移った場合など）、アドレスは付けずに進む。
  let claimEmail = identity.verifiedEmail;
  if (identity.verifiedEmail) {
    const byEmail = await prisma.user.findUnique({ where: { verifiedEmail: identity.verifiedEmail } });
    if (byEmail?.googleSub) claimEmail = null;
    if (byEmail && !byEmail.googleSub) {
      const linked = await prisma.user
        .updateMany({ where: { id: byEmail.id, googleSub: null }, data: { googleSub: identity.sub, ...profile } })
        .catch((error: unknown) => {
          if (isUniqueViolation(error)) return { count: 0 };
          throw error;
        });
      if (linked.count === 1) return prisma.user.findUniqueOrThrow({ where: { id: byEmail.id } });
      const raced = await prisma.user.findUnique({ where: { googleSub: identity.sub } });
      if (raced) return raced;
    }
  }

  // 初めての Google ログイン: いま使っている端末の匿名データをこのアカウントに引き継ぐ。
  const deviceUser = await currentDeviceUser();
  const data = {
    googleSub: identity.sub,
    ...profile,
    ...(claimEmail ? { verifiedEmail: claimEmail } : {}),
  };

  try {
    // 端末の利用者が別のアカウントに紐付済みなら引き継がず、新しい利用者を作る。
    // googleSub / verifiedEmail が null の行だけを条件に更新し、同時リクエストでも紐付けが 1 回だけになるようにする。
    const claimed = await prisma.user.updateMany({
      where: { id: deviceUser.id, googleSub: null, verifiedEmail: null },
      data,
    });

    if (claimed.count === 1) {
      return await prisma.user.findUniqueOrThrow({ where: { id: deviceUser.id } });
    }

    const raced = await prisma.user.findUnique({ where: { googleSub: identity.sub } });
    if (raced) return raced;

    return await prisma.user.create({ data: { deviceId: randomUUID(), ...data } });
  } catch (error) {
    // 別の端末が同じアカウントを同時に初回ログインして一意制約に当たった場合は、先に作られた行を使う。
    // 同じアドレスのメールログインの行が先にできていたら、その行に紐付け直す。
    if (!isUniqueViolation(error)) throw error;

    const winner = await prisma.user.findUnique({ where: { googleSub: identity.sub } });
    if (winner) return winner;
    const byEmail = identity.verifiedEmail
      ? await prisma.user.findUnique({ where: { verifiedEmail: identity.verifiedEmail } })
      : null;
    if (byEmail && !byEmail.googleSub) return getOrCreateGoogleUser(identity);
    // 同時に別の Google アカウントがこのアドレスを取った: アドレスを付けずにやり直す（毎回失敗し続けないように）。
    if (byEmail && claimEmail) return getOrCreateGoogleUser({ ...identity, verifiedEmail: null });
    throw error;
  }
}

async function getOrCreateEmailUser(identity: EmailIdentity) {
  // 同じアドレスの利用者（メールで、または確認済みの Google で以前ログインした人）がいればその人。
  const existing = await prisma.user.findUnique({ where: { verifiedEmail: identity.email } });
  if (existing) return existing;

  // 初めてのログイン: いま使っている端末の匿名データを引き継ぐ。端末の行がすでに誰かのものなら新しい利用者を作る。
  const deviceUser = await currentDeviceUser();
  try {
    const claimed = await prisma.user.updateMany({
      where: { id: deviceUser.id, googleSub: null, verifiedEmail: null },
      data: { verifiedEmail: identity.email, email: identity.email },
    });
    if (claimed.count === 1) return await prisma.user.findUniqueOrThrow({ where: { id: deviceUser.id } });

    const raced = await prisma.user.findUnique({ where: { verifiedEmail: identity.email } });
    if (raced) return raced;

    return await prisma.user.create({
      data: { deviceId: randomUUID(), verifiedEmail: identity.email, email: identity.email },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const winner = await prisma.user.findUnique({ where: { verifiedEmail: identity.email } });
    if (winner) return winner;
    throw error;
  }
}

// アカウント（Google またはメール）に紐付いた行か。未ログインの端末にこの行のデータを見せてはいけない。
export function isAccountUser(user: { googleSub: string | null; verifiedEmail?: string | null }) {
  return Boolean(user.googleSub || user.verifiedEmail);
}

export async function getOrCreateUser() {
  // ログイン済みならそのアカウントの利用者を返す。
  const identity = await getAccountIdentity();
  if (identity?.kind === "google") return getOrCreateGoogleUser(identity);
  if (identity?.kind === "email") return getOrCreateEmailUser(identity);

  // 未ログインなら従来どおり Cookie の deviceId と DB の User を対応させる。
  const deviceId = await ensureAnonymousDeviceId();
  const user = await prisma.user.upsert({
    where: { deviceId },
    update: {},
    create: { deviceId },
  });

  if (!isAccountUser(user)) return user;

  // この端末の Cookie はアカウントの行を指している。ログアウト後やログインを無効にした環境で、
  // 認証なしにそのアカウントのデータを見せないよう、新しい匿名の利用者に切り替える。
  return prisma.user.create({ data: { deviceId: await issueDeviceId() } });
}

// 画面に出すアカウントのプロフィール（Google の名前・写真、メールログインならアドレスだけ）。未ログインなら null。
export async function currentAccountProfile(): Promise<{ name: string | null; email: string | null; image: string | null } | null> {
  const identity = await getAccountIdentity();
  if (!identity) return null;
  if (identity.kind === "email") return { name: null, email: identity.email, image: null };
  return { name: identity.name, email: identity.email, image: identity.image };
}
