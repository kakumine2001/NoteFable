import { Prisma } from "@/generated/prisma/client";
import { databaseSchema, prisma } from "@/lib/prisma";
import { ensureAnonymousDeviceId } from "@/lib/auth";

type RateLimitOptions = {
  // chat/images など、制限対象を分ける名前。
  namespace: string;
  // windowMs 内に許可する最大回数。
  limit: number;
  // レート制限の時間窓。ミリ秒で指定する。
  windowMs: number;
};

type RateLimitResult = {
  // true の場合、呼び出し元は 429 を返す。
  limited: boolean;
  // この時間窓であと何回使えるか。ヘッダーにも載せる。
  remaining: number;
  // 現在の時間窓がリセットされる時刻。Unix ms。
  resetAt: number;
};

// 期限切れバケットの削除は、各プロセスで 1 時間に 1 回までに抑える。
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
// 直近の調査に使えるよう、期限切れから 24 時間はレコードを残す。
const EXPIRED_BUCKET_RETENTION_MS = 24 * 60 * 60 * 1000;

let nextCleanupAt = 0;

async function cleanupExpiredBuckets(now: number) {
  if (now < nextCleanupAt) return;

  // 同時リクエストでも重複実行しないよう、DB 操作より先に次回時刻を進める。
  nextCleanupAt = now + CLEANUP_INTERVAL_MS;

  try {
    await prisma.apiRateLimit.deleteMany({
      where: {
        resetAt: {
          lt: new Date(now - EXPIRED_BUCKET_RETENTION_MS),
        },
      },
    });
  } catch (error) {
    // 期限切れレコードの削除失敗だけで通常の API 呼び出しを止めない。
    console.warn("Failed to clean expired rate limit buckets", error);
  }
}

async function getRateLimitSubject() {
  // StudyMate は匿名利用を前提にしているため、ログインユーザー ID ではなく署名付きデバイス ID を主体にする。
  // namespace と組み合わせることで、チャットと画像生成を別々の枠で制限できる。
  const deviceId = await ensureAnonymousDeviceId();
  return `device:${deviceId}`;
}

export async function checkRateLimit(
  request: Request,
  options: RateLimitOptions,
): Promise<RateLimitResult> {
  // DB の UPSERT で「現在の窓内なら加算、期限切れならリセット」を 1 回のクエリにまとめる。
  // 複数リクエストが近いタイミングで来ても、アプリ側の読み書き分離による競合を起こしにくい。
  const now = Date.now();
  const resetAt = new Date(now + options.windowMs);
  await cleanupExpiredBuckets(now);
  // 現状は Cookie の deviceId を使うため request は未使用。将来 IP 制限を足す余地として引数に残す。
  void request;
  // namespace と利用者識別子を結合し、API 種別ごとに別バケットにする。
  const key = `${options.namespace}:${await getRateLimitSubject()}`;
  const apiRateLimitTable = databaseSchema
    ? Prisma.raw(`"${databaseSchema}"."ApiRateLimit"`)
    : Prisma.raw('"ApiRateLimit"');
  const [bucket] = await prisma.$queryRaw<{ count: number; resetAt: Date }[]>`
    INSERT INTO ${apiRateLimitTable} ("key", "count", "resetAt", "updatedAt")
    VALUES (${key}, 1, ${resetAt}, NOW())
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE
        WHEN ${apiRateLimitTable}."resetAt" <= NOW() THEN 1
        ELSE ${apiRateLimitTable}."count" + 1
      END,
      "resetAt" = CASE
        WHEN ${apiRateLimitTable}."resetAt" <= NOW() THEN ${resetAt}
        ELSE ${apiRateLimitTable}."resetAt"
      END,
      "updatedAt" = NOW()
    RETURNING "count", "resetAt"
  `;

  return {
    limited: bucket.count > options.limit,
    remaining: Math.max(0, options.limit - bucket.count),
    resetAt: bucket.resetAt.getTime(),
  };
}

export function rateLimitHeaders(result: RateLimitResult) {
  return {
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
  };
}
