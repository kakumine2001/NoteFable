// 利用の上限の数値と期間、上限に達したときの API 応答の形。サーバーと画面の両方から読むので、DB などには依存させない。

export type UsageKind = "chat" | "image";
// guest: 未ログイン、member: ログイン済み（無料）、pro: 月額の有料プラン（User.plan = PRO）。
export type UsageTier = "guest" | "member" | "pro";
// 上限を数える期間。day は日本時間の 1 日、month は無料なら日本時間の暦月、PRO なら Stripe の請求期間。
export type UsagePeriod = "day" | "month";

// 上限の回数。チャットは送信 1 回、画像は生成 1 枚で 1 回と数える。期間は USAGE_PERIODS。
// 有料プランの値段（PRO_PRICE_JPY）で API の費用がほぼ賄えるように決めている（docs/architecture/billing.md）。
export const USAGE_LIMITS: Record<UsageTier, Record<UsageKind, number>> = {
  guest: { chat: 20, image: 10 },
  member: { chat: 40, image: 20 },
  pro: { chat: 2000, image: 60 },
};

export const USAGE_PERIODS: Record<UsageTier, Record<UsageKind, UsagePeriod>> = {
  guest: { chat: "day", image: "month" },
  member: { chat: "day", image: "month" },
  pro: { chat: "month", image: "month" },
};

// 月の上限に加えて掛ける 1 日の上限（日本時間の 1 日）。画像は 1 枚の費用が大きいので、月の枠を数日で使い切らせない。
// どちらかに達したら断る。
export const USAGE_DAILY_LIMITS: Record<UsageTier, Partial<Record<UsageKind, number>>> = {
  guest: { image: 3 },
  member: { image: 3 },
  pro: { image: 10 },
};

// 有料プランの月額（税込み、円）。実際の請求額は Stripe の価格（STRIPE_PRICE_ID）で決まり、これは画面の表示用。
export const PRO_PRICE_JPY = 300;

// 初めて申し込む利用者の無料の試用期間（日）。支払い方法を登録して始め、終わると月額の課金が始まる。
// ウェブは Stripe の trial、Android は Play Console の基本プランに付けた無料試用の特典（docs/architecture/billing.md）。
export const PRO_TRIAL_DAYS = 30;

// 未ログイン利用者は Cookie を消すと新しい利用者になるため、同じネットワーク（IP）からの合計にも上限を置く。
// 期間は未ログインの USAGE_PERIODS と同じ（チャットは 1 日、画像は月）。
// 学校などで IP を共有する場合を考えて個人の上限より大きくし、ログインすればこの上限は外れる。
export const GUEST_NETWORK_LIMITS: Record<UsageKind, number> = { chat: 100, image: 30 };

// 「回答を報告」の 1 日の回数（報告は開発者へのメールになるので、送らせすぎない）。未ログインは同じネットワークでも数える。
export const REPORT_LIMITS = { user: 10, guestNetwork: 20 };

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
