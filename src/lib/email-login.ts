import { loginTimestamp } from "@/lib/login-time";
import { createHmac, randomInt, timingSafeEqual } from "crypto";
import { optionalEnv } from "@/lib/env";
import { isLocale, type Locale } from "@/lib/i18n/locale";
import { messagesFor } from "@/lib/i18n/messages";
import { createTranslator, msg } from "@/lib/i18n/translate";
import { normalizeEmail } from "@/lib/email-address";
import { encodeSessionCookie } from "@/lib/native-google-login";
import { prisma } from "@/lib/prisma";

// メールの確認コードでのログイン。コードは 6 桁、10 分有効、5 回まで試せる。
// コードそのものは保存せず、AUTH_SECRET を鍵にした HMAC だけを持つ。
export const CODE_TTL_MS = 10 * 60 * 1000;
export const MAX_ATTEMPTS = 5;
// 使い終わったコードの印。試行回数の上限より大きいので、照合の条件（attempts < MAX_ATTEMPTS）に二度と当てはまらない。
export const CONSUMED_ATTEMPTS = 1000;
// 同じアドレスへの送信は 1 分に 1 回、1 時間に 5 回まで。同じ送信元からは 1 時間に 20 回まで。
export const RESEND_INTERVAL_MS = 60 * 1000;
export const MAX_CODES_PER_EMAIL_PER_HOUR = 5;
export const MAX_CODES_PER_REQUESTER_PER_HOUR = 20;
const HOUR_MS = 60 * 60 * 1000;
const MAX_EMAIL_LENGTH = 254;
// ふつうのアドレスの形だけを確かめる（届くかどうかはコードを送って確かめる）。
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = normalizeEmail(value);
  if (!email || email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) return null;
  return email;
}

export function parseCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.replace(/\s+/g, "");
  return /^\d{6}$/.test(code) ? code : null;
}

function secret() {
  const value = optionalEnv("AUTH_SECRET");
  if (!value) throw new Error("AUTH_SECRET is not configured.");
  return value;
}

export function hashCode(email: string, code: string) {
  return createHmac("sha256", secret()).update(`email-login:${email}:${code}`).digest("base64url");
}

export function hashRequester(requester: string) {
  return createHmac("sha256", secret()).update(`email-login-requester:${requester}`).digest("base64url");
}

export function newCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

// 送信の回数制限を確かめてから、新しいコードを作って保存する。送信に失敗したら呼び出し側が discardCode で消す。
// 同じアドレス・同じ送信元からの同時リクエストが制限をすり抜けないよう、トランザクション内で順番待ちのロックを取る。
export async function createLoginCode(email: string, requester: string | null, now = new Date()) {
  const requesterHash = requester ? hashRequester(requester) : null;
  const hourAgo = new Date(now.getTime() - HOUR_MS);
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`email-login:${email}`}))`;
    if (requesterHash) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`email-login-requester:${requesterHash}`}))`;

    const recent = await tx.emailLoginCode.findMany({
      where: { email, createdAt: { gt: hourAgo } },
      select: { createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    if (recent[0] && now.getTime() - recent[0].createdAt.getTime() < RESEND_INTERVAL_MS) return { ok: false, reason: "too-soon" } as const;
    if (recent.length >= MAX_CODES_PER_EMAIL_PER_HOUR) return { ok: false, reason: "too-many" } as const;
    if (requesterHash) {
      const fromRequester = await tx.emailLoginCode.count({ where: { requesterHash, createdAt: { gt: hourAgo } } });
      if (fromRequester >= MAX_CODES_PER_REQUESTER_PER_HOUR) return { ok: false, reason: "too-many" } as const;
    }

    const code = newCode();
    const row = await tx.emailLoginCode.create({
      data: { email, codeHash: hashCode(email, code), expiresAt: new Date(now.getTime() + CODE_TTL_MS), requesterHash, createdAt: now },
    });
    return { ok: true, id: row.id, code } as const;
  });
  // 期限切れのコードはときどき（20 回に 1 回）ついでに消す（定期ジョブは無い）。失敗しても送信は続ける。
  if (result.ok && Math.random() < 0.05) {
    await prisma.emailLoginCode.deleteMany({ where: { expiresAt: { lt: hourAgo } } }).catch(() => {});
  }
  return result;
}

export async function discardCode(id: string) {
  await prisma.emailLoginCode.delete({ where: { id } }).catch(() => {});
}

export type VerifyResult = "ok" | "expired" | "wrong" | "locked";

function sameHash(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

// 有効期限内で、まだ試行回数が残っているコードのどれかと合えば成功。新しいコードを頼んでも（他人が頼んでも）
// 入力中の前のコードは無効にならない。間違えたときは残っているすべてのコードの試行回数を 1 つ増やすので、
// 試せる回数はコードを何通送っても 1 通あたり 5 回のまま。合えばそのアドレスのコードをすべて期限切れにする（使い回し不可）。
export async function verifyLoginCode(email: string, code: string, now = new Date()): Promise<VerifyResult> {
  const rows = await prisma.emailLoginCode.findMany({
    where: { email, expiresAt: { gt: now } },
    orderBy: { createdAt: "desc" },
  });
  if (!rows.length) return "expired";
  const open = rows.filter((row) => row.attempts < MAX_ATTEMPTS);
  if (!open.length) return rows.some((row) => row.attempts === CONSUMED_ATTEMPTS) ? "expired" : "locked";

  const actual = hashCode(email, code);
  const match = open.find((row) => sameHash(row.codeHash, actual));
  if (!match) {
    // 試行回数は条件付きで 1 つずつ増やす。同時に送られても上限を超えて試せない。
    const counted = await prisma.emailLoginCode.updateMany({
      where: { id: { in: open.map((row) => row.id) }, attempts: { lt: MAX_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    });
    if (!counted.count) return "locked";
    return open.every((row) => row.attempts + 1 >= MAX_ATTEMPTS) ? "locked" : "wrong";
  }

  // 使ったコードは消さずに期限切れにする（送信の回数制限はこの行の createdAt で数えるので、消すと制限が戻ってしまう）。
  // 同時に 2 回正しいコードが送られても、期限切れにできた方だけを成功にする。
  // 期限ではなく試行回数を「使用済み」にして判定する: 時刻はリクエストごとに違うので、期限だけだと
  // 少し早く始まった同じコードのリクエストが、先に終わった方の書いた期限より前の時刻で通ってしまう。
  const consumed = await prisma.emailLoginCode.updateMany({
    where: { id: match.id, attempts: { lt: MAX_ATTEMPTS } },
    data: { attempts: CONSUMED_ATTEMPTS, expiresAt: now },
  });
  if (!consumed.count) return "expired";
  await prisma.emailLoginCode
    .updateMany({ where: { email, attempts: { lt: MAX_ATTEMPTS } }, data: { attempts: CONSUMED_ATTEMPTS, expiresAt: now } })
    .catch(() => {});
  return "ok";
}

// Auth.js が読むセッション Cookie を、メールでのログインとして作る（google-auth.ts の session callback と対応）。
export async function createEmailSessionCookie(email: string, secure: boolean) {
  return encodeSessionCookie({ sub: `email:${email}`, loginEmail: email, email, signedInAt: loginTimestamp() }, secure);
}

export function emailLocale(value: unknown): Locale {
  return typeof value === "string" && isLocale(value) ? value : "en";
}

export function loginEmailContent(code: string, locale: Locale) {
  const t = createTranslator(messagesFor(locale));
  const subject = t(msg("Your NoteFable sign-in code: {code}"), { code });
  const lines = [
    t(msg("Your sign-in code is {code}."), { code }),
    t(msg("It expires in 10 minutes. If you didn't ask for it, you can ignore this email.")),
  ];
  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.6;color:#37352f">`
    + `<p>${escapeHtml(lines[0])}</p>`
    + `<p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:16px 0">${code}</p>`
    + `<p style="color:#787774">${escapeHtml(lines[1])}</p></div>`;
  return { subject, text: lines.join("\n\n"), html };
}

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export class EmailSendError extends Error {}

// Resend の API で送る。鍵が無い開発環境では送らず、サーバーのログにコードを出す。
export async function sendLoginEmail(to: string, code: string, locale: Locale, fetcher: typeof fetch = fetch) {
  const content = loginEmailContent(code, locale);
  const sent = await sendEmail({ to, subject: content.subject, text: content.text, html: content.html }, fetcher);
  if (!sent) console.info(`[email-login] code for ${to}: ${code}`);
}

// Resend でメールを 1 通送る。送ったら true、鍵が無い開発環境では送らずに false（本番で鍵が無いのはエラー）。
export async function sendEmail(
  message: { to: string; subject: string; text: string; html?: string; replyTo?: string },
  fetcher: typeof fetch = fetch,
) {
  const apiKey = optionalEnv("RESEND_API_KEY");
  const from = optionalEnv("EMAIL_FROM");
  if (!apiKey || !from) {
    if (process.env.NODE_ENV === "production") throw new EmailSendError("Email sending is not configured.");
    return false;
  }

  let response: Response;
  try {
    response = await fetcher("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from, to: [message.to], subject: message.subject, text: message.text,
        ...(message.html ? { html: message.html } : {}),
        ...(message.replyTo ? { reply_to: message.replyTo } : {}),
      }),
    });
  } catch (error) {
    throw new EmailSendError("Could not reach the email service.", { cause: error });
  }
  if (!response.ok) throw new EmailSendError(`The email service answered ${response.status}.`);
  return true;
}
