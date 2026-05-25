import { prisma } from "@/lib/prisma";
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
  const resetAt = new Date(Date.now() + options.windowMs);
  // 現状は Cookie の deviceId を使うため request は未使用。将来 IP 制限を足す余地として引数に残す。
  void request;
  // namespace と利用者識別子を結合し、API 種別ごとに別バケットにする。
  const key = `${options.namespace}:${await getRateLimitSubject()}`;
  const [bucket] = await prisma.$queryRaw<{ count: number; resetAt: Date }[]>`
    INSERT INTO "ApiRateLimit" ("key", "count", "resetAt", "updatedAt")
    VALUES (${key}, 1, ${resetAt}, NOW())
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE
        WHEN "ApiRateLimit"."resetAt" <= NOW() THEN 1
        ELSE "ApiRateLimit"."count" + 1
      END,
      "resetAt" = CASE
        WHEN "ApiRateLimit"."resetAt" <= NOW() THEN ${resetAt}
        ELSE "ApiRateLimit"."resetAt"
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
