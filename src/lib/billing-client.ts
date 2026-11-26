import { msg } from "@/lib/i18n/translate";
import type { UsageKind, UsagePeriod } from "@/lib/usage-plans";

// 画面から使う、有料プランの API（/api/billing）。

export type PlanInfo = {
  billing: boolean;
  priceJpy: number;
  // 無料の試用を出せる日数（出せなければ 0）。
  trialDays: number;
  plan: "free" | "pro";
  subscription: { status: string; periodEnd: string | null; cancelAt: string | null } | null;
  canManage: boolean;
  manageUrl: string | null;
  appStoreManageUrl?: string | null;
  provider: "stripe" | "google" | "apple" | null;
  usage: Record<UsageKind, { used: number; limit: number; period: UsagePeriod; resetsAt: string; daily?: { used: number; limit: number; resetsAt: string } }>;
  // ファイル置き場の使用量と上限（バイト）。
  storage?: { used: number; limit: number };
};

async function readError(response: Response, fallback: string) {
  const data = await response.json().catch(() => null) as { error?: unknown } | null;
  return typeof data?.error === "string" && data.error ? data.error : fallback;
}

export async function loadPlan(options: { refresh?: boolean; signal?: AbortSignal } = {}): Promise<PlanInfo> {
  const response = await fetch(options.refresh ? "/api/billing?refresh=1" : "/api/billing", { cache: "no-store", signal: options.signal });
  if (!response.ok) throw new Error(await readError(response, msg("Could not load your plan.")));
  return await response.json() as PlanInfo;
}

// Stripe の決済画面（申し込み）か管理画面へ移る。失敗したら理由を投げる（移れたら戻らない）。
export async function goToBilling(kind: "checkout" | "portal") {
  const fallback = kind === "checkout" ? msg("Could not open the payment page. Please try again.") : msg("Could not open the subscription page. Please try again.");
  const response = await fetch(`/api/billing/${kind}`, { method: "POST" });
  if (!response.ok) throw new Error(await readError(response, fallback));
  const data = await response.json().catch(() => null) as { url?: unknown } | null;
  if (typeof data?.url !== "string") throw new Error(fallback);
  window.location.assign(data.url);
}
