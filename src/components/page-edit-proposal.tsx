"use client";

import { Check, FilePenLine, FilePlus2, LoaderCircle, X } from "lucide-react";
import { useSyncExternalStore } from "react";
import type { ActivityStep } from "@/lib/chat-activity";

type Proposal = Extract<ActivityStep, { kind: "proposal" }>;
type CreateProposal = Extract<ActivityStep, { kind: "create_proposal" }>;
// pageId は新規ページを作った後の ID（「Open the note」のリンク先）。
type State = { status: "idle" | "applying" | "applied" | "discarded"; error: string; pageId?: string };

const OP_LABEL = { replace: "Replace", insert_after: "Insert", delete: "Delete" } as const;

// 回答の保存後に履歴を取り直すとメッセージが作り直されてカードも再マウントされる。
// 適用済み・破棄済みが「未適用」に戻らないよう、状態は提案 ID ごとにコンポーネントの外で持つ。
const IDLE: State = { status: "idle", error: "" };
const states = new Map<string, State>();
const listeners = new Set<() => void>();

function setState(id: string, next: State) {
  states.set(id, next);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

// 適用は通常のページ保存と同じ PATCH /api/pages/[id]。案を作った時点の版（baseVersion）と一致する時だけ通る。
async function apply(proposal: Proposal) {
  if ((states.get(proposal.id) ?? IDLE).status !== "idle") return;
  setState(proposal.id, { status: "applying", error: "" });
  try {
    const response = await fetch(`/api/pages/${proposal.pageId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: proposal.proposed.title, blocks: proposal.proposed.blocks, version: proposal.baseVersion }),
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 409) throw new Error("This note changed after the proposal was made. Ask again to get a fresh proposal.");
    if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Could not apply the edit.");
    setState(proposal.id, { status: "applied", error: "" });
    // 開いているページ編集の状態（版と本文）を最新にそろえる。
    window.dispatchEvent(new CustomEvent("studymate:page-updated", { detail: data.page }));
  } catch (caught) {
    setState(proposal.id, { status: "idle", error: caught instanceof Error ? caught.message : "Could not apply the edit." });
  }
}

// 新規ページは POST /api/pages。承認されるまで何も作られない。
async function applyCreate(proposal: CreateProposal) {
  if ((states.get(proposal.id) ?? IDLE).status !== "idle") return;
  setState(proposal.id, { status: "applying", error: "" });
  try {
    const response = await fetch("/api/pages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: proposal.proposed.title, icon: proposal.proposed.icon, cover: null, coverPosition: null, blocks: proposal.proposed.blocks }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Could not create the note.");
    setState(proposal.id, { status: "applied", error: "", pageId: data.page.id });
    // 読み込み済みのページ一覧に新しいページを加える。
    window.dispatchEvent(new CustomEvent("studymate:page-created", { detail: data.page }));
  } catch (caught) {
    // 応答が届かなかった場合、サーバー側では作成済みの可能性がある。重複を避けるため確認を促す。
    const lost = caught instanceof TypeError;
    setState(proposal.id, {
      status: "idle",
      error: lost ? "The connection was lost, so the note may already have been created. Check your Notes list before creating it again." : caught instanceof Error ? caught.message : "Could not create the note.",
    });
  }
}

// 新しいページの提案。Apply を押すまでページは作られない。
export function PageCreateProposal({ proposal }: { proposal: CreateProposal }) {
  const { status, error, pageId } = useSyncExternalStore(subscribe, () => states.get(proposal.id) ?? IDLE, () => IDLE);
  const settled = status === "applied" || status === "discarded";

  return (
    <section className={`page-edit ${settled ? "is-settled" : ""}`} aria-label="Proposed new note">
      <header className="page-edit-header">
        <FilePlus2 size={14} strokeWidth={1.9} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">New note{proposal.icon ? ` ${proposal.icon}` : ""} “{proposal.title}”</span>
        {status === "applied" && <span className="page-edit-badge">Created</span>}
        {status === "discarded" && <span className="page-edit-badge">Discarded</span>}
      </header>
      <div className="page-edit-body">
        <div className="page-edit-change">
          {proposal.content ? <div className="page-edit-after">{proposal.content}</div> : <div className="page-edit-op">Empty note</div>}
        </div>
      </div>
      {error && <p className="page-edit-error" role="alert">{error}</p>}
      {!settled && (
        <footer className="page-edit-actions">
          <button type="button" className="page-edit-apply" onClick={() => void applyCreate(proposal)} disabled={status === "applying"}>
            {status === "applying" ? <LoaderCircle size={13} className="animate-spin" /> : <Check size={13} />}
            Create note
          </button>
          <button type="button" className="page-edit-discard" onClick={() => setState(proposal.id, { status: "discarded", error: "" })} disabled={status === "applying"}>
            <X size={13} />
            Discard
          </button>
        </footer>
      )}
      {status === "applied" && pageId && (
        <footer className="page-edit-actions">
          <a className="page-edit-link" href={`/?view=pages&page=${encodeURIComponent(pageId)}`}>Open the note</a>
        </footer>
      )}
    </section>
  );
}

// モデルが出したページの編集案。承認されるまでページは変わらない。
export function PageEditProposal({ proposal }: { proposal: Proposal }) {
  const { status, error } = useSyncExternalStore(subscribe, () => states.get(proposal.id) ?? IDLE, () => IDLE);
  const settled = status === "applied" || status === "discarded";

  return (
    <section className={`page-edit ${settled ? "is-settled" : ""}`} aria-label="Proposed note edit">
      <header className="page-edit-header">
        <FilePenLine size={14} strokeWidth={1.9} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">Proposed edit to “{proposal.pageTitle}”</span>
        {status === "applied" && <span className="page-edit-badge">Applied</span>}
        {status === "discarded" && <span className="page-edit-badge">Discarded</span>}
      </header>
      <div className="page-edit-body">
        {proposal.title && (
          <div className="page-edit-change">
            <div className="page-edit-op">Rename</div>
            <div className="page-edit-before">{proposal.title.before}</div>
            <div className="page-edit-after">{proposal.title.after}</div>
          </div>
        )}
        {proposal.changes.map((change, index) => (
          <div key={index} className="page-edit-change">
            <div className="page-edit-op">{OP_LABEL[change.op]}{change.block ? ` · block ${change.block}` : " · start of note"}</div>
            {change.before !== undefined && <div className="page-edit-before">{change.before}</div>}
            {change.after !== undefined && <div className="page-edit-after">{change.after}</div>}
            {change.dropsFormatting && <div className="page-edit-note">Text colors, underline or alignment in the replaced block will be lost.</div>}
          </div>
        ))}
      </div>
      {error && <p className="page-edit-error" role="alert">{error}</p>}
      {!settled && (
        <footer className="page-edit-actions">
          <button type="button" className="page-edit-apply" onClick={() => void apply(proposal)} disabled={status === "applying"}>
            {status === "applying" ? <LoaderCircle size={13} className="animate-spin" /> : <Check size={13} />}
            Apply
          </button>
          <button type="button" className="page-edit-discard" onClick={() => setState(proposal.id, { status: "discarded", error: "" })} disabled={status === "applying"}>
            <X size={13} />
            Discard
          </button>
        </footer>
      )}
      {status === "applied" && (
        <footer className="page-edit-actions">
          <a className="page-edit-link" href={`/?view=pages&page=${encodeURIComponent(proposal.pageId)}`}>Open the note</a>
        </footer>
      )}
    </section>
  );
}
