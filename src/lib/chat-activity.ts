// 回答前の途中経過（推論要約、Web 検索、Notes ツールの動き）を、プロバイダー非依存の形にそろえる。
// サーバーは上流イベントを ActivityEvent に変換して流し、クライアントは ActivityStep に積み上げて表示する。
import type { PageCreateProposal, PageEditProposal } from "@/lib/page-edit";
import { isFailureInfo, type FailureInfo } from "@/lib/failure-text";

export type WebAction =
  | { kind: "search"; queries: string[]; sources: string[] }
  | { kind: "open_page"; url: string }
  | { kind: "find_in_page"; url: string; pattern: string };

// 回答に使ったプロジェクトの共通指示・参照ノート。ノートの本文は含めず、画面に出す出典だけを持つ。
export type ContextNote = { id: string; title: string; truncated?: boolean };
export type ContextInfo = { projectName: string; hasInstructions: boolean; notes: ContextNote[] };

export type ActivityStep =
  | { id: string; kind: "thought"; text: string }
  | ({ id: string; kind: "context" } & ContextInfo)
  | { id: string; kind: "web"; status: "running" | "done"; action?: WebAction }
  | { id: string; kind: "tool"; status: "running" | "done"; name: string; label?: string }
  | ({ id: string; kind: "failure" } & FailureInfo)
  | ({ kind: "proposal" } & PageEditProposal)
  | ({ kind: "create_proposal" } & PageCreateProposal);

// 進捗の一覧に出すステップ。編集案・新規ページ案は一覧ではなく、回答の下に承認カードとして出す。
export type ProgressStep = Exclude<ActivityStep, { kind: "proposal" | "create_proposal" | "failure" }>;
type StoredStep = Exclude<ActivityStep, { kind: "proposal" | "create_proposal" }>;

export type ActivityEvent =
  | { type: "thought"; id: string; delta: string }
  | ({ type: "context"; id: string } & ContextInfo)
  | { type: "web"; id: string; status: "running" | "done"; action?: WebAction }
  | { type: "tool"; id: string; status: "running" | "done"; name: string; label?: string }
  | ({ type: "failure"; id: string } & FailureInfo)
  | ({ type: "proposal" } & PageEditProposal)
  | ({ type: "create_proposal" } & PageCreateProposal);

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
const MAX_CONTEXT_NOTES = 10;
const MAX_CONTEXT_ID = 100;
// プロジェクトの文脈は 1 回の回答に 1 つだけ。再送されても同じステップを置き換える。
export const CONTEXT_STEP_ID = "project-context";

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

// 画面に出す前に、文字列の長さと件数を抑え、形が崩れたノートは捨てる。指示もノートも無ければ null。
function parseContextInfo(value: unknown): ContextInfo | null {
  const data = value as Record<string, unknown> | null;
  if (!data || typeof data !== "object") return null;
  const projectName = text(data.projectName);
  if (!projectName) return null;
  const notes: ContextNote[] = [];
  for (const item of Array.isArray(data.notes) ? data.notes : []) {
    const note = item as Record<string, unknown> | null;
    const id = typeof note?.id === "string" ? note.id.trim() : "";
    if (!note || !id || id.length > MAX_CONTEXT_ID || typeof note.title !== "string" || notes.some((existing) => existing.id === id)) continue;
    notes.push({ id, title: text(note.title) || "Untitled", ...(note.truncated === true ? { truncated: true } : {}) });
    if (notes.length >= MAX_CONTEXT_NOTES) break;
  }
  const hasInstructions = data.hasInstructions === true;
  return hasInstructions || notes.length ? { projectName, hasInstructions, notes } : null;
}

// サーバーが回答の最初に流す「このプロジェクトの文脈を使った」イベントを作る。
export function contextActivityEvent(info: ContextInfo): ActivityEvent | null {
  const parsed = parseContextInfo(info);
  return parsed ? { type: "context", id: CONTEXT_STEP_ID, ...parsed } : null;
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
export function parseActivityEvent(event: UpstreamEvent & Record<string, unknown>): ActivityEvent | null {
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

  // サーバー側で実行した Notes ツールの開始と完了（anthropic-messages.ts が出す内部イベント）。
  if (event.type === "notefable.tool") {
    if (typeof event.id !== "string" || typeof event.name !== "string") return null;
    const status = event.status === "done" ? "done" : "running";
    const label = text(event.label);
    return { type: "tool", id: event.id, status, name: text(event.name), ...(label ? { label } : {}) };
  }

  // 編集案（propose_note_edit）。承認カードに必要な項目がそろっているものだけ通す。
  if (event.type === "notefable.proposal") {
    const proposal = event as unknown as PageEditProposal;
    const valid = typeof proposal.id === "string" && typeof proposal.pageId === "string" && typeof proposal.pageTitle === "string"
      && Number.isSafeInteger(proposal.baseVersion) && Array.isArray(proposal.changes)
      && typeof proposal.proposed?.title === "string" && Array.isArray(proposal.proposed.blocks);
    return valid ? { ...proposal, type: "proposal" } : null;
  }

  // 新規ページ案（propose_note_create）。
  if (event.type === "notefable.create_proposal") {
    const proposal = event as unknown as PageCreateProposal;
    const valid = typeof proposal.id === "string" && typeof proposal.title === "string" && typeof proposal.content === "string"
      && typeof proposal.proposed?.title === "string" && Array.isArray(proposal.proposed.blocks);
    return valid ? { ...proposal, type: "create_proposal" } : null;
  }

  const item = event.item;
  if (item?.type !== "web_search_call" || typeof item.id !== "string") return null;
  if (event.type === "response.output_item.added") return { type: "web", id: item.id, status: "running" };
  if (event.type === "response.output_item.done") {
    // 失敗した検索・ページ読み取り（status: "failed"）は action を持たせず、参照数にも保存済み履歴にも含めない。
    return { type: "web", id: item.id, status: "done", action: item.status === "failed" ? undefined : parseWebAction(item.action) };
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

  if (event.type === "context") {
    const { type: _type, ...rest } = event;
    void _type;
    const step: ActivityStep = { ...rest, kind: "context" };
    return index === -1 ? [...steps, step] : steps.map((existing, i) => (i === index ? step : existing));
  }

  if (event.type === "proposal") {
    const { type: _type, ...rest } = event;
    void _type;
    const step: ActivityStep = { ...rest, kind: "proposal" };
    return index === -1 ? [...steps, step] : steps.map((existing, i) => (i === index ? step : existing));
  }
  if (event.type === "create_proposal") {
    const { type: _type, ...rest } = event;
    void _type;
    const step: ActivityStep = { ...rest, kind: "create_proposal" };
    return index === -1 ? [...steps, step] : steps.map((existing, i) => (i === index ? step : existing));
  }
  if (event.type === "failure") {
    if (!isFailureInfo(event)) return steps;
    const step: ActivityStep = { id: event.id, kind: "failure", offset: event.offset, detail: event.detail };
    return index === -1 ? [...steps, step] : steps.map((existing, i) => (i === index ? step : existing));
  }
  const next: ActivityStep = event.type === "tool"
    ? { id: event.id, kind: "tool", status: event.status, name: event.name, label: event.label }
    : { id: event.id, kind: "web", status: event.status, action: event.action };
  return index === -1 ? [...steps, next] : steps.map((step, i) => (i === index ? next : step));
}

// DB に残す推論テキストの合計上限。DeepSeek は推論本文が長くなるため、行が肥大しないよう打ち切る。
const MAX_STORED_THOUGHT = 20000;

// 途中経過を DB 保存用の JSON にする。提案は NoteProposal に別途保存済みなので含めない。
export function serializeActivity(steps: ActivityStep[]): string | undefined {
  let budget = MAX_STORED_THOUGHT;
  const stored: StoredStep[] = [];
  for (const step of steps) {
    if (step.kind === "proposal" || step.kind === "create_proposal") continue;
    // 完了しなかった検索（action なし）は、再読み込み後に「検索中」のまま残るので保存しない。
    if (step.kind === "web" && !step.action) continue;
    if (step.kind !== "thought") {
      stored.push(step);
      continue;
    }
    if (budget <= 0 || !step.text.trim()) continue;
    stored.push({ ...step, text: step.text.slice(0, budget) });
    budget -= step.text.length;
  }
  return stored.length ? JSON.stringify(stored) : undefined;
}

function parseStoredWebAction(value: unknown): WebAction | undefined {
  const action = value as Partial<WebAction> | null;
  if (!action || typeof action !== "object") return undefined;
  if (action.kind === "search") {
    const queries = Array.isArray(action.queries) ? action.queries.filter((item) => typeof item === "string") : [];
    const sources = Array.isArray(action.sources) ? action.sources.map(safeUrl).filter(Boolean) : [];
    return { kind: "search", queries, sources };
  }
  if (action.kind === "open_page" || action.kind === "find_in_page") {
    const url = safeUrl(action.url);
    if (!url) return undefined;
    return action.kind === "open_page"
      ? { kind: "open_page", url }
      : { kind: "find_in_page", url, pattern: text((action as { pattern?: unknown }).pattern) };
  }
  return undefined;
}

// DB から読んだ途中経過を検証して戻す。壊れた JSON や想定外の形は捨て、表示を壊さない。
export function parseStoredActivity(raw: string | null | undefined): StoredStep[] | undefined {
  if (!raw) return undefined;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!Array.isArray(data)) return undefined;

  const steps: StoredStep[] = [];
  for (const item of data) {
    const step = item as Record<string, unknown> | null;
    if (!step || typeof step.id !== "string") continue;
    const id = step.id;
    if (step.kind === "thought" && typeof step.text === "string") {
      steps.push({ id: step.id, kind: "thought", text: step.text });
    } else if (step.kind === "web") {
      // 保存済みの回答に「検索中」は残さない。action を復元できない検索は捨てる。
      const action = parseStoredWebAction(step.action);
      if (action) steps.push({ id: step.id, kind: "web", status: "done", action });
    } else if (step.kind === "context") {
      const info = parseContextInfo(step);
      if (info) steps.push({ id: step.id, kind: "context", ...info });
    } else if (step.kind === "tool" && typeof step.name === "string") {
      const label = text(step.label);
      steps.push({ id: step.id, kind: "tool", status: "done", name: step.name, ...(label ? { label } : {}) });
    } else if (step.kind === "failure" && isFailureInfo(step)) {
      steps.push({ id, kind: "failure", offset: step.offset, detail: step.detail });
    }
  }
  return steps.length ? steps : undefined;
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
