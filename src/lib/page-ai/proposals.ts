import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { emptyCanvasData, type CanvasData } from "@/lib/canvas-document";
import { readCanvasData } from "@/lib/canvas-store";
import { NoteValidationError } from "@/lib/note-document";
import { createRevision } from "@/lib/note-revisions";
import { descendantIds, lockNoteOrder } from "@/lib/note-tree-server";
import { isCanvasKind, NOT_A_NOTE_ERRORS, pageKindOf, type CanvasKind, type PageKind } from "@/lib/page-kinds";
import { prisma } from "@/lib/prisma";
import { getImageExtension } from "@/lib/storage";
import { discardStoredFiles, storeFile } from "@/lib/stored-files";
import { fmt, msg } from "@/lib/i18n/translate";
import type { CreateDraft, EditDraft, ProposalImage, ProposedContent, ValidatedContent } from "@/lib/page-ai/adapter";
import { adapterFor } from "@/lib/page-ai/registry";
import { loadFullPage } from "@/lib/page-ai/storage";
import type { PageCreateProposal, PageEditProposal, ProposalChange, ProposalStatus } from "@/lib/page-ai/types";

// AI の提案（ページの編集・新規作成）の保存・適用・破棄・元に戻す。ページの種類によらない（内容の検証と書き方はアダプター）。
// 適用は 1 回のトランザクションにまとめ、「適用済み」への切り替えを先に取った 1 回だけがページを書く。
// そのため再送や二重クリックでも、ページが二重に作られたり、同じ編集が 2 回当たったりしない。
// 編集の適用は、上書きする直前の状態を同じトランザクションで履歴（AI_EDIT）に残し、元に戻すときはその履歴へ戻す。

// 提案の縮小画像。本体はファイル置き場（StoredFile の PROPOSAL_IMAGE）に置き、提案にはその場所だけを残す（画像を DB に入れない）。
type StoredImage = { change: number; side: "before" | "after"; mimeType: ProposalImage["mimeType"]; path: string };

// NoteProposal.payload に保存する形。proposed は適用で書く内容（画面には返さない）、images は縮小画像の置き場所（画面には URL で返す）、
// focusIds は影響した要素・スライド ID（content API のプレビュー専用で、SSE やメッセージ履歴には流さない）。
type EditPayload = {
  pageId: string; pageTitle: string; baseVersion: number; title?: { before: string; after: string };
  changes: ProposalChange[]; proposed: ProposedContent; images?: StoredImage[]; focusIds?: string[];
};
type CreatePayload = {
  title: string; icon: string | null; content: string; parentId?: string | null; parentTitle?: string;
  changes?: ProposalChange[]; proposed: ProposedContent; images?: StoredImage[]; focusIds?: string[];
};

// 画面とやり取りする形（chat-activity.ts の proposal / create_proposal と同じ項目に、状態を足したもの）。
export type ProposalView =
  | ({ kind: "proposal" } & PageEditProposal)
  | ({ kind: "create_proposal" } & PageCreateProposal);

type Row = {
  id: string;
  kind: "EDIT" | "CREATE";
  status: "PENDING" | "APPLIED" | "DISCARDED" | "UNDONE";
  pageKind: PageKind;
  payload: unknown;
  appliedPageId: string | null;
  autoApplied: boolean;
  appliedVersion: number | null;
  revisionId: string | null;
};

const ROW_SELECT = {
  id: true, kind: true, status: true, pageKind: true, payload: true, appliedPageId: true, autoApplied: true, appliedVersion: true, revisionId: true,
} as const;

const STATUS: Record<Row["status"], ProposalStatus> = { PENDING: "pending", APPLIED: "applied", DISCARDED: "discarded", UNDONE: "undone" };

// 1 つの提案に保存する縮小画像の上限（数と 1 枚の大きさ）。カードの見た目のためだけなので、超えた分は保存しない。
const MAX_PROPOSAL_IMAGES = 8;
const MAX_PROPOSAL_IMAGE_BASE64 = 350_000;

function imageUrl(id: string, change: number, side: "before" | "after") {
  return `/api/proposals/${encodeURIComponent(id)}/image?change=${change}&side=${side}`;
}

// 保存した縮小画像は、本体ではなく URL（持ち主を確かめて返すエンドポイント）にして画面へ渡す。
function withImages(id: string, changes: ProposalChange[] | undefined, images: StoredImage[] | undefined): ProposalChange[] | undefined {
  if (!changes) return undefined;
  return changes.map((change, index) => {
    const has = (side: "before" | "after") => images?.some((image) => image.change === index && image.side === side);
    return { ...change, ...(has("before") ? { beforeImage: imageUrl(id, index, "before") } : {}), ...(has("after") ? { afterImage: imageUrl(id, index, "after") } : {}) };
  });
}

// 画面に返す形。適用に使う内容（proposed の本文・本体）と縮小画像の本体は、サーバーの保存分だけを使うので返さない。
// proposed.blocks は常に空の配列（古いアプリは配列があることを確かめる）。
export function toProposalView(row: Row): ProposalView {
  const status = STATUS[row.status];
  const state = {
    id: row.id, status, appliedPageId: row.appliedPageId, pageKind: row.pageKind,
    ...(row.autoApplied ? { autoApplied: true } : {}),
    ...(status === "applied" && row.appliedVersion !== null ? { undoable: true } : {}),
  };
  if (row.kind === "EDIT") {
    const { proposed, images, focusIds, changes, ...rest } = row.payload as EditPayload;
    void focusIds;
    return { ...rest, changes: withImages(row.id, changes, images) ?? [], proposed: { title: proposed.title, blocks: [] }, ...state, kind: "proposal" };
  }
  const { proposed, images, focusIds, changes, ...rest } = row.payload as CreatePayload;
  void focusIds;
  const shown = withImages(row.id, changes, images);
  return { ...rest, ...(shown ? { changes: shown } : {}), proposed: { title: proposed.title, icon: proposed.icon ?? null, blocks: [] }, ...state, kind: "create_proposal" };
}

// 保存された提案の形を、使う前に確かめる。形が壊れていると、条件の欠けた更新を投げかねない。
// 内容はページの種類の形でなければならない（ノートは blocks、ホワイトボード・スライドは data）。違えば、空の内容で上書きしてしまう。
function contentFits(proposed: Partial<ProposedContent> | undefined, kind: PageKind) {
  if (!proposed || typeof proposed.title !== "string") return false;
  return kind === "note"
    ? Array.isArray(proposed.blocks)
    : typeof proposed.data === "object" && proposed.data !== null && !Array.isArray(proposed.data);
}
function editPayload(payload: unknown, kind: PageKind): EditPayload | null {
  const p = payload as Partial<EditPayload> | null;
  return p && typeof p.pageId === "string" && p.pageId.length > 0 && Number.isSafeInteger(p.baseVersion) && contentFits(p.proposed, kind) ? p as EditPayload : null;
}
function createPayload(payload: unknown, kind: PageKind): CreatePayload | null {
  const p = payload as Partial<CreatePayload> | null;
  return p && contentFits(p.proposed, kind) && (p.parentId === undefined || p.parentId === null || typeof p.parentId === "string") ? p as CreatePayload : null;
}

const PROPOSAL_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function keptImages(images: ProposalImage[] | undefined) {
  return (images ?? [])
    .filter((image) => PROPOSAL_IMAGE_TYPES.has(image.mimeType) && image.base64.length <= MAX_PROPOSAL_IMAGE_BASE64)
    .slice(0, MAX_PROPOSAL_IMAGES);
}

// 縮小画像をファイル置き場に置く。カードのためだけの小さな画像なので容量の上限では止めない（チャットで作った画像と同じ扱い）。
async function storeImages(userId: string, images: ProposalImage[]): Promise<StoredImage[]> {
  const stored: StoredImage[] = [];
  try {
    for (const image of images) {
      const path = `proposal-images/${userId}/${randomUUID()}${getImageExtension(image.mimeType)}`;
      await storeFile(userId, { path, kind: "PROPOSAL_IMAGE", buffer: Buffer.from(image.base64, "base64"), mimeType: image.mimeType }, { enforce: false, held: true });
      stored.push({ change: image.change, side: image.side, mimeType: image.mimeType, path });
    }
    return stored;
  } catch (error) {
    await discardStoredFiles(stored.map((image) => image.path));
    throw error;
  }
}

export type SaveInput =
  | { kind: "EDIT"; pageKind: PageKind; page: { id: string; title: string; version: number }; draft: EditDraft }
  | { kind: "CREATE"; pageKind: PageKind; draft: CreateDraft; parentTitle?: string };

function keptFocusIds(focusIds: string[] | undefined): string[] | undefined {
  if (!Array.isArray(focusIds) || !focusIds.length) return undefined;
  const unique = [...new Set(focusIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0 && id.length <= 120))].slice(0, 200);
  return unique.length ? unique : undefined;
}

export async function saveProposal(userId: string, sessionId: string, input: SaveInput): Promise<ProposalView> {
  const images = await storeImages(userId, keptImages(input.draft.images));
  const focusIds = keptFocusIds(input.draft.focusIds);
  const payload: EditPayload | CreatePayload = input.kind === "EDIT"
    ? {
        pageId: input.page.id, pageTitle: input.page.title, baseVersion: input.page.version,
        ...(input.draft.title ? { title: input.draft.title } : {}), changes: input.draft.changes, proposed: input.draft.proposed,
        ...(images.length ? { images } : {}),
        ...(focusIds ? { focusIds } : {}),
      }
    : {
        title: input.draft.title, icon: input.draft.icon, content: input.draft.content,
        ...(input.draft.parentId ? { parentId: input.draft.parentId, ...(input.parentTitle !== undefined ? { parentTitle: input.parentTitle } : {}) } : {}),
        ...(input.draft.changes?.length ? { changes: input.draft.changes } : {}), proposed: input.draft.proposed,
        ...(images.length ? { images } : {}),
        ...(focusIds ? { focusIds } : {}),
      };
  try {
    const row = await prisma.noteProposal.create({
      data: { userId, sessionId, kind: input.kind, pageKind: input.pageKind, payload: payload as unknown as Prisma.InputJsonValue },
      select: ROW_SELECT,
    });
    return toProposalView(row as Row);
  } catch (error) {
    // 提案を残せなかったら、置いた縮小画像も消す。
    await discardStoredFiles(images.map((image) => image.path));
    throw error;
  }
}

// 回答を保存したあとで、その回答が出した提案を紐付ける。
export async function attachProposals(userId: string, ids: string[], messageId: string, db: Pick<typeof prisma, "noteProposal"> = prisma) {
  if (!ids.length) return;
  await db.noteProposal.updateMany({ where: { id: { in: ids }, userId }, data: { messageId } });
}

export async function findProposal(userId: string, id: string): Promise<Row | null> {
  return await prisma.noteProposal.findFirst({ where: { id, userId }, select: ROW_SELECT }) as Row | null;
}

export async function proposalView(userId: string, id: string): Promise<ProposalView | null> {
  const row = await findProposal(userId, id);
  return row ? toProposalView(row) : null;
}

// 失敗。提案がもう待確認でない（別のタブ・端末で適用・破棄・元に戻した）ときは、その状態（status）と適用先（pageId）も返し、
// 画面のカードがその状態に合わせられるようにする。
export type ProposalFailure = { ok: false; httpStatus: number; error: string; status?: ProposalStatus; pageId?: string; undoable?: boolean };

export type ApplyResult =
  | { ok: true; status: "applied"; kind: "edit" | "create"; page: unknown }
  | ProposalFailure;

export type UndoResult =
  | { ok: true; status: "undone"; kind: "edit"; page: unknown }
  | { ok: true; status: "undone"; kind: "create"; trashedIds: string[] }
  | ProposalFailure;

class Conflict extends Error {}
// 自動適用の途中でページがロックされた（ロックは版を進めないので、適用の時にもう一度確かめる）。
class Locked extends Error {}

const fail = (httpStatus: number, error: string, final?: { status: ProposalStatus; pageId?: string | null; undoable?: boolean }): ProposalFailure => ({
  ok: false, httpStatus, error,
  ...(final ? { status: final.status, ...(final.pageId ? { pageId: final.pageId } : {}), ...(final.undoable ? { undoable: true } : {}) } : {}),
});
// 適用済みの提案は、元に戻せる（適用した版を記録してある）かも返す（カードの「元に戻す」）。
const finalState = (row: Pick<Row, "status" | "appliedPageId" | "appliedVersion">) => ({
  status: STATUS[row.status], pageId: row.appliedPageId, undoable: row.status === "APPLIED" && row.appliedVersion !== null,
});

// 適用済みなら、そのときの結果（いまのページ）をそのまま返す。
async function appliedResult(userId: string, row: Row): Promise<ApplyResult> {
  const pageId = row.appliedPageId ?? (row.kind === "EDIT" ? editPayload(row.payload, row.pageKind)?.pageId : null);
  const page = pageId ? await loadFullPage(userId, pageId) : null;
  if (!page) return fail(404, msg("This note no longer exists."), finalState(row));
  return { ok: true, status: "applied", kind: row.kind === "EDIT" ? "edit" : "create", page };
}

// 編集を書けなかった理由（ページが消えた・種類が違う・版が進んだ）。
async function editConflict(userId: string, row: Row, pageId: string): Promise<ApplyResult> {
  const exists = await prisma.notePage.findFirst({ where: { id: pageId, userId, deletedAt: null }, select: { id: true, kind: true } });
  if (!exists) return fail(404, msg("Note not found."));
  const kind = pageKindOf(exists);
  if (kind !== row.pageKind && row.pageKind === "note" && isCanvasKind(kind)) return fail(409, NOT_A_NOTE_ERRORS[kind]);
  return fail(409, msg("This note changed after the proposal was made. Ask again to get a fresh proposal."));
}

// auto は AI パネルの「自動適用」（利用者が確認せずに適用した）。
export async function applyProposal(userId: string, id: string, { auto = false }: { auto?: boolean } = {}): Promise<ApplyResult> {
  const row = await findProposal(userId, id);
  if (!row) return fail(404, msg("Proposal not found."));
  if (row.status === "DISCARDED") return fail(409, msg("This proposal was discarded."), finalState(row));
  if (row.status === "UNDONE") return fail(409, msg("This change was undone."), finalState(row));
  if (row.status === "APPLIED") return appliedResult(userId, row);
  const edit = row.kind === "EDIT" ? editPayload(row.payload, row.pageKind) : null;
  const create = row.kind === "CREATE" ? createPayload(row.payload, row.pageKind) : null;
  if (!edit && !create) return fail(409, msg("This proposal is no longer valid. Ask again to get a fresh proposal."));
  const adapter = adapterFor(row.pageKind);

  // 適用の権利を取れなかった時は、取った相手（または破棄した相手）の結果をもう一度読んで返す。
  const afterLostClaim = async (): Promise<ApplyResult> => {
    const latest = await findProposal(userId, id);
    if (!latest) return fail(404, msg("Proposal not found."));
    if (latest.status === "APPLIED") return appliedResult(userId, latest);
    return fail(409, latest.status === "UNDONE" ? msg("This change was undone.") : msg("This proposal was discarded."), finalState(latest));
  };

  try {
    // 保存時と同じ検証を、DB から読んだ内容にもかける。
    const content: ValidatedContent = adapter.validate(userId, (edit ?? create)!.proposed);
    const applied = await prisma.$transaction(async (tx) => {
      const claimed = await tx.noteProposal.updateMany({ where: { id, userId, status: "PENDING" }, data: { status: "APPLIED", autoApplied: auto } });
      if (!claimed.count) return null;
      if (edit) {
        // 提案を作った時点の版と一致する時だけ書く（ゴミ箱のページ・種類の違うページには書かない）。外れたら「適用済み」への切り替えごと取り消す。
        const current = await tx.notePage.findFirst({
          where: { id: edit.pageId, userId, version: edit.baseVersion, deletedAt: null, kind: row.pageKind },
          select: { id: true, title: true, icon: true, blocks: true, version: true, locked: true },
        });
        if (!current) throw new Conflict();
        if (auto && current.locked) throw new Locked();
        const version = current.version;
        // ファイルの行を先に取る（保存と同じロックの順序：ファイル → 履歴とページの行）。
        await adapter.claim(tx, userId, content);
        // 上書きする直前の状態を履歴に残す。この後の書き込みが失敗して巻き戻れば、履歴も一緒に消える。
        const snapshot = await adapter.snapshot(tx, current);
        const revisionId = await createRevision(tx, { noteId: current.id, userId, reason: "AI_EDIT", ...snapshot, version, kind: row.pageKind });
        if (!await adapter.write(tx, { id: current.id, userId, version }, content, { ai: true })) throw new Conflict();
        await tx.noteProposal.update({ where: { id }, data: { appliedPageId: current.id, appliedVersion: version + 1, revisionId } });
        return current.id;
      }
      const created = await adapter.createPage(tx, userId, content, create!.parentId ?? null);
      await tx.noteProposal.update({ where: { id }, data: { appliedPageId: created.id, appliedVersion: created.version } });
      return created.id;
    }, { timeout: 20_000 });
    if (!applied) return afterLostClaim();
    const page = await loadFullPage(userId, applied);
    if (!page) return fail(404, msg("This note no longer exists."), { status: "applied", pageId: applied, undoable: true });
    return { ok: true, status: "applied", kind: edit ? "edit" : "create", page };
  } catch (error) {
    if (error instanceof Conflict) return editConflict(userId, row, edit!.pageId);
    // 自動適用だけが通る（画面には出ない、モデルへの結果）。提案は待確認のまま残る。
    if (error instanceof Locked) return fail(409, msg("The page was locked, so the change was not applied automatically."));
    if (error instanceof NoteValidationError) return fail(error.status, error.message);
    throw error;
  }
}

export async function discardProposal(userId: string, id: string): Promise<{ ok: true; status: "discarded" } | ProposalFailure> {
  const changed = await prisma.noteProposal.updateMany({ where: { id, userId, status: "PENDING" }, data: { status: "DISCARDED" } });
  if (changed.count) return { ok: true, status: "discarded" };
  const row = await prisma.noteProposal.findFirst({ where: { id, userId }, select: { status: true, appliedPageId: true, appliedVersion: true } });
  if (!row) return fail(404, msg("Proposal not found."));
  if (row.status === "DISCARDED") return { ok: true, status: "discarded" };
  return fail(409, row.status === "UNDONE" ? msg("This change was undone.") : msg("This proposal was already applied."), finalState(row as Pick<Row, "status" | "appliedPageId" | "appliedVersion">));
}

class Changed extends Error {}

// 適用した提案を元に戻す。編集は適用前の履歴（AI_EDIT）の内容へ戻し（いまの状態は RESTORE の履歴に残すので、戻したこともまた戻せる）、
// 新規は作ったページをゴミ箱へ移す（30 日以内なら復元できる）。
// どちらも、ページが適用した版のまま（その後に誰も書いていない）ときだけ。書かれていたら 409（編集はページの履歴から戻し、
// 新規はページの「…」メニューからゴミ箱へ移す）。新しいページの下にページが足されていても、カードからは捨てない。
export async function undoProposal(userId: string, id: string): Promise<UndoResult> {
  const row = await findProposal(userId, id);
  if (!row) return fail(404, msg("Proposal not found."));
  if (row.status === "UNDONE") return undoneResult(userId, row);
  if (row.status !== "APPLIED") return fail(409, msg("Only an applied change can be undone."), row.status === "DISCARDED" ? finalState(row) : undefined);
  const adapter = adapterFor(row.pageKind);

  if (row.kind === "CREATE") {
    try {
      const trashed = await prisma.$transaction(async (tx) => {
        const claimed = await tx.noteProposal.updateMany({ where: { id, userId, status: "APPLIED" }, data: { status: "UNDONE" } });
        if (!claimed.count) return null;
        if (!row.appliedPageId) return [];
        // 同時に別のページをこのページの下へ移されても、確かめた後に取り残さない（ページの削除と同じ鍵）。
        await lockNoteOrder(tx, userId);
        const page = await tx.notePage.findFirst({ where: { id: row.appliedPageId, userId, deletedAt: null }, select: { version: true } });
        // もうゴミ箱にある（自分で移した）なら、何もしない。
        if (!page) return [];
        // 作った後に書かれた・下にページが足された（どちらも利用者の作業）ページは、カードからは捨てない。
        if (row.appliedVersion === null || page.version !== row.appliedVersion || (await descendantIds(tx, userId, row.appliedPageId)).length) throw new Changed();
        // 確かめた後に保存が割り込んでも捨てないよう、版を条件に入れて移す（移せなければ、書かれたので止める）。
        const moved = await tx.notePage.updateMany({ where: { id: row.appliedPageId, userId, version: row.appliedVersion, deletedAt: null }, data: { deletedAt: new Date() } });
        if (!moved.count) throw new Changed();
        return [row.appliedPageId];
      });
      if (!trashed) return undoneAfterLostClaim(userId, id);
      return { ok: true, status: "undone", kind: "create", trashedIds: trashed };
    } catch (error) {
      if (error instanceof Changed) return fail(409, msg("This page changed after the AI created it. Move it to Trash from its page menu instead."));
      throw error;
    }
  }

  if (!row.appliedPageId || row.appliedVersion === null || !row.revisionId) {
    return fail(409, msg("This change can't be undone here. Restore an earlier version from the page history."));
  }
  const pageId = row.appliedPageId;
  try {
    const done = await prisma.$transaction(async (tx) => {
      const claimed = await tx.noteProposal.updateMany({ where: { id, userId, status: "APPLIED" }, data: { status: "UNDONE" } });
      if (!claimed.count) return false;
      const current = await tx.notePage.findFirst({
        where: { id: pageId, userId, version: row.appliedVersion!, deletedAt: null, kind: row.pageKind },
        select: { id: true, title: true, icon: true, blocks: true, version: true },
      });
      if (!current) throw new Changed();
      const revision = await tx.noteRevision.findFirst({ where: { id: row.revisionId!, noteId: pageId, userId }, select: { title: true, icon: true, blocks: true, data: true } });
      if (!revision) throw new Changed();
      // 保存と同じ検証を、履歴の内容にもかける（履歴からの復元と同じ）。
      const content = adapter.validate(userId, adapter.fromSnapshot(revision));
      // ファイルの行を先に取る（保存と同じロックの順序）。
      await adapter.claim(tx, userId, content);
      const snapshot = await adapter.snapshot(tx, current);
      await createRevision(tx, { noteId: current.id, userId, reason: "RESTORE", ...snapshot, version: current.version, kind: row.pageKind });
      if (!await adapter.write(tx, { id: current.id, userId, version: current.version }, content, { ai: false })) throw new Changed();
      return true;
    }, { timeout: 20_000 });
    if (!done) return undoneAfterLostClaim(userId, id);
    const page = await loadFullPage(userId, pageId);
    if (!page) return fail(404, msg("Note not found."), { status: "undone", pageId });
    return { ok: true, status: "undone", kind: "edit", page };
  } catch (error) {
    if (error instanceof Changed) {
      const exists = await prisma.notePage.findFirst({ where: { id: pageId, userId, deletedAt: null }, select: { id: true } });
      return exists ? fail(409, msg("This page changed after the AI edit. Restore an earlier version from the page history.")) : fail(404, msg("Note not found."));
    }
    if (error instanceof NoteValidationError) return fail(409, fmt("This version cannot be restored. {detail}", { detail: error.message }));
    throw error;
  }
}

// すでに元に戻した提案。もう一度押されても同じ結果を返す。新しいページは、まだゴミ箱にあればその ID を返す
// （最初の応答を受け取れなかった画面・別のタブも、そのページを閉じられるように）。ゴミ箱から戻されていれば空。
async function undoneResult(userId: string, row: Row): Promise<UndoResult> {
  if (row.kind === "CREATE") {
    const trashed = row.appliedPageId
      ? await prisma.notePage.findFirst({ where: { id: row.appliedPageId, userId, deletedAt: { not: null } }, select: { id: true } })
      : null;
    return { ok: true, status: "undone", kind: "create", trashedIds: trashed ? [trashed.id] : [] };
  }
  const page = row.appliedPageId ? await loadFullPage(userId, row.appliedPageId) : null;
  if (!page) return fail(404, msg("Note not found."), finalState(row));
  return { ok: true, status: "undone", kind: "edit", page };
}

async function undoneAfterLostClaim(userId: string, id: string): Promise<UndoResult> {
  const latest = await findProposal(userId, id);
  if (!latest) return fail(404, msg("Proposal not found."));
  return latest.status === "UNDONE" ? undoneResult(userId, latest) : fail(409, msg("Only an applied change can be undone."), finalState(latest));
}

// 提案の縮小画像（改前・改後）の置き場所。持ち主の提案の、その持ち主のフォルダの画像だけ。
export async function proposalImage(userId: string, id: string, change: number, side: "before" | "after") {
  const row = await prisma.noteProposal.findFirst({ where: { id, userId }, select: { payload: true } });
  const images = (row?.payload as { images?: StoredImage[] } | null)?.images;
  const image = Array.isArray(images) ? images.find((entry) => entry && entry.change === change && entry.side === side) : undefined;
  if (!image || typeof image.path !== "string" || !image.path.startsWith(`proposal-images/${userId}/`) || !PROPOSAL_IMAGE_TYPES.has(image.mimeType)) return null;
  return { mimeType: image.mimeType, path: image.path };
}

export type ProposalContentReason = "version_mismatch" | "deleted" | "revision_missing" | "discarded" | "invalid";

export type ProposalContentPayload = {
  kind: "edit" | "create";
  pageKind: CanvasKind;
  status: ProposalStatus;
  side: "before" | "after";
  title: string;
  pageTitle?: string;
  titleDiff?: { before: string; after: string };
  content?: string;
  parentTitle?: string;
  changes: ProposalChange[];
  focusIds?: string[];
  data?: CanvasData;
  empty?: true;
  stale?: true;
  unavailable?: true;
  reason?: ProposalContentReason;
};

export type ProposalContentResult =
  | { ok: true; content: ProposalContentPayload }
  | { ok: false; httpStatus: number; error: string };

// キャンバス提案（ホワイトボード・スライド）の改前・改後の本体を、プレビュー表示のために本人のみへ返す。
// - side=after: NoteProposal.payload.proposed.data をそのまま返す。
// - side=before:
//   - CREATE は空（empty: true）。
//   - EDIT + PENDING は生きているページの版が baseVersion と一致するときだけ本体を返し、ずれていれば stale（version_mismatch / deleted）。
//   - EDIT + APPLIED / UNDONE は適用時に残した AI_EDIT 履歴（revisionId、本人限定）から返す。無ければ unavailable（revision_missing）。
//   - EDIT + DISCARDED は unavailable（discarded）。
export async function proposalContent(userId: string, id: string, side: "before" | "after"): Promise<ProposalContentResult> {
  const row = await findProposal(userId, id);
  if (!row) return { ok: false, httpStatus: 404, error: msg("Proposal not found.") };
  if (!isCanvasKind(row.pageKind)) return { ok: false, httpStatus: 400, error: msg("Invalid request.") };

  const status = STATUS[row.status];
  const kind = row.kind === "EDIT" ? "edit" : "create";
  const edit = row.kind === "EDIT" ? editPayload(row.payload, row.pageKind) : null;
  const create = row.kind === "CREATE" ? createPayload(row.payload, row.pageKind) : null;
  const rawPayload = (row.payload && typeof row.payload === "object" ? row.payload : null) as Partial<EditPayload & CreatePayload> | null;
  const focusIds = keptFocusIds(rawPayload?.focusIds);
  const changes = withImages(row.id, Array.isArray(rawPayload?.changes) ? rawPayload.changes : [], rawPayload?.images) ?? [];

  const base: Omit<ProposalContentPayload, "title"> = {
    kind,
    pageKind: row.pageKind,
    status,
    side,
    changes,
    ...(focusIds ? { focusIds } : {}),
    ...(edit ? { pageTitle: edit.pageTitle, ...(edit.title ? { titleDiff: edit.title } : {}) } : {}),
    ...(create ? { content: create.content, ...(create.parentTitle !== undefined ? { parentTitle: create.parentTitle } : {}) } : {}),
  };

  if (side === "after") {
    const payload = edit ?? create;
    if (!payload?.proposed.data) {
      return { ok: true, content: { ...base, title: typeof rawPayload?.title === "string" ? rawPayload.title : "", unavailable: true, reason: "invalid" } };
    }
    return {
      ok: true,
      content: {
        ...base,
        title: payload.proposed.title,
        data: payload.proposed.data,
      },
    };
  }

  // side === "before"
  if (row.kind === "CREATE") {
    return {
      ok: true,
      content: {
        ...base,
        title: create?.title ?? (typeof rawPayload?.title === "string" ? rawPayload.title : ""),
        empty: true,
      },
    };
  }

  if (!edit) {
    return { ok: true, content: { ...base, title: "", unavailable: true, reason: "invalid" } };
  }

  if (row.status === "PENDING") {
    const page = await prisma.notePage.findFirst({
      where: { id: edit.pageId, userId, deletedAt: null },
      select: { id: true, kind: true, title: true, version: true, canvas: { select: { data: true } } },
    }) as { id: string; kind?: unknown; title: string; version: number; canvas?: { data: unknown } | null } | null;
    if (!page) {
      return { ok: true, content: { ...base, title: edit.pageTitle, stale: true, reason: "deleted" } };
    }
    if (page.version !== edit.baseVersion || pageKindOf(page) !== row.pageKind) {
      return { ok: true, content: { ...base, title: edit.pageTitle, stale: true, reason: "version_mismatch" } };
    }
    const rawData = page.canvas !== undefined
      ? page.canvas?.data
      : await readCanvasData(userId, edit.pageId);
    const data = rawData && typeof rawData === "object" && !Array.isArray(rawData)
      ? rawData as CanvasData
      : emptyCanvasData(row.pageKind);
    return { ok: true, content: { ...base, title: page.title, data } };
  }

  if (row.status === "APPLIED" || row.status === "UNDONE") {
    if (!row.revisionId) {
      return { ok: true, content: { ...base, title: edit.pageTitle, unavailable: true, reason: "revision_missing" } };
    }
    const revision = await prisma.noteRevision.findFirst({
      where: { id: row.revisionId, userId },
      select: { title: true, data: true },
    });
    if (!revision || !revision.data || typeof revision.data !== "object" || Array.isArray(revision.data)) {
      return { ok: true, content: { ...base, title: edit.pageTitle, unavailable: true, reason: "revision_missing" } };
    }
    return { ok: true, content: { ...base, title: revision.title, data: revision.data as CanvasData } };
  }

  return { ok: true, content: { ...base, title: edit.pageTitle, unavailable: true, reason: "discarded" } };
}

// 履歴の表示用に、セッションの提案を回答ごとにまとめる。回答に紐付いていない提案は出さない。
export async function proposalsByMessage(userId: string, sessionId: string) {
  const rows = await prisma.noteProposal.findMany({
    where: { sessionId, userId, messageId: { not: null } },
    orderBy: { createdAt: "asc" },
    select: { ...ROW_SELECT, messageId: true },
  });
  const grouped = new Map<string, ProposalView[]>();
  for (const { messageId, ...row } of rows) grouped.set(messageId!, [...(grouped.get(messageId!) ?? []), toProposalView(row as Row)]);
  return grouped;
}
