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
  member: { image: 5 },
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

const MIB = 1024 * 1024;

// ファイル置き場（Private Vercel Blob）に置ける合計の容量（バイト）。チャットの添付画像・生成した画像・ノートのファイル・
// カバー・プロフィール画像など、その利用者のファイルをすべて足して数える（src/lib/stored-files.ts）。
// 超えると新しいアップロードを断る（置いてあるファイルはそのまま）。表示は 1024 進で「MB」「GB」（4 MiB を「4 MB」と書くのと同じ）。
export const STORAGE_LIMITS: Record<UsageTier, number> = {
  guest: 100 * MIB,
  member: 500 * MIB,
  pro: 10 * 1024 * MIB,
};

// ワークスペース（ノートの画像・ファイル、カバー、ページアイコン。今後のホワイトボードやスライドの画像も）に
// アップロードできる 1 ファイルの上限。Vercel Functions の受信上限 4.5 MB に multipart の余白を残す。
// チャットの添付は別（Blob へ直接送るので 1 ファイル 20 MiB、upload-limits.ts）。
export const MAX_STORED_FILE_BYTES = 4 * MIB;

// Android / iOS の安装包に入れる上限（assets/usage-limits.json、scripts/gen-native-usage-limits.ts）。回数に容量（バイト）を足したもの。
export function nativeUsageLimits() {
  return Object.fromEntries((Object.keys(USAGE_LIMITS) as UsageTier[]).map((tier) => [tier, { ...USAGE_LIMITS[tier], storage: STORAGE_LIMITS[tier] }]));
}

export const USAGE_LIMIT_CODE = "usage_limit";
export const STORAGE_LIMIT_CODE = "storage_limit";

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

// 413 の本文 { error, code: "storage_limit", tier, used, limit } を画面側で区別するための例外。
// used / limit はバイト数。画面は tier を見て、未ログインならログイン、無料ならアップグレードを勧める。
export class StorageLimitError extends Error {
  constructor(message: string, readonly tier: UsageTier, readonly used: number, readonly limit: number) {
    super(message);
    this.name = "StorageLimitError";
  }
}

const byteCount = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

export function storageLimitErrorFrom(status: number, data: unknown): StorageLimitError | null {
  if (status !== 413 || !data || typeof data !== "object") return null;
  const body = data as Record<string, unknown>;
  const used = byteCount(body.used);
  const limit = byteCount(body.limit);
  if (body.code !== STORAGE_LIMIT_CODE || typeof body.error !== "string" || !TIERS.includes(String(body.tier)) || used === null || limit === null) return null;
  return new StorageLimitError(body.error, body.tier as UsageTier, used, limit);
}

// 容量の表示（「12.5 MB」「10 GB」）。1024 進で、単位は KB / MB / GB（言語によらず同じ）。数字の区切りは表示言語に合わせる。
export function formatStorageSize(bytes: number, tag = "en") {
  const value = Math.max(0, bytes);
  const [amount, unit] = value >= 1024 * MIB ? [value / (1024 * MIB), "GB"] : value >= MIB ? [value / MIB, "MB"] : [value / 1024, "KB"];
  // 10 未満だけ小数第 1 位まで出す（0.4 MB、2.5 GB）。KB は整数。
  const digits = unit !== "KB" && amount < 10 ? 1 : 0;
  // 切り捨てて、使用量が実際より多く見えないようにする（上限ちょうどの 500 MB を 500 MB と出す）。
  const shown = Math.floor(amount * 10 ** digits) / 10 ** digits;
  return `${new Intl.NumberFormat(tag, { maximumFractionDigits: digits }).format(shown)} ${unit}`;
}
