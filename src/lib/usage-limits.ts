import { createHmac } from "crypto";
import { Prisma } from "@/generated/prisma/client";
import { getCookieSecret } from "@/lib/env";
import { msg } from "@/lib/i18n/translate";
import { databaseSchema, prisma } from "@/lib/prisma";
import { GUEST_NETWORK_LIMITS, REPORT_LIMITS, USAGE_DAILY_LIMITS, USAGE_LIMIT_CODE, USAGE_LIMITS, USAGE_PERIODS, type UsageKind, type UsagePeriod, type UsageTier } from "@/lib/usage-plans";

export { GUEST_NETWORK_LIMITS, USAGE_DAILY_LIMITS, USAGE_LIMITS, USAGE_PERIODS, type UsageKind, type UsageTier };

// 日付の切り替えは日本時間の 0 時。
const DAY_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
// 古い集計行を残す日数。消すのは消費時にときどきだけ（cron はない）。月ごとの行は期間の初日を day に持つので長めに残す。
const RETENTION_DAYS = 7;
const MONTHLY_RETENTION_DAYS = 62;

// 上限の計算に要る利用者の項目。PRO の月の上限は請求期間（subscriptionPeriodStart / End）ごとに数える。
export type UsageUser = {
  id: string;
  googleSub: string | null;
  verifiedEmail?: string | null;
  appleSub?: string | null;
  subscriptionProvider?: string | null;
  plan?: string | null;
  subscriptionPeriodStart?: Date | null;
  subscriptionPeriodEnd?: Date | null;
};

export function usageDay(now = new Date()) {
  return new Date(now.getTime() + DAY_OFFSET_MS).toISOString().slice(0, 10);
}

type UsagePlanOwner = Omit<UsageUser, "id" | "subscriptionPeriodStart">;

export function usageTier(user: UsagePlanOwner, now = Date.now()): UsageTier {
  const appleExpired = user.subscriptionProvider === "apple" && (user.subscriptionPeriodEnd?.getTime() ?? 0) <= now;
  if (user.plan === "PRO" && !appleExpired) return "pro";
  // Google でもメールでも、ログインしていれば会員。
  return user.googleSub || user.verifiedEmail || user.appleSub ? "member" : "guest";
}

// 期間の初日（日本時間の日付）と、次に数え直す時刻。
// 月の期間は、PRO でいまを含む請求期間があればその初日、それ以外は日本時間の暦月（無料、手動で PRO にした行、更新の知らせがまだ来ていないとき）。
// 無料に戻った利用者には古い請求期間を使わない（PRO の間の数で無料の枠が埋まらないように）。
export function usagePeriodWindow(period: UsagePeriod, tier: UsageTier, user: Pick<UsageUser, "subscriptionPeriodStart" | "subscriptionPeriodEnd">, now = new Date()) {
  const local = new Date(now.getTime() + DAY_OFFSET_MS);
  if (period === "day") {
    const start = usageDay(now);
    return { start, resetsAt: new Date(Date.parse(`${start}T00:00:00Z`) - DAY_OFFSET_MS + DAY_MS) };
  }
  const { subscriptionPeriodStart: from, subscriptionPeriodEnd: to } = user;
  if (tier === "pro" && from && to && from.getTime() <= now.getTime() && now.getTime() < to.getTime()) {
    return { start: usageDay(from), resetsAt: to };
  }
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth();
  return {
    start: new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10),
    resetsAt: new Date(Date.UTC(year, month + 1, 1) - DAY_OFFSET_MS),
  };
}

// UsageCounter.kind。月ごとの行は日ごとの行と別の名前にして、古い行の掃除で期間中の行を消さないようにする。
// PRO の行（chat:pro / image:pro）と無料の月の行（image:month）も分ける。期間の初日が同じでも、無料の間の数を PRO に持ち込まない（逆も）。
function counterKind(kind: UsageKind, period: UsagePeriod, tier: UsageTier) {
  if (period === "day") return kind;
  return tier === "pro" ? `${kind}:pro` : `${kind}:month`;
}

// 上限を数えるネットワークの単位。IPv4 はアドレスそのもの、IPv6 は先頭 64 ビット
// （利用者には /64 以上が丸ごと割り当てられるので、アドレスを変えるだけで未ログインの上限を逃れられないように）。
// IPv4 を包んだ IPv6（::ffff:1.2.3.4）は IPv4 として数える。読めない形はそのまま使う。
export function networkAddress(ip: string) {
  if (!ip.includes(":")) return ip;
  const address = ip.split("%")[0].toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(address);
  if (mapped) return mapped[1];
  const halves = address.split("::");
  if (halves.length > 2) return ip;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves[1] ? halves[1].split(":") : [];
  const groups = halves.length === 2 ? [...head, ...Array<string>(Math.max(0, 8 - head.length - tail.length)).fill("0"), ...tail] : head;
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return ip;
  return `${groups.slice(0, 4).map((group) => parseInt(group, 16).toString(16)).join(":")}::/64`;
}

export function clientNetworkKey(request: Request) {
  // Vercel は x-forwarded-for を受け取った接続元で上書きする。ローカルなど取れない環境では IP の上限を掛けない。
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || request.headers.get("x-real-ip")?.trim();
  if (!ip) return null;
  // IP そのものは保存しない。
  return `ip:${createHmac("sha256", getCookieSecret()).update(`usage:${networkAddress(ip)}`).digest("base64url")}`;
}

// period: 達した上限の期間（画像は 1 日と月の両方に上限がある）。
export function limitReachedMessage(tier: UsageTier, kind: UsageKind, period: UsagePeriod = USAGE_PERIODS[tier][kind]) {
  if (tier === "guest") {
    if (kind === "chat") return msg("You've used today's free messages. Sign in for more, or try again tomorrow.");
    return period === "day"
      ? msg("You've used today's free image generations. Sign in for more, or try again tomorrow.")
      : msg("You've used this month's free image generations. Sign in for more.");
  }
  if (tier === "member") {
    if (kind === "chat") return msg("You've used today's free messages. Try again tomorrow.");
    return period === "day"
      ? msg("You've used today's free image generations. Try again tomorrow.")
      : msg("You've used this month's free image generations.");
  }
  if (period === "day") return msg("You've used today's image generations. Try again tomorrow.");
  return kind === "image"
    ? msg("You've used this period's image generations. They reset when your plan renews.")
    : msg("You've used this period's messages. They reset when your plan renews.");
}

type Bucket = { key: string; kind: string; day: string; limit: number; period: UsagePeriod };
// 数えた行。kind は UsageCounter.kind（日ごとの chat / image、月ごとの image:month / chat:pro / image:pro と、用量の段階に入らない report）。
export type UsageTicket = { buckets: { key: string; kind: string; day: string }[] };
export type UsageResult = { ok: true; ticket: UsageTicket } | { ok: false; tier: UsageTier; message: string };

// 上限に達したときの 429 応答。画面は code と tier を見て、未ログインならログイン、無料ならアップグレードを勧める。
export function usageLimitResponse(result: Extract<UsageResult, { ok: false }>, kind: UsageKind) {
  return Response.json({ error: result.message, code: USAGE_LIMIT_CODE, tier: result.tier, kind }, { status: 429 });
}

class LimitReached extends Error {
  constructor(readonly bucket: Bucket) { super("limit reached"); }
}

const table = () => Prisma.raw(`"${databaseSchema}"."UsageCounter"`);

export async function consumeUsage(user: UsageUser, kind: UsageKind, networkKey: string | null): Promise<UsageResult> {
  const tier = usageTier(user);
  const period = USAGE_PERIODS[tier][kind];
  // 時刻は 1 回だけ取る（日付の変わり目で、利用者とネットワークの枠が別の日に数えられないように）。
  const now = new Date();
  const start = usagePeriodWindow(period, tier, user, now).start;
  const buckets: Bucket[] = [{ key: `user:${user.id}`, kind: counterKind(kind, period, tier), day: start, limit: USAGE_LIMITS[tier][kind], period }];
  // 月の上限に加えて 1 日の上限がある種類（画像）。日ごとの行は種類の名前そのまま。
  const daily = period === "month" ? USAGE_DAILY_LIMITS[tier][kind] : undefined;
  if (daily !== undefined) buckets.push({ key: `user:${user.id}`, kind, day: usageDay(now), limit: daily, period: "day" });
  // ネットワークの枠は未ログインの期間で数える。月の行は無料の月の行と同じ名前（鍵が違う）で、暦月の初日に置く。
  if (tier === "guest" && networkKey) buckets.push({ key: networkKey, kind: counterKind(kind, period, tier), day: start, limit: GUEST_NETWORK_LIMITS[kind], period });
  const result = await consumeBuckets(buckets);
  return "ticket" in result ? { ok: true, ticket: result.ticket } : { ok: false, tier, message: limitReachedMessage(tier, kind, result.full.period) };
}

// 「回答を報告」を 1 回数える（REPORT_LIMITS）。上限なら null。メールを送れなかったら refundUsage で戻す。
export async function consumeReportQuota(user: UsageUser, networkKey: string | null): Promise<UsageTicket | null> {
  const day = usageDay();
  const buckets: Bucket[] = [{ key: `user:${user.id}`, kind: "report", day, limit: REPORT_LIMITS.user, period: "day" }];
  if (usageTier(user) === "guest" && networkKey) buckets.push({ key: networkKey, kind: "report", day, limit: REPORT_LIMITS.guestNetwork, period: "day" });
  const result = await consumeBuckets(buckets);
  return "ticket" in result ? result.ticket : null;
}

// 全部の枠に空きがあれば数えて ticket を返す。どれかが上限なら、その枠を full で返す（何も数えない）。
async function consumeBuckets(buckets: Bucket[]): Promise<{ ticket: UsageTicket } | { full: Bucket }> {
  // 上限 0 は使えない機能。INSERT は条件なしで 1 を書くので、先に断る。
  const closed = buckets.find((bucket) => bucket.limit <= 0);
  if (closed) return { full: closed };
  try {
    // 全部の枠に空きがあるときだけ数える。どれかが上限ならトランザクションごと戻す。
    // 条件付きの UPSERT にして、同時に送られても上限を超えて数えないようにしている。
    await prisma.$transaction(async (tx) => {
      for (const bucket of buckets) {
        const rows = await tx.$queryRaw<{ count: number }[]>(Prisma.sql`
          INSERT INTO ${table()} AS c ("key", "kind", "day", "count", "updatedAt")
          VALUES (${bucket.key}, ${bucket.kind}, ${bucket.day}::date, 1, now())
          ON CONFLICT ("key", "kind", "day") DO UPDATE SET "count" = c."count" + 1, "updatedAt" = now()
          WHERE c."count" < ${bucket.limit}
          RETURNING c."count"
        `);
        if (!rows.length) throw new LimitReached(bucket);
      }
    });
  } catch (error) {
    if (error instanceof LimitReached) return { full: error.bucket };
    throw error;
  }

  if (Math.random() < 0.01) void purgeOldUsage().catch(() => {});
  return { ticket: { buckets: buckets.map(({ key, kind, day }) => ({ key, kind, day })) } };
}

// daily: 月の上限に加えて 1 日の上限がある種類（画像）の、今日の分。
export type UsageSummary = {
  tier: UsageTier;
  usage: Record<UsageKind, { used: number; limit: number; period: UsagePeriod; resetsAt: string; daily?: { used: number; limit: number; resetsAt: string } }>;
};

// 設定の「プラン」に出す、いまの期間の使用量。
export async function usageSummary(user: UsageUser, now = new Date()): Promise<UsageSummary> {
  const tier = usageTier(user);
  const today = usagePeriodWindow("day", tier, user, now);
  const windows = (["chat", "image"] as const).map((kind) => {
    const period = USAGE_PERIODS[tier][kind];
    return { kind, period, counterKind: counterKind(kind, period, tier), daily: period === "month" ? USAGE_DAILY_LIMITS[tier][kind] : undefined, ...usagePeriodWindow(period, tier, user, now) };
  });
  const rows = await prisma.usageCounter.findMany({
    where: {
      key: `user:${user.id}`,
      OR: windows.flatMap((window) => [
        { kind: window.counterKind, day: new Date(`${window.start}T00:00:00Z`) },
        ...(window.daily !== undefined ? [{ kind: window.kind as string, day: new Date(`${today.start}T00:00:00Z`) }] : []),
      ]),
    },
    select: { kind: true, count: true },
  });
  const count = (kind: string) => rows.find((row) => row.kind === kind)?.count ?? 0;
  const entry = (window: (typeof windows)[number]) => ({
    used: Math.min(count(window.counterKind), USAGE_LIMITS[tier][window.kind]),
    limit: USAGE_LIMITS[tier][window.kind],
    period: window.period,
    resetsAt: window.resetsAt.toISOString(),
    ...(window.daily !== undefined ? { daily: { used: Math.min(count(window.kind), window.daily), limit: window.daily, resetsAt: today.resetsAt.toISOString() } } : {}),
  });
  return { tier, usage: { chat: entry(windows[0]), image: entry(windows[1]) } };
}

// 何も返せずに失敗した送信は数えない。失敗しても利用者への応答は止めない。
export async function refundUsage(ticket: UsageTicket | null | undefined) {
  if (!ticket) return;
  // 1 行ずつ、数えたときと同じ順で戻す（複数行を一度に更新するとロックの順が逆になり、同時送信とデッドロックしうる）。
  for (const bucket of ticket.buckets) {
    try {
      await prisma.$executeRaw(Prisma.sql`
        UPDATE ${table()} SET "count" = "count" - 1, "updatedAt" = now()
        WHERE "key" = ${bucket.key} AND "kind" = ${bucket.kind} AND "day" = ${bucket.day}::date AND "count" > 0
      `);
    } catch (error) {
      console.warn("Failed to refund usage", error instanceof Error ? error.message : error);
    }
  }
}

async function purgeOldUsage() {
  const now = Date.now();
  await prisma.usageCounter.deleteMany({
    where: {
      OR: [
        { kind: { in: ["chat", "image", "report"] }, day: { lt: new Date(now - RETENTION_DAYS * DAY_MS) } },
        { day: { lt: new Date(now - MONTHLY_RETENTION_DAYS * DAY_MS) } },
      ],
    },
  });
}
