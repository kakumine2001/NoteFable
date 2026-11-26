"use client";

import { Check, ChevronRight, FilePenLine, FilePlus2, Flag, LoaderCircle, Undo2, X } from "lucide-react";
import { createContext, useContext, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { StoredProposal } from "@/types/chat";
import { ReportDialog } from "@/components/answer-actions";
import { CanvasProposalPreview } from "@/components/canvas-proposal-preview";
import { useT } from "@/components/i18n-provider";
import { PageKindIcon } from "@/components/page-kind-icon";
import { localizeSystemText, msg, type Translate } from "@/lib/i18n/translate";
import { noteIconText } from "@/lib/note-icon";
import { isCanvasKind, pageKindOf, type PageKind } from "@/lib/page-kinds";
import { PAGES_TRASHED_EVENT, saveBeforePageChange, saveBeforeTrash } from "@/lib/proposal-sync";
import type { ProposalChange, ProposalOp } from "@/lib/page-ai/types";

// AI の提案カード（ページの編集案・新しいページの案）。ページの種類によらない 1 つのカードで、改前・改後（文字と縮小画像）は
// サーバーのアダプターが作った changes をそのまま出す。Android（ui/ProposalCard.kt）・iOS（ProposalCard.swift）も同じ形を描く。

type EditProposal = Extract<StoredProposal, { kind: "proposal" }>;
type CreateProposal = Extract<StoredProposal, { kind: "create_proposal" }>;
type Proposal = EditProposal | CreateProposal;
// pageId は適用後のページ ID（「開く」のリンク先）。
export type ProposalCardState = {
  status: "idle" | "applying" | "discarding" | "applied" | "discarded" | "undoing" | "undone";
  error: string;
  pageId?: string;
  undoable?: boolean;
};
type State = ProposalCardState;

// カードを出している場所。AI パネルの中では、そのパネルのページへの「開く」は出さない（もう開いている）。
// openPage はアプリ（/note-embed）の中で、ページをアプリに開いてもらう（開けたら true）。noOpen はページを開く手段が無い（古いアプリ）。
export type ProposalHost = { currentPageId?: string; openPage?: (id: string) => boolean; noOpen?: boolean };
export const ProposalHostContext = createContext<ProposalHost>({});

const OP_LABEL: Record<ProposalOp, string> = {
  replace: msg("Replace"), insert_after: msg("Insert"), delete: msg("Delete"),
  add: msg("Add"), update: msg("Update"), move: msg("Move"), reorder: msg("Reorder"),
};

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

const busyStatuses = new Set<State["status"]>(["applying", "discarding", "undoing"]);

// 「開く」の行き先：適用したページと、元に戻している途中・戻した後の編集（ページは残る）。新しく作ったページは、元に戻している間
// （ゴミ箱へ移る途中）と戻した後は開けない。AI パネルの中で、そのパネルのページそのものなら出さない（もう開いている）。
// Android（ProposalState.openPageId）・iOS（ProposalState.openPageId）と同じ規則。
export function openPageId(state: Pick<State, "status" | "pageId">, kind: Proposal["kind"], currentPageId?: string) {
  const openable = state.status === "applied" || ((state.status === "undoing" || state.status === "undone") && kind === "proposal");
  return openable && state.pageId && state.pageId !== currentPageId ? state.pageId : null;
}
// サーバーに保存された確定状態は、手元の古い状態（エラー後の未適用など）より優先する。別のタブで先に操作された場合も、
// 読み込み直せばその結果が出る。適用済みのあとは、この画面で元に戻している・戻した結果だけを手元から使う。
// 画面の表示（useProposalState）と操作（適用・破棄・元に戻す）が、同じ規則で今の状態を決める。
export function resolveProposalState(initial: State, local: State | undefined): State {
  if (initial.status === "discarded" || initial.status === "undone") return initial;
  if (initial.status === "applied") return local && (local.status === "applied" || local.status === "undoing" || local.status === "undone") ? local : initial;
  return local ?? initial;
}

const current = (proposal: Proposal) => resolveProposalState(initialState(proposal), states.get(proposal.id));

export function initialState(proposal: Proposal): State {
  return {
    status: proposal.status === "applied" ? "applied" : proposal.status === "discarded" ? "discarded" : proposal.status === "undone" ? "undone" : "idle",
    error: "",
    pageId: proposal.kind === "proposal" ? proposal.pageId : (proposal.appliedPageId ?? undefined),
    undoable: proposal.undoable === true,
  };
}

// 操作の失敗。提案がもう待確認でない（別のタブ・端末で処理済み）ときは、サーバーが返したその状態（final）を持つ。
class ProposalActionError extends Error {
  constructor(message: string, readonly final?: { status: State["status"]; pageId?: string; undoable?: boolean }) { super(message); }
}

const FINAL_STATUSES = new Set(["applied", "discarded", "undone"]);

async function post(url: string, fallback: string) {
  const response = await fetch(url, { method: "POST" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const status = typeof data.status === "string" && FINAL_STATUSES.has(data.status) ? data.status as State["status"] : undefined;
    throw new ProposalActionError(typeof data.error === "string" ? data.error : fallback,
      status ? { status, ...(typeof data.pageId === "string" ? { pageId: data.pageId } : {}), undoable: data.undoable === true } : undefined);
  }
  return data as { page?: { id?: string }; ids?: unknown };
}

// サーバーで処理済みだったときは、エラーではなくその状態をカードに出す（適用・破棄のボタンを出し直さない）。
function settledByServer(proposal: Proposal, caught: unknown): boolean {
  const final = caught instanceof ProposalActionError ? caught.final : undefined;
  if (!final) return false;
  setState(proposal.id, { status: final.status, error: "", pageId: final.pageId ?? current(proposal).pageId, undoable: final.status === "applied" && final.undoable === true });
  return true;
}

// 適用・破棄・元に戻すはサーバーの専用エンドポイントで行う。提案は保存済みで、どれも 1 回だけ有効（再送しても二重にならない）。
// 適用は手動の保存と同じ検証と版の確認を通り、案を作った時点の版と一致しない時は 409 で止まる。
async function apply(proposal: Proposal) {
  if (current(proposal).status !== "idle") return;
  setState(proposal.id, { ...current(proposal), status: "applying", error: "" });
  // 既存ページへの編集案を適用する前に、開いているエディター（ホワイトボード等の未提出変更を含む）を先に保存し切る。
  // 未保存の編集が保存されて版が進めば、次の apply はサーバー側で 409 競合として安全に止まる。
  if (proposal.kind === "proposal" && !(await saveBeforePageChange([proposal.pageId]))) {
    setState(proposal.id, { ...current(proposal), status: "idle", error: msg("Resolve the unsaved draft before applying this proposal.") });
    return;
  }
  try {
    const data = await post(`/api/proposals/${proposal.id}/apply`, msg("Could not apply the proposal."));
    const pageId = proposal.kind === "proposal" ? proposal.pageId : data.page?.id;
    setState(proposal.id, { status: "applied", error: "", pageId, undoable: true });
    // 開いているページの編集の状態（版と本文）や一覧を最新にそろえる。
    window.dispatchEvent(new CustomEvent(proposal.kind === "proposal" ? "notefable:page-updated" : "notefable:page-created", { detail: data.page }));
  } catch (caught) {
    if (settledByServer(proposal, caught)) return;
    setState(proposal.id, { ...current(proposal), status: "idle", error: caught instanceof Error ? caught.message : msg("Could not apply the proposal.") });
  }
}

async function discard(proposal: Proposal) {
  if (current(proposal).status !== "idle") return;
  setState(proposal.id, { ...current(proposal), status: "discarding", error: "" });
  try {
    await post(`/api/proposals/${proposal.id}/discard`, msg("Could not discard the proposal."));
    setState(proposal.id, { ...current(proposal), status: "discarded", error: "" });
  } catch (caught) {
    if (settledByServer(proposal, caught)) return;
    setState(proposal.id, { ...current(proposal), status: "idle", error: caught instanceof Error ? caught.message : msg("Could not discard the proposal.") });
  }
}

// 編集は適用前の内容へ戻し（いまの内容はページの履歴に残る）、新しいページはゴミ箱へ移す。
async function undo(proposal: Proposal) {
  const before = current(proposal);
  if (before.status !== "applied") return;
  setState(proposal.id, { ...before, status: "undoing", error: "" });
  // 新しいページはゴミ箱へ移るので、開いている編集（サブページも）を先に保存する。保存できなければ移さない（未保存の内容を捨てない）。
  if (proposal.kind === "create_proposal" && before.pageId && !(await saveBeforeTrash([before.pageId]))) {
    setState(proposal.id, { ...before, error: msg("Resolve the unsaved draft before moving this page to Trash.") });
    return;
  }
  // 既存ページの編集を元に戻す前も、開いているエディターの未保存変更を先に送り切る。
  if (proposal.kind === "proposal" && !(await saveBeforePageChange([proposal.pageId]))) {
    setState(proposal.id, { ...before, error: msg("Resolve the unsaved draft before undoing this change.") });
    return;
  }
  try {
    const data = await post(`/api/proposals/${proposal.id}/undo`, msg("Could not undo the change."));
    setState(proposal.id, { ...before, status: "undone", error: "", undoable: false });
    if (proposal.kind === "proposal") window.dispatchEvent(new CustomEvent("notefable:page-updated", { detail: data.page }));
    else window.dispatchEvent(new CustomEvent(PAGES_TRASHED_EVENT, { detail: { ids: Array.isArray(data.ids) ? data.ids : [] } }));
  } catch (caught) {
    if (caught instanceof ProposalActionError && (caught.final?.status === "discarded" || caught.final?.status === "undone")) { settledByServer(proposal, caught); return; }
    setState(proposal.id, { ...before, error: caught instanceof Error ? caught.message : msg("Could not undo the change.") });
  }
}

function useProposalState(proposal: Proposal): State {
  const initial = useMemo(() => initialState(proposal), [proposal]);
  return useSyncExternalStore(subscribe, () => resolveProposalState(initial, states.get(proposal.id)), () => initial);
}

// 変更の見出し（操作と対象）。ノートはブロック番号、スライドは何枚目か、ホワイトボードは要素。
export function changeLabel(change: ProposalChange, t: Translate, kind: PageKind) {
  const op = t(OP_LABEL[change.op] ?? msg("Update"));
  const target = change.target;
  if (target?.type === "slide") return t("{op} · slide {number}", { op, number: target.number });
  if (target?.type === "elements") return target.name ? t("{op} · “{name}”", { op, name: target.name }) : t("{op} · {count} elements", { op, count: target.count });
  if (kind !== "note") return op;
  return change.block ? t("{op} · block {block}", { op, block: change.block }) : t("{op} · start of note", { op });
}

function Change({ change, kind }: { change: ProposalChange; kind: PageKind }) {
  const t = useT();
  return (
    <div className="page-edit-change">
      <div className="page-edit-op">{changeLabel(change, t, kind)}</div>
      {(change.beforeImage || change.afterImage) && (
        <div className="page-edit-images">
          {/* eslint-disable-next-line @next/next/no-img-element -- 本人の提案の縮小画像（認証付きの API）。 */}
          {change.beforeImage && <img className="page-edit-image is-before" src={change.beforeImage} alt={t("Before")} loading="lazy" />}
          {/* eslint-disable-next-line @next/next/no-img-element -- 同上。 */}
          {change.afterImage && <img className="page-edit-image is-after" src={change.afterImage} alt={t("After")} loading="lazy" />}
        </div>
      )}
      {change.before !== undefined && <div className="page-edit-before">{change.before}</div>}
      {change.after !== undefined && <div className="page-edit-after">{change.after}</div>}
      {change.dropsMedia && <div className="page-edit-note">{t("An uploaded image or file in this block will be removed from the note.")}</div>}
      {change.dropsFormatting && <div className="page-edit-note">{t("Text colors, underline or alignment in the replaced block will be lost.")}</div>}
    </div>
  );
}

// カードの枠。標題の折りたたみボタンで細い 1 行に最小化できる。
// 処理済み（適用・破棄・元に戻した）は最初から最小化しておき、履歴を長くしない。待確認のものは開いたまま。
function Card({ proposal, state, icon, title, label, applyLabel, doneBadge, openLabel, children }: {
  proposal: Proposal; state: State; icon: ReactNode; title: ReactNode; label: string; applyLabel: string; doneBadge: string; openLabel: string; children: ReactNode;
}) {
  const t = useT();
  // 元に戻している間も処理済みとして扱う（適用・破棄のボタンは出さない）。
  const settled = state.status === "applied" || state.status === "undoing" || state.status === "discarded" || state.status === "undone";
  const busy = busyStatuses.has(state.status);
  const [manual, setManual] = useState<boolean | null>(null);
  const [reporting, setReporting] = useState(false);
  // 適用中・エラー表示中は、結果が見えるよう必ず開く。
  const open = busy || !!state.error || (manual ?? !settled);
  const badge = state.status === "applied" || state.status === "undoing" ? doneBadge : state.status === "discarded" ? t("Discarded") : state.status === "undone" ? t("Undone") : "";
  const host = useContext(ProposalHostContext);
  const canOpen = !host.noOpen && !!openPageId(state, proposal.kind, host.currentPageId);
  const href = state.pageId ? `/?view=pages&page=${encodeURIComponent(state.pageId)}` : "";
  // アプリ（/note-embed）の中では、リンクをブラウザで開かず、アプリにページを開いてもらう（ブラウザにはアプリのログインが無い）。
  const onOpen = (event: { preventDefault(): void }) => {
    if (state.pageId && host.openPage?.(state.pageId)) event.preventDefault();
  };
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
        {!open && canOpen && <a className="page-edit-link page-edit-link-inline" href={href} onClick={onOpen}>{t("Open")}</a>}
        {/* AI が作った内容なので、カードからも報告できる（Google Play の AI 生成コンテンツのポリシー）。 */}
        <button type="button" className="page-edit-report" onClick={() => setReporting(true)} aria-label={t("Report AI content")} title={t("Report AI content")}>
          <Flag size={13} strokeWidth={1.9} aria-hidden="true" />
        </button>
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
        {(canOpen || state.status === "undoing" || (state.status === "applied" && state.undoable)) && (
          <footer className="page-edit-actions">
            {canOpen && <a className="page-edit-link" href={href} onClick={onOpen}>{openLabel}</a>}
            {(state.status === "undoing" || (state.status === "applied" && state.undoable)) && (
              <button type="button" className="page-edit-discard" onClick={() => void undo(proposal)} disabled={busy}>
                {state.status === "undoing" ? <LoaderCircle size={13} className="animate-spin" /> : <Undo2 size={13} />}
                {t("Undo")}
              </button>
            )}
          </footer>
        )}
        {state.status === "undone" && proposal.kind === "create_proposal" && (
          <p className="page-edit-note page-edit-footnote">{t("The page was moved to Trash.")}</p>
        )}
      </>}
      {reporting && <ReportDialog target={{ proposalId: proposal.id }} onClose={() => setReporting(false)} />}
    </section>
  );
}

// 新しいページの提案。作成を押すまでページは作られない（「自動適用」のときは作られた状態で届く）。
export function PageCreateProposal({ proposal }: { proposal: CreateProposal }) {
  const t = useT();
  const state = useProposalState(proposal);
  const kind = pageKindOf({ kind: proposal.pageKind });
  const icon = noteIconText(proposal.icon);
  const title = kind === "whiteboard" ? t("New whiteboard “{title}”", { title: proposal.title })
    : kind === "slides" ? t("New slide deck “{title}”", { title: proposal.title })
    : t("New note{icon} “{title}”", { icon: icon ? ` ${icon}` : "", title: proposal.title });
  return (
    <Card proposal={proposal} state={state} label={kind === "note" ? t("Proposed new note") : t("Proposed new page")}
      applyLabel={kind === "whiteboard" ? t("Create whiteboard") : kind === "slides" ? t("Create slide deck") : t("Create note")}
      doneBadge={proposal.autoApplied ? t("Created automatically") : t("Created")} openLabel={kind === "note" ? t("Open the note") : t("Open the page")}
      icon={kind === "note" ? <FilePlus2 size={14} strokeWidth={1.9} aria-hidden="true" /> : <PageKindIcon kind={kind} size={14} aria-hidden="true" />}
      title={title}>
      {proposal.parentTitle !== undefined && <div className="page-edit-op">{t("Inside “{title}”", { title: proposal.parentTitle || t("Untitled") })}</div>}
      {isCanvasKind(kind) && (
        <CanvasProposalPreview proposalId={proposal.id} pageKind={kind} proposalKind="create_proposal" status={state.status} mode="card" />
      )}
      {/* 文字の無いページでも、縮小画像などの変更があれば「空のページ」とは書かない。 */}
      {(proposal.content || (!proposal.changes?.length && !isCanvasKind(kind))) && <div className="page-edit-change">
        {proposal.content ? <div className="page-edit-after">{proposal.content}</div> : <div className="page-edit-op">{kind === "note" ? t("Empty note") : t("Empty page")}</div>}
      </div>}
      {proposal.changes?.map((change, index) => <Change key={index} change={change} kind={kind} />)}
    </Card>
  );
}

// 既存のページの編集案。承認されるまでページは変わらない（「自動適用」のときは適用された状態で届く）。
export function PageEditProposal({ proposal }: { proposal: EditProposal }) {
  const t = useT();
  const state = useProposalState(proposal);
  const kind = pageKindOf({ kind: proposal.pageKind });
  return (
    <Card proposal={proposal} state={state} label={kind === "note" ? t("Proposed note edit") : t("Proposed page edit")} applyLabel={t("Apply")}
      doneBadge={proposal.autoApplied ? t("Applied automatically") : t("Applied")} openLabel={kind === "note" ? t("Open the note") : t("Open the page")}
      icon={kind === "note" ? <FilePenLine size={14} strokeWidth={1.9} aria-hidden="true" /> : <PageKindIcon kind={kind} size={14} aria-hidden="true" />}
      title={t("Proposed edit to “{title}”", { title: proposal.pageTitle })}>
      {isCanvasKind(kind) && (
        <CanvasProposalPreview proposalId={proposal.id} pageKind={kind} proposalKind="proposal" status={state.status} mode="card" />
      )}
      {proposal.title && (
        <div className="page-edit-change">
          <div className="page-edit-op">{t("Rename")}</div>
          <div className="page-edit-before">{proposal.title.before}</div>
          <div className="page-edit-after">{proposal.title.after}</div>
        </div>
      )}
      {proposal.changes.map((change, index) => <Change key={index} change={change} kind={kind} />)}
    </Card>
  );
}

export function PageProposal({ proposal }: { proposal: Proposal }) {
  return proposal.kind === "proposal" ? <PageEditProposal proposal={proposal} /> : <PageCreateProposal proposal={proposal} />;
}
