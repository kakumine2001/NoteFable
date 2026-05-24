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
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (
    forwardedFor ||
    request.headers.get("x-real-ip") ||
    request.headers.get("cf-connecting-ip") ||
    "unknown"
  );
}

export async function checkRateLimit(
  request: Request,
  options: RateLimitOptions,
): Promise<RateLimitResult> {
  const now = new Date();
  const resetAt = new Date(now.getTime() + options.windowMs);
  const key = `${options.namespace}:${getClientIp(request)}`;
  const bucket = await prisma.apiRateLimit.findUnique({ where: { key } });

  if (!bucket) {
    const created = await prisma.apiRateLimit.create({
      data: {
        key,
        count: 1,
        resetAt,
      },
    });

    return {
      limited: false,
      remaining: options.limit - created.count,
      resetAt: created.resetAt.getTime(),
    };
  }

  if (bucket.resetAt <= now) {
    const refreshed = await prisma.apiRateLimit.update({
      where: { key },
      data: {
        count: 1,
        resetAt,
      },
    });

    return {
      limited: false,
      remaining: options.limit - refreshed.count,
      resetAt: refreshed.resetAt.getTime(),
    };
  }

  if (bucket.count >= options.limit) {
    return {
      limited: true,
      remaining: 0,
      resetAt: bucket.resetAt.getTime(),
    };
  }

  const updated = await prisma.apiRateLimit.update({
    where: { key },
    data: {
      count: { increment: 1 },
    },
  });

  return {
    limited: false,
    remaining: Math.max(0, options.limit - updated.count),
    resetAt: updated.resetAt.getTime(),
  };
}

export function rateLimitHeaders(result: RateLimitResult) {
  return {
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
  };
}
