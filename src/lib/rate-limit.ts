import { prisma } from "@/lib/prisma";

type RateLimitOptions = {
  namespace: string;
  limit: number;
  windowMs: number;
};

type RateLimitResult = {
  limited: boolean;
  remaining: number;
  resetAt: number;
};

function getClientIp(request: Request) {
  return request.headers.get("cf-connecting-ip") || "unknown";
}

export async function checkRateLimit(
  request: Request,
  options: RateLimitOptions,
): Promise<RateLimitResult> {
  const resetAt = new Date(Date.now() + options.windowMs);
  const key = `${options.namespace}:${getClientIp(request)}`;
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
