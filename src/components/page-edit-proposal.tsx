"use client";

import { Check, ChevronRight, FilePenLine, FilePlus2, LoaderCircle, X } from "lucide-react";
import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { ActivityStep } from "@/lib/chat-activity";
import { useT } from "@/components/i18n-provider";
import { localizeSystemText, msg } from "@/lib/i18n/translate";
import { noteIconText } from "@/lib/note-icon";

type EditProposal = Extract<ActivityStep, { kind: "proposal" }>;
type CreateProposal = Extract<ActivityStep, { kind: "create_proposal" }>;
type Proposal = EditProposal | CreateProposal;
// pageId は適用後のノート ID（「Open the note」のリンク先）。
type State = { status: "idle" | "applying" | "discarding" | "applied" | "discarded"; error: string; pageId?: string };

const OP_LABEL = { replace: msg("Replace"), insert_after: msg("Insert"), delete: msg("Delete") } as const;

// 画面の中での操作中の状態（適用中・エラー）と、操作した結果をコンポーネントの外で持つ。
// 回答の保存後に履歴を取り直すとカードは作り直されるが、状態は提案 ID ごとに残るので「未適用」に戻らない。
// 再読み込みしたあとは、サーバーに保存された状態（status）から復元する。
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

// 適用・破棄はサーバーの専用エンドポイントで行う。提案は保存済みで、適用は 1 回だけ有効（再送しても二重にならない）。
// 手動の保存と同じ検証と版の確認を通り、案を作った時点の版と一致しない時は 409 で止まる。
async function apply(proposal: Proposal) {
  if ((states.get(proposal.id)?.status ?? "idle") !== "idle") return;
  setState(proposal.id, { status: "applying", error: "" });
  try {
    const response = await fetch(`/api/proposals/${proposal.id}/apply`, { method: "POST" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : msg("Could not apply the proposal."));
    const pageId = proposal.kind === "proposal" ? proposal.pageId : (data.page?.id as string | undefined);
    setState(proposal.id, { status: "applied", error: "", pageId });
    // 開いているノート編集の状態（版と本文）や一覧を最新にそろえる。
    window.dispatchEvent(new CustomEvent(proposal.kind === "proposal" ? "notefable:page-updated" : "notefable:page-created", { detail: data.page }));
  } catch (caught) {
    setState(proposal.id, { status: "idle", error: caught instanceof Error ? caught.message : msg("Could not apply the proposal.") });
  }
}

async function discard(proposal: Proposal) {
  if ((states.get(proposal.id)?.status ?? "idle") !== "idle") return;
  setState(proposal.id, { status: "discarding", error: "" });
  try {
    const response = await fetch(`/api/proposals/${proposal.id}/discard`, { method: "POST" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : msg("Could not discard the proposal."));
    setState(proposal.id, { status: "discarded", error: "" });
  } catch (caught) {
    setState(proposal.id, { status: "idle", error: caught instanceof Error ? caught.message : msg("Could not discard the proposal.") });
  }
}

function useProposalState(proposal: Proposal): State {
  const initial = useMemo<State>(() => ({
    status: proposal.status === "applied" ? "applied" : proposal.status === "discarded" ? "discarded" : "idle",
    error: "",
    pageId: proposal.kind === "proposal" ? proposal.pageId : (proposal.appliedPageId ?? undefined),
  }), [proposal]);
  // サーバーに保存された確定状態（適用済み・破棄済み）は、手元の古い状態（エラー後の未適用など）より優先する。
  // 別のタブで先に操作された場合も、読み込み直せばその結果が出る。
  const settled = initial.status === "applied" || initial.status === "discarded";
  return useSyncExternalStore(subscribe, () => (settled ? initial : states.get(proposal.id) ?? initial), () => initial);
}

// カードの枠。標題の折りたたみボタンで細い 1 行に最小化できる。
// 処理済み（適用・破棄）は最初から最小化しておき、履歴を長くしない。待確認のものは開いたまま。
function Card({ proposal, state, icon, title, label, applyLabel, doneBadge, children }: {
  proposal: Proposal; state: State; icon: ReactNode; title: ReactNode; label: string; applyLabel: string; doneBadge: string; children: ReactNode;
}) {
  const t = useT();
  const settled = state.status === "applied" || state.status === "discarded";
  const busy = state.status === "applying" || state.status === "discarding";
  const [manual, setManual] = useState<boolean | null>(null);
  // 適用中・エラー表示中は、結果が見えるよう必ず開く。
  const open = busy || !!state.error || (manual ?? !settled);
  const badge = state.status === "applied" ? doneBadge : state.status === "discarded" ? t("Discarded") : "";
  return (
    <section className={`page-edit ${settled ? "is-settled" : ""} ${open ? "" : "is-minimized"}`} aria-label={label}>
      <header className="page-edit-header">
        <button type="button" className="page-edit-toggle" aria-expanded={open} onClick={() => setManual(!open)}
          title={open ? t("Minimize") : t("Expand")}>
          <ChevronRight size={14} strokeWidth={2} className={`page-edit-chevron ${open ? "is-open" : ""}`} aria-hidden="true" />
          {icon}
          <span className="min-w-0 flex-1 truncate">{title}</span>
          {badge && <span className="page-edit-badge">{badge}</span>}
        </button>
        {!open && state.status === "applied" && state.pageId && (
          <a className="page-edit-link page-edit-link-inline" href={`/?view=pages&page=${encodeURIComponent(state.pageId)}`}>{t("Open")}</a>
        )}
      </header>
      {open && <>
        <div className="page-edit-body">{children}</div>
        {state.error && <p className="page-edit-error" role="alert">{localizeSystemText(state.error, t)}</p>}
        {!settled && (
          <footer className="page-edit-actions">
            <button type="button" className="page-edit-apply" onClick={() => void apply(proposal)} disabled={busy}>
              {state.status === "applying" ? <LoaderCircle size={13} className="animate-spin" /> : <Check size={13} />}
              {applyLabel}
            </button>
            <button type="button" className="page-edit-discard" onClick={() => void discard(proposal)} disabled={busy}>
              <X size={13} />
              {t("Discard")}
            </button>
          </footer>
        )}
        {state.status === "applied" && state.pageId && (
          <footer className="page-edit-actions">
            <a className="page-edit-link" href={`/?view=pages&page=${encodeURIComponent(state.pageId)}`}>{t("Open the note")}</a>
          </footer>
        )}
      </>}
    </section>
  );
}

// 新しいノートの提案。Create note を押すまでノートは作られない。
export function PageCreateProposal({ proposal }: { proposal: CreateProposal }) {
  const t = useT();
  const state = useProposalState(proposal);
  return (
    <Card proposal={proposal} state={state} label={t("Proposed new note")} applyLabel={t("Create note")} doneBadge={t("Created")}
      icon={<FilePlus2 size={14} strokeWidth={1.9} aria-hidden="true" />}
      title={t("New note{icon} “{title}”", { icon: noteIconText(proposal.icon) ? ` ${noteIconText(proposal.icon)}` : "", title: proposal.title })}>
      <div className="page-edit-change">
        {proposal.content ? <div className="page-edit-after">{proposal.content}</div> : <div className="page-edit-op">{t("Empty note")}</div>}
      </div>
    </Card>
  );
}

// モデルが出したノートの編集案。承認されるまでノートは変わらない。
export function PageEditProposal({ proposal }: { proposal: EditProposal }) {
  const t = useT();
  const state = useProposalState(proposal);
  return (
    <Card proposal={proposal} state={state} label={t("Proposed note edit")} applyLabel={t("Apply")} doneBadge={t("Applied")}
      icon={<FilePenLine size={14} strokeWidth={1.9} aria-hidden="true" />}
      title={t("Proposed edit to “{title}”", { title: proposal.pageTitle })}>
      {proposal.title && (
        <div className="page-edit-change">
          <div className="page-edit-op">{t("Rename")}</div>
          <div className="page-edit-before">{proposal.title.before}</div>
          <div className="page-edit-after">{proposal.title.after}</div>
        </div>
      )}
      {proposal.changes.map((change, index) => (
        <div key={index} className="page-edit-change">
          <div className="page-edit-op">{change.block ? t("{op} · block {block}", { op: t(OP_LABEL[change.op]), block: change.block }) : t("{op} · start of note", { op: t(OP_LABEL[change.op]) })}</div>
          {change.before !== undefined && <div className="page-edit-before">{change.before}</div>}
          {change.after !== undefined && <div className="page-edit-after">{change.after}</div>}
          {change.dropsMedia && <div className="page-edit-note">{t("An uploaded image or file in this block will be removed from the note.")}</div>}
          {change.dropsFormatting &&<div className="page-edit-note">{t("Text colors, underline or alignment in the replaced block will be lost.")}</div>}
        </div>
      ))}
    </Card>
  );
}
