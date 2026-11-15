import { createHmac } from "crypto";
import { Prisma } from "@/generated/prisma/client";
import { getCookieSecret } from "@/lib/env";
import { msg } from "@/lib/i18n/translate";
import { databaseSchema, prisma } from "@/lib/prisma";
import { GUEST_NETWORK_LIMITS, REPORT_LIMITS, USAGE_LIMIT_CODE, USAGE_LIMITS, type UsageKind, type UsageTier } from "@/lib/usage-plans";

export { GUEST_NETWORK_LIMITS, USAGE_LIMITS, type UsageKind, type UsageTier };

// 日付の切り替えは日本時間の 0 時。
const DAY_OFFSET_MS = 9 * 60 * 60 * 1000;
// 古い集計行を残す日数。消すのは消費時にときどきだけ（cron はない）。
const RETENTION_DAYS = 7;

export function usageDay(now = new Date()) {
  return new Date(now.getTime() + DAY_OFFSET_MS).toISOString().slice(0, 10);
}

export function usageTier(user: { googleSub: string | null; verifiedEmail?: string | null; plan?: string | null }): UsageTier {
  if (user.plan === "PRO") return "pro";
  // Google でもメールでも、ログインしていれば会員。
  return user.googleSub || user.verifiedEmail ? "member" : "guest";
}

export function clientNetworkKey(request: Request) {
  // Vercel は x-forwarded-for を受け取った接続元で上書きする。ローカルなど取れない環境では IP の上限を掛けない。
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || request.headers.get("x-real-ip")?.trim();
  if (!ip) return null;
  // IP そのものは保存しない。
  return `ip:${createHmac("sha256", getCookieSecret()).update(`usage:${ip}`).digest("base64url")}`;
}

export function limitReachedMessage(tier: UsageTier, kind: UsageKind) {
  if (tier === "guest") {
    return kind === "image"
      ? msg("You've used today's free image generations. Sign in for more, or try again tomorrow.")
      : msg("You've used today's free messages. Sign in for more, or try again tomorrow.");
  }
  return kind === "image"
    ? msg("You've reached today's image generation limit. Try again tomorrow.")
    : msg("You've reached today's message limit. Try again tomorrow.");
}

type Bucket = { key: string; limit: number };
// kind は UsageCounter.kind（chat / image と、用量の段階に入らない report）。
export type UsageTicket = { kind: UsageKind | "report"; day: string; keys: string[] };
export type UsageResult = { ok: true; ticket: UsageTicket } | { ok: false; tier: UsageTier; message: string };

// 上限に達したときの 429 応答。画面は code と tier を見て、未ログインならログインを勧める。
export function usageLimitResponse(result: Extract<UsageResult, { ok: false }>, kind: UsageKind) {
  return Response.json({ error: result.message, code: USAGE_LIMIT_CODE, tier: result.tier, kind }, { status: 429 });
}

class LimitReached extends Error {}

const table = () => Prisma.raw(`"${databaseSchema}"."UsageCounter"`);

export async function consumeUsage(
  user: { id: string; googleSub: string | null; verifiedEmail?: string | null; plan?: string | null },
  kind: UsageKind,
  networkKey: string | null,
): Promise<UsageResult> {
  const tier = usageTier(user);
  const buckets: Bucket[] = [{ key: `user:${user.id}`, limit: USAGE_LIMITS[tier][kind] }];
  if (tier === "guest" && networkKey) buckets.push({ key: networkKey, limit: GUEST_NETWORK_LIMITS[kind] });
  const ticket = await consumeBuckets(kind, buckets);
  return ticket ? { ok: true, ticket: { ...ticket, kind } } : { ok: false, tier, message: limitReachedMessage(tier, kind) };
}

// 「回答を報告」を 1 回数える（REPORT_LIMITS）。上限なら null。メールを送れなかったら refundUsage で戻す。
export async function consumeReportQuota(
  user: { id: string; googleSub: string | null; verifiedEmail?: string | null; plan?: string | null },
  networkKey: string | null,
): Promise<UsageTicket | null> {
  const buckets: Bucket[] = [{ key: `user:${user.id}`, limit: REPORT_LIMITS.user }];
  if (usageTier(user) === "guest" && networkKey) buckets.push({ key: networkKey, limit: REPORT_LIMITS.guestNetwork });
  return consumeBuckets("report", buckets);
}

async function consumeBuckets(kind: UsageTicket["kind"], buckets: Bucket[]): Promise<UsageTicket | null> {
  const day = usageDay();
  try {
    // 全部の枠に空きがあるときだけ数える。どれかが上限ならトランザクションごと戻す。
    // 条件付きの UPSERT にして、同時に送られても上限を超えて数えないようにしている。
    await prisma.$transaction(async (tx) => {
      for (const bucket of buckets) {
        const rows = await tx.$queryRaw<{ count: number }[]>(Prisma.sql`
          INSERT INTO ${table()} AS c ("key", "kind", "day", "count", "updatedAt")
          VALUES (${bucket.key}, ${kind}, ${day}::date, 1, now())
          ON CONFLICT ("key", "kind", "day") DO UPDATE SET "count" = c."count" + 1, "updatedAt" = now()
          WHERE c."count" < ${bucket.limit}
          RETURNING c."count"
        `);
        if (!rows.length) throw new LimitReached();
      }
    });
  } catch (error) {
    if (error instanceof LimitReached) return null;
    throw error;
  }

  if (Math.random() < 0.01) void purgeOldUsage().catch(() => {});
  return { kind, day, keys: buckets.map((bucket) => bucket.key) };
}

// 何も返せずに失敗した送信は数えない。失敗しても利用者への応答は止めない。
export async function refundUsage(ticket: UsageTicket | null | undefined) {
  if (!ticket) return;
  // 1 行ずつ、数えたときと同じ順で戻す（複数行を一度に更新するとロックの順が逆になり、同時送信とデッドロックしうる）。
  for (const key of ticket.keys) {
    try {
      await prisma.$executeRaw(Prisma.sql`
        UPDATE ${table()} SET "count" = "count" - 1, "updatedAt" = now()
        WHERE "key" = ${key} AND "kind" = ${ticket.kind} AND "day" = ${ticket.day}::date AND "count" > 0
      `);
    } catch (error) {
      console.warn("Failed to refund usage", error instanceof Error ? error.message : error);
    }
  }
}

async function purgeOldUsage() {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  await prisma.usageCounter.deleteMany({ where: { day: { lt: cutoff } } });
}
