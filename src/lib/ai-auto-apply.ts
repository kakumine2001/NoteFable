import { PAGE_KINDS, type PageKind } from "@/lib/page-kinds";

// AI パネルの「自動適用」の設定。このブラウザ（アプリでは WebView）に、ページの種類ごとに覚える。既定は切（提案 → 確認）。
// 入れると /api/chat に autoApply=1 を送り、AI の編集案はすぐ適用される（ページの履歴に残り、カードから元に戻せる）。
const KEY = "notefable:ai-auto-apply:v1";

function read(): Partial<Record<PageKind, boolean>> {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "{}") as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as Partial<Record<PageKind, boolean>> : {};
  } catch {
    return {};
  }
}

export function loadAutoApply(kind: PageKind): boolean {
  return read()[kind] === true;
}

export function saveAutoApply(kind: PageKind, on: boolean) {
  const next = Object.fromEntries(PAGE_KINDS.map((entry) => [entry, entry === kind ? on : read()[entry] === true]).filter(([, value]) => value));
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* 保存できなくても、この画面の間は効く。 */ }
}
