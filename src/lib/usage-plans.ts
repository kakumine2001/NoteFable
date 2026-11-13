// 日ごとの上限の数値と、上限に達したときの API 応答の形。サーバーと画面の両方から読むので、DB などには依存させない。

export type UsageKind = "chat" | "image";
// guest: 未ログイン、member: Google ログイン済み、pro: 有料プラン（AnonymousUser.plan = PRO）。
export type UsageTier = "guest" | "member" | "pro";

// 1 日あたりの上限。チャットは送信 1 回、画像は生成 1 枚で 1 回と数える。
export const USAGE_LIMITS: Record<UsageTier, Record<UsageKind, number>> = {
  guest: { chat: 20, image: 3 },
  member: { chat: 100, image: 20 },
  pro: { chat: 1000, image: 200 },
};

// 未ログイン利用者は Cookie を消すと新しい利用者になるため、同じネットワーク（IP）からの合計にも上限を置く。
// 学校などで IP を共有する場合を考えて個人の上限より大きくし、ログインすればこの上限は外れる。
export const GUEST_NETWORK_LIMITS: Record<UsageKind, number> = { chat: 100, image: 10 };

export const USAGE_LIMIT_CODE = "usage_limit";

// 429 の本文 { error, code: "usage_limit", tier, kind } を画面側で区別するための例外。
export class UsageLimitError extends Error {
  constructor(message: string, readonly tier: UsageTier, readonly kind: UsageKind) {
    super(message);
    this.name = "UsageLimitError";
  }
}

const TIERS: readonly string[] = ["guest", "member", "pro"];

export function usageLimitErrorFrom(status: number, data: unknown): UsageLimitError | null {
  if (status !== 429 || !data || typeof data !== "object") return null;
  const body = data as Record<string, unknown>;
  if (body.code !== USAGE_LIMIT_CODE || typeof body.error !== "string" || !TIERS.includes(String(body.tier))) return null;
  return new UsageLimitError(body.error, body.tier as UsageTier, body.kind === "image" ? "image" : "chat");
}
