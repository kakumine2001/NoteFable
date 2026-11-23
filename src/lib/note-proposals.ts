import type { Prisma } from "@/generated/prisma/client";
import { NoteValidationError, validateNoteContent } from "@/lib/note-document";
import { assertNoteFilesOwner } from "@/lib/note-files";
import { claimNoteFiles } from "@/lib/stored-files";
import { createRevision } from "@/lib/note-revisions";
import type { PageCreateProposal, PageEditProposal } from "@/lib/page-edit";
import { isCanvasKind, NOT_A_NOTE_ERRORS, pageKindOf } from "@/lib/page-kinds";
import { prisma } from "@/lib/prisma";
import { msg } from "@/lib/i18n/translate";

// AI の提案（ノートの編集・新規作成）の保存と適用。
// 適用はここで 1 回のトランザクションにまとめ、「適用済み」への切り替えを先に取った 1 回だけがノートを書く。
// そのため再送や二重クリックでも、ノートが二重に作られたり、同じ編集が 2 回当たったりしない。

type EditPayload = Omit<PageEditProposal, "id">;
type CreatePayload = Omit<PageCreateProposal, "id">;
type Status = "pending" | "applied" | "discarded";

// 画面とやり取りする形。ActivityStep の proposal / create_proposal と同じ項目に、状態を足したもの。
export type ProposalView =
  | ({ kind: "proposal"; id: string; status: Status; appliedPageId?: string | null } & EditPayload)
  | ({ kind: "create_proposal"; id: string; status: Status; appliedPageId?: string | null } & CreatePayload);

type Row = {
  id: string;
  kind: "EDIT" | "CREATE";
  status: "PENDING" | "APPLIED" | "DISCARDED";
  payload: unknown;
  appliedPageId: string | null;
};

const STATUS: Record<Row["status"], Status> = { PENDING: "pending", APPLIED: "applied", DISCARDED: "discarded" };

// 画面に返す形。適用に使う本文（proposed.blocks）はサーバーの保存分だけを使うので、履歴ごとに丸ごと返さない。
export function toProposalView(row: Row): ProposalView {
  const base = { id: row.id, status: STATUS[row.status], appliedPageId: row.appliedPageId };
  const payload = row.payload as EditPayload & CreatePayload;
  const proposed = { ...payload.proposed, blocks: [] as unknown[] };
  return row.kind === "EDIT"
    ? { ...(payload as EditPayload), proposed, ...base, kind: "proposal" }
    : { ...(payload as CreatePayload), proposed, ...base, kind: "create_proposal" };
}

// 保存された提案の形を、使う前に確かめる。形が壊れていると、条件の欠けた更新を投げかねない。
function validEdit(payload: unknown): payload is EditPayload {
  const p = payload as Partial<EditPayload> | null;
  return !!p && typeof p.pageId === "string" && p.pageId.length > 0 && Number.isSafeInteger(p.baseVersion)
    && typeof p.proposed?.title === "string" && Array.isArray(p.proposed.blocks);
}
function validCreate(payload: unknown): payload is CreatePayload {
  const p = payload as Partial<CreatePayload> | null;
  return !!p && typeof p.proposed?.title === "string" && Array.isArray(p.proposed.blocks);
}

export async function saveProposal(userId: string, sessionId: string, input: { kind: "EDIT"; payload: EditPayload } | { kind: "CREATE"; payload: CreatePayload }) {
  const row = await prisma.noteProposal.create({
    data: { userId, sessionId, kind: input.kind, payload: input.payload as unknown as Prisma.InputJsonValue },
    select: { id: true, kind: true, status: true, payload: true, appliedPageId: true },
  });
  return toProposalView(row);
}

// 回答を保存したあとで、その回答が出した提案を紐付ける。
export async function attachProposals(userId: string, ids: string[], messageId: string, db: Pick<typeof prisma, "noteProposal"> = prisma) {
  if (!ids.length) return;
  await db.noteProposal.updateMany({ where: { id: { in: ids }, userId }, data: { messageId } });
}

export type ApplyResult =
  | { ok: true; status: "applied"; kind: "edit" | "create"; page: unknown }
  | { ok: false; httpStatus: number; error: string };

class Conflict extends Error {}

const fail = (httpStatus: number, error: string): ApplyResult => ({ ok: false, httpStatus, error });

// 適用済みなら、そのときの結果（編集は現在のノート、新規は作ったノート）をそのまま返す。
async function appliedResult(userId: string, row: Row): Promise<ApplyResult> {
  const payload = row.payload as EditPayload;
  const pageId = row.kind === "EDIT" ? payload.pageId : row.appliedPageId;
  const page = pageId ? await prisma.notePage.findFirst({ where: { id: pageId, userId, deletedAt: null } }) : null;
  if (!page) return fail(404, msg("This note no longer exists."));
  return { ok: true, status: "applied", kind: row.kind === "EDIT" ? "edit" : "create", page };
}

export async function applyProposal(userId: string, id: string): Promise<ApplyResult> {
  const row = await prisma.noteProposal.findFirst({ where: { id, userId }, select: { id: true, kind: true, status: true, payload: true, appliedPageId: true } });
  if (!row) return fail(404, msg("Proposal not found."));
  if (row.status === "DISCARDED") return fail(409, msg("This proposal was discarded."));
  if (row.status === "APPLIED") return appliedResult(userId, row);
  if (!(row.kind === "EDIT" ? validEdit(row.payload) : validCreate(row.payload))) return fail(409, msg("This proposal is no longer valid. Ask again to get a fresh proposal."));

  // 適用の権利を取れなかった時は、取った相手（または破棄した相手）の結果をもう一度読んで返す。
  const afterLostClaim = async (): Promise<ApplyResult> => {
    const latest = await prisma.noteProposal.findFirst({ where: { id, userId }, select: { id: true, kind: true, status: true, payload: true, appliedPageId: true } });
    if (!latest) return fail(404, msg("Proposal not found."));
    return latest.status === "APPLIED" ? appliedResult(userId, latest) : fail(409, msg("This proposal was discarded."));
  };

  try {
    if (row.kind === "EDIT") {
      const payload = row.payload as EditPayload;
      // 保存時と同じ検証を、DB から読んだ内容にもかける。
      const content = validateNoteContent({ title: payload.proposed.title, blocks: payload.proposed.blocks });
      assertNoteFilesOwner(content.blocks, userId);
      const page = await prisma.$transaction(async (tx) => {
        const claimed = await tx.noteProposal.updateMany({ where: { id, userId, status: "PENDING" }, data: { status: "APPLIED" } });
        if (!claimed.count) return null;
        // 提案を作った時点の版と一致する時だけ書く（ゴミ箱のノートには書かない）。外れたら「適用済み」への切り替えごと取り消す。
        // ノート以外（ホワイトボード・スライド）には書かない（本体はノートのブロックではない）。
        const current = await tx.notePage.findFirst({
          where: { id: payload.pageId, userId, version: payload.baseVersion, deletedAt: null, kind: "note" },
          select: { id: true, title: true, icon: true, blocks: true, version: true },
        });
        if (!current) throw new Conflict();
        // 提案のためにコピーした画像は、ここからノートの本文が参照する。保存（PATCH）と同じく、ノートの行より先にファイルの行を取る。
        await claimNoteFiles(tx, content.blocks, userId);
        // 上書きする直前の状態を履歴に残す。この後の書き込みが失敗して巻き戻れば、履歴も一緒に消える。
        await createRevision(tx, { noteId: current.id, userId, reason: "AI_EDIT", title: current.title, icon: current.icon, blocks: current.blocks, version: current.version });
        const changed = await tx.notePage.updateMany({
          where: { id: payload.pageId, userId, version: payload.baseVersion, deletedAt: null, kind: "note" },
          data: { title: content.title, blocks: content.blocks as unknown as Prisma.InputJsonValue, version: { increment: 1 } },
        });
        if (!changed.count) throw new Conflict();
        return tx.notePage.findFirst({ where: { id: payload.pageId, userId, deletedAt: null } });
      });
      if (!page) return afterLostClaim();
      return { ok: true, status: "applied", kind: "edit", page };
    }

    const payload = row.payload as CreatePayload;
    const content = validateNoteContent({ title: payload.proposed.title, icon: payload.proposed.icon, blocks: payload.proposed.blocks });
    assertNoteFilesOwner(content.blocks, userId);
    const page = await prisma.$transaction(async (tx) => {
      const claimed = await tx.noteProposal.updateMany({ where: { id, userId, status: "PENDING" }, data: { status: "APPLIED" } });
      if (!claimed.count) return null;
      const created = await tx.notePage.create({
        data: { userId, title: content.title, icon: content.icon, cover: null, coverPosition: null, blocks: content.blocks as unknown as Prisma.InputJsonValue },
      });
      await tx.noteProposal.update({ where: { id }, data: { appliedPageId: created.id } });
      await claimNoteFiles(tx, content.blocks, userId);
      return created;
    });
    if (page) return { ok: true, status: "applied", kind: "create", page };
    return afterLostClaim();
  } catch (error) {
    if (error instanceof Conflict) {
      const payload = row.payload as EditPayload;
      const exists = await prisma.notePage.findFirst({ where: { id: payload.pageId, userId, deletedAt: null }, select: { id: true, kind: true } });
      if (!exists) return fail(404, msg("Note not found."));
      const kind = pageKindOf(exists);
      if (isCanvasKind(kind)) return fail(409, NOT_A_NOTE_ERRORS[kind]);
      return fail(409, msg("This note changed after the proposal was made. Ask again to get a fresh proposal."));
    }
    if (error instanceof NoteValidationError) return fail(error.status, error.message);
    throw error;
  }
}

export async function discardProposal(userId: string, id: string): Promise<{ ok: true; status: "discarded" } | { ok: false; httpStatus: number; error: string }> {
  const changed = await prisma.noteProposal.updateMany({ where: { id, userId, status: "PENDING" }, data: { status: "DISCARDED" } });
  if (changed.count) return { ok: true, status: "discarded" };
  const row = await prisma.noteProposal.findFirst({ where: { id, userId }, select: { status: true } });
  if (!row) return { ok: false, httpStatus: 404, error: msg("Proposal not found.") };
  return row.status === "DISCARDED" ? { ok: true, status: "discarded" } : { ok: false, httpStatus: 409, error: msg("This proposal was already applied.") };
}

// 履歴の表示用に、セッションの提案を回答ごとにまとめる。回答に紐付いていない提案は出さない。
export async function proposalsByMessage(userId: string, sessionId: string) {
  const rows = await prisma.noteProposal.findMany({
    where: { sessionId, userId, messageId: { not: null } },
    orderBy: { createdAt: "asc" },
    select: { id: true, messageId: true, kind: true, status: true, payload: true, appliedPageId: true },
  });
  const grouped = new Map<string, ProposalView[]>();
  for (const row of rows) grouped.set(row.messageId!, [...(grouped.get(row.messageId!) ?? []), toProposalView(row)]);
  return grouped;
}
