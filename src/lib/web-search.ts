export type WebSearchMode = "off" | "auto" | "force";

const AUTO_SEARCH_PATTERNS = [
  /\b(latest|current|currently|today|tonight|yesterday|tomorrow|now|recent|recently|news|weather|forecast|price|stock price|exchange rate|score|schedule|release|released|update|updated|version|president|prime minister|ceo)\b/i,
  /\b(this|next|last)\s+(week|month|year|season)\b/i,
  /\b20(?:2[5-9]|[3-9]\d)\b/,
  /https?:\/\//i,
  /(最新|目前|现在|今天|今日|昨天|明天|近期|最近|新闻|天气|预报|价格|股价|汇率|比分|赛程|发布|更新|版本|现任|搜索|搜一下|查一下|联网)/,
  /(最新|現在|今日|昨日|明日|最近|ニュース|天気|予報|価格|株価|為替|試合結果|日程|リリース|更新|バージョン|現職|検索|調べて)/,
];

export function normalizeWebSearchMode(
  value: FormDataEntryValue | null,
  supported: boolean,
): WebSearchMode {
  if (!supported) return "off";

  const mode = String(value ?? "").toLowerCase();
  if (mode === "auto") return "auto";
  if (mode === "force" || mode === "true") return "force";
  return "off";
}

export function shouldUseWebSearch(mode: WebSearchMode, message: string) {
  if (mode === "force") return true;
  if (mode === "off") return false;

  return AUTO_SEARCH_PATTERNS.some((pattern) => pattern.test(message));
}
