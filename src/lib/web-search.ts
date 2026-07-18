export type WebSearchMode = "off" | "auto" | "force";

type SearchDecisionInput = {
  role: string;
  content: unknown;
};

type SearchDecisionResponse = {
  choices?: {
    message?: {
      content?: string | null;
    };
  }[];
  error?: {
    message?: string;
  };
};

type SearchDecisionFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

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

function extractDecisionText(content: unknown) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .filter(
      (part): part is { text: string } =>
        typeof part === "object" &&
        part !== null &&
        "text" in part &&
        typeof part.text === "string",
    )
    .map((part) => part.text)
    .join("\n");
}

export function buildWebSearchDecisionContext(input: SearchDecisionInput[]) {
  // 直近の会話だけを渡し、追質問の文脈を残しつつ判定コストを抑える。
  return input
    .slice(-6)
    .map((item) => {
      const text = extractDecisionText(item.content).replace(/\s+/g, " ").trim().slice(0, 1_200);
      return text ? `${item.role.toUpperCase()}: ${text}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

export function parseWebSearchDecision(content: string) {
  const decision = content.trim().toUpperCase();
  if (/^SEARCH\b/.test(decision)) return true;
  if (/^SKIP\b/.test(decision)) return false;
  return null;
}

export async function requestDeepSeekWebSearchDecision({
  input,
  apiKey,
  baseURL,
  model,
  fetcher = fetch,
}: {
  input: SearchDecisionInput[];
  apiKey: string;
  baseURL: string;
  model: string;
  fetcher?: SearchDecisionFetch;
}) {
  const context = buildWebSearchDecisionContext(input);
  if (!context) return false;

  const response = await fetcher(`${baseURL.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: [
            "You route user requests for an AI assistant.",
            "Reply with exactly SEARCH when an accurate answer needs current, changing, niche, location-specific, or externally verifiable information, when the user asks to search or verify, or when a URL must be inspected.",
            "Always choose SEARCH for the identity or status of people holding changeable roles, public offices, or company leadership, and for policies, prices, schedules, availability, recommendations, or software versions that may have changed, even when the user does not say current or latest.",
            "Reply with exactly SKIP for stable knowledge, writing, translation, summarization of provided text, math, and other requests answerable reliably without the web.",
            "Use the recent conversation to understand follow-up questions. When genuinely uncertain whether freshness matters, choose SEARCH. Do not answer the user's request.",
          ].join(" "),
        },
        {
          role: "user",
          content: context,
        },
      ],
      stream: false,
      temperature: 0,
      max_tokens: 16,
      thinking: { type: "disabled" },
    }),
  });

  const text = await response.text();
  let data: SearchDecisionResponse = {};

  try {
    data = text ? (JSON.parse(text) as SearchDecisionResponse) : {};
  } catch {
    data = {};
  }

  if (!response.ok) {
    throw new Error(data.error?.message ?? `DeepSeek search decision failed (${response.status}).`);
  }

  const decision = parseWebSearchDecision(data.choices?.[0]?.message?.content ?? "");
  if (decision === null) {
    throw new Error("DeepSeek returned an invalid web search decision.");
  }

  return decision;
}
