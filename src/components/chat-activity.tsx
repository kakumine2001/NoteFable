"use client";

import { ChevronRight, FileSearch, FileText, Globe, Lightbulb, LoaderCircle, NotebookText, Search, TextSearch } from "lucide-react";
import { useEffect, useRef, useState } from "react";

// 1 回の検索で 20 件近く返ることがあるため、最初は数件だけ見せる。
const VISIBLE_SOURCES = 6;
import { hostOf, splitThought, type ProgressStep } from "@/lib/chat-activity";

type ChatActivityProps = {
  steps: ProgressStep[];
  // 本文がまだ届いていない間は true。展開して現在の動きを見せる。
  isThinking: boolean;
  // 待機中は経過秒数、完了後は本文が届くまでの秒数。
  seconds: number | null;
};

function shortUrl(url: string) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === "/" ? "" : decodeURIComponent(parsed.pathname);
    return `${hostOf(url)}${path}`;
  } catch {
    return url;
  }
}

// 同じサイトの結果が並んでも区別できるよう、チップにはサイト名とページ名を出す。
function sourceLabel(url: string) {
  try {
    const segment = new URL(url).pathname.split("/").filter(Boolean).at(-1);
    return segment ? `${hostOf(url)} › ${decodeURIComponent(segment)}` : hostOf(url);
  } catch {
    return url;
  }
}

// ヘッダーに出す「今やっていること」。最後のステップを短い一文にする。
function describeCurrent(steps: ProgressStep[]) {
  const last = steps.at(-1);
  if (!last) return "Thinking";
  if (last.kind === "thought") return splitThought(last.text).title || "Thinking";
  if (last.kind === "tool") return last.status === "done" && last.label ? last.label : toolRunningLabel(last.name);
  if (last.status === "running" || !last.action) return "Searching the web";
  if (last.action.kind === "search") return `Searching “${last.action.queries[0] ?? "the web"}”`;
  if (last.action.kind === "open_page") return `Reading ${hostOf(last.action.url)}`;
  return `Scanning ${hostOf(last.action.url)}`;
}

function toolRunningLabel(name: string) {
  return name === "search_notes" ? "Searching your notes" : "Reading your note";
}

// 完了後のヘッダー用に、検索回数と参照ページ数をまとめる。
function summarize(steps: ProgressStep[]) {
  let searches = 0;
  let notes = 0;
  const pages = new Set<string>();
  for (const step of steps) {
    if (step.kind === "tool") notes++;
    if (step.kind !== "web" || !step.action) continue;
    if (step.action.kind === "search") {
      searches += Math.max(1, step.action.queries.length);
      step.action.sources.forEach((url) => pages.add(url));
    } else {
      pages.add(step.action.url);
    }
  }
  return [
    searches ? `${searches} ${searches === 1 ? "search" : "searches"}` : "",
    pages.size ? `${pages.size} ${pages.size === 1 ? "source" : "sources"}` : "",
    notes ? `${notes} ${notes === 1 ? "note lookup" : "note lookups"}` : "",
  ].filter(Boolean);
}

function SourceChips({ urls }: { urls: string[] }) {
  const [showAll, setShowAll] = useState(false);
  if (!urls.length) return null;
  const hidden = showAll ? 0 : Math.max(0, urls.length - VISIBLE_SOURCES);
  return (
    <div className="chat-activity-sources">
      {urls.slice(0, urls.length - hidden).map((url) => (
        <a key={url} href={url} target="_blank" rel="noopener noreferrer" title={url} className="chat-activity-chip">
          <Globe size={11} strokeWidth={2} aria-hidden="true" />
          <span>{sourceLabel(url)}</span>
        </a>
      ))}
      {hidden > 0 && (
        <button type="button" className="chat-activity-chip" onClick={() => setShowAll(true)}>
          +{hidden} more
        </button>
      )}
    </div>
  );
}

function StepRow({ step }: { step: ProgressStep }) {
  if (step.kind === "thought") {
    const { title, body } = splitThought(step.text);
    return (
      <li className="chat-activity-step">
        <span className="chat-activity-icon"><Lightbulb size={13} strokeWidth={1.9} /></span>
        <div className="min-w-0 flex-1">
          {title && <div className="chat-activity-title">{title}</div>}
          {body && <p className="chat-activity-body">{body}</p>}
        </div>
      </li>
    );
  }

  if (step.kind === "tool") {
    const Icon = step.status === "running" ? LoaderCircle : step.name === "search_notes" ? FileSearch : NotebookText;
    return (
      <li className="chat-activity-step">
        <span className="chat-activity-icon">
          <Icon size={13} strokeWidth={1.9} className={step.status === "running" ? "animate-spin" : undefined} />
        </span>
        <div className="chat-activity-title">{step.status === "done" && step.label ? step.label : `${toolRunningLabel(step.name)}…`}</div>
      </li>
    );
  }

  const action = step.action;
  if (step.status === "running" || !action) {
    return (
      <li className="chat-activity-step">
        <span className="chat-activity-icon"><LoaderCircle size={13} strokeWidth={1.9} className="animate-spin" /></span>
        <div className="chat-activity-title">Searching the web…</div>
      </li>
    );
  }

  if (action.kind === "search") {
    return (
      <li className="chat-activity-step">
        <span className="chat-activity-icon"><Search size={13} strokeWidth={1.9} /></span>
        <div className="min-w-0 flex-1">
          <div className="chat-activity-title">Searched</div>
          <ul className="chat-activity-queries">
            {action.queries.length ? action.queries.map((query) => <li key={query}>{query}</li>) : <li>the web</li>}
          </ul>
          <SourceChips urls={action.sources} />
        </div>
      </li>
    );
  }

  const isFind = action.kind === "find_in_page";
  return (
    <li className="chat-activity-step">
      <span className="chat-activity-icon">
        {isFind ? <TextSearch size={13} strokeWidth={1.9} /> : <FileText size={13} strokeWidth={1.9} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="chat-activity-title">
          {isFind ? <>Looked for “{action.pattern}” in</> : "Read"}{" "}
          <a href={action.url} target="_blank" rel="noopener noreferrer" title={action.url} className="chat-activity-link">
            {shortUrl(action.url)}
          </a>
        </div>
      </div>
    </li>
  );
}

export function ChatActivity({ steps, isThinking, seconds }: ChatActivityProps) {
  // null は「ユーザーがまだ触っていない」。その間は考え中だけ開き、本文が来たら自動で畳む。
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const open = steps.length > 0 && (manualOpen ?? isThinking);
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    // 考え中は一覧の高さに上限があるため、最新のステップが見えるよう末尾へ追従する。
    if (isThinking && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [isThinking, steps]);
  const time = seconds === null ? "" : `${seconds}s`;
  const label = isThinking
    ? [describeCurrent(steps), time].filter(Boolean).join(" · ")
    : [time ? `Thought for ${time}` : "Thought process", ...summarize(steps)].join(" · ");

  return (
    <div className={`chat-activity ${isThinking ? "is-thinking" : ""}`}>
      <button
        type="button"
        className="chat-activity-header"
        onClick={() => setManualOpen(!open)}
        disabled={!steps.length}
        aria-expanded={open}
        aria-live={isThinking ? "polite" : undefined}
      >
        <span className="chat-activity-label">{label}</span>
        {steps.length > 0 && (
          <ChevronRight size={14} strokeWidth={2} className={`chat-activity-chevron ${open ? "is-open" : ""}`} aria-hidden="true" />
        )}
      </button>
      {open && (
        <ol ref={listRef} className="chat-activity-steps">
          {steps.map((step) => <StepRow key={step.id} step={step} />)}
        </ol>
      )}
    </div>
  );
}
