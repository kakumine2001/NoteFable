// 回答前の途中経過（推論要約、Web 検索、Pages ツールの動き）を、プロバイダー非依存の形にそろえる。
// サーバーは上流イベントを ActivityEvent に変換して流し、クライアントは ActivityStep に積み上げて表示する。

export type WebAction =
  | { kind: "search"; queries: string[]; sources: string[] }
  | { kind: "open_page"; url: string }
  | { kind: "find_in_page"; url: string; pattern: string };

export type ActivityStep =
  | { id: string; kind: "thought"; text: string }
  | { id: string; kind: "web"; status: "running" | "done"; action?: WebAction }
  | { id: string; kind: "tool"; status: "running" | "done"; name: string; label?: string };

export type ActivityEvent =
  | { type: "thought"; id: string; delta: string }
  | { type: "web"; id: string; status: "running" | "done"; action?: WebAction }
  | { type: "tool"; id: string; status: "running" | "done"; name: string; label?: string };

type UpstreamEvent = {
  type?: unknown;
  id?: unknown;
  name?: unknown;
  status?: unknown;
  label?: unknown;
  item_id?: unknown;
  summary_index?: unknown;
  content_index?: unknown;
  delta?: unknown;
  item?: {
    id?: unknown;
    type?: unknown;
    status?: unknown;
    action?: {
      type?: unknown;
      query?: unknown;
      queries?: unknown;
      url?: unknown;
      pattern?: unknown;
      sources?: unknown;
    };
  };
};

const MAX_QUERIES = 8;
const MAX_SOURCES = 20;
const MAX_TEXT = 300;

function text(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, MAX_TEXT) : "";
}

// 画面でリンクにするため、http(s) 以外の URL は捨てる。
function safeUrl(value: unknown) {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
  } catch {
    return "";
  }
}

function parseWebAction(action: NonNullable<UpstreamEvent["item"]>["action"]): WebAction | undefined {
  if (!action) return undefined;

  if (action.type === "search") {
    const queries = [
      ...new Set(
        (Array.isArray(action.queries) ? action.queries : [action.query]).map(text).filter(Boolean),
      ),
    ].slice(0, MAX_QUERIES);
    const sources = [
      ...new Set(
        (Array.isArray(action.sources) ? action.sources : [])
          .map((source) => safeUrl((source as { url?: unknown } | null)?.url))
          .filter(Boolean),
      ),
    ].slice(0, MAX_SOURCES);
    return { kind: "search", queries, sources };
  }

  const url = safeUrl(action.url);
  if (!url) return undefined;
  if (action.type === "open_page") return { kind: "open_page", url };
  if (action.type === "find_in_page") return { kind: "find_in_page", url, pattern: text(action.pattern) };
  return undefined;
}

// 上流の SSE イベント 1 件から、表示用の途中経過イベントを取り出す。対象外なら null。
export function parseActivityEvent(event: UpstreamEvent): ActivityEvent | null {
  // OpenAI は推論要約、DeepSeek は推論本文を差分で返す。どちらも同じ「思考」として扱う。
  if (
    event.type === "response.reasoning_summary_text.delta" ||
    event.type === "response.reasoning_text.delta"
  ) {
    if (typeof event.delta !== "string" || !event.delta) return null;
    const index = event.type === "response.reasoning_summary_text.delta" ? event.summary_index : event.content_index;
    const itemId = typeof event.item_id === "string" ? event.item_id : "reasoning";
    return { type: "thought", id: `${itemId}:${typeof index === "number" ? index : 0}`, delta: event.delta };
  }

  // サーバー側で実行した Pages ツールの開始と完了（anthropic-messages.ts が出す内部イベント）。
  if (event.type === "studymate.tool") {
    if (typeof event.id !== "string" || typeof event.name !== "string") return null;
    const status = event.status === "done" ? "done" : "running";
    const label = text(event.label);
    return { type: "tool", id: event.id, status, name: text(event.name), ...(label ? { label } : {}) };
  }

  const item = event.item;
  if (item?.type !== "web_search_call" || typeof item.id !== "string") return null;
  if (event.type === "response.output_item.added") return { type: "web", id: item.id, status: "running" };
  if (event.type === "response.output_item.done") {
    return { type: "web", id: item.id, status: "done", action: parseWebAction(item.action) };
  }
  return null;
}

// 途中経過イベントを、id 単位で既存ステップへ反映する。
export function applyActivityEvent(steps: ActivityStep[], event: ActivityEvent): ActivityStep[] {
  const index = steps.findIndex((step) => step.id === event.id);

  if (event.type === "thought") {
    if (index === -1) return [...steps, { id: event.id, kind: "thought", text: event.delta }];
    const current = steps[index];
    if (current.kind !== "thought") return steps;
    const updated = { ...current, text: current.text + event.delta };
    return steps.map((step, i) => (i === index ? updated : step));
  }

  const next: ActivityStep = event.type === "tool"
    ? { id: event.id, kind: "tool", status: event.status, name: event.name, label: event.label }
    : { id: event.id, kind: "web", status: event.status, action: event.action };
  return index === -1 ? [...steps, next] : steps.map((step, i) => (i === index ? next : step));
}

// OpenAI の推論要約は「**見出し**\n\n本文」の形なので、見出しと本文に分ける。
export function splitThought(text: string) {
  const match = text.match(/^\s*\*\*(.+?)\*\*\s*/);
  if (!match) return { title: "", body: text.trim() };
  return { title: match[1].trim(), body: text.slice(match[0].length).trim() };
}

export function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
